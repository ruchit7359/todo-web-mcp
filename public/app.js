// ---------------------------------------------------------------------------
// State
// Local mirror of the server's task list. Can drift if the backend changes
// tasks outside this session — humanAction() resyncs on any error.
// ---------------------------------------------------------------------------
let tasks = [];
let flashIds = new Set();

// Shorthand DOM accessor
const $ = (id) => document.getElementById(id);

// Human-readable timestamp for console log entries
const time = () => new Date().toLocaleTimeString();

// ---------------------------------------------------------------------------
// REST helper
// Sends a JSON request and returns the parsed response body.
// Throws with the server's error message (or the HTTP status) on failure.
// ---------------------------------------------------------------------------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body:    body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Error banner
// Pass an empty string to hide the banner.
// ---------------------------------------------------------------------------
function showError(message) {
  const box = $('error');
  box.hidden = !message;
  box.textContent = message || '';
}

// ---------------------------------------------------------------------------
// Rendering
// Rebuilds the task list from the current `tasks` array.
// Items in `flashIds` receive a brief highlight animation.
// ---------------------------------------------------------------------------
function render() {
  const list = $('task-list');
  list.innerHTML = '';

  for (const t of tasks) {
    const li = document.createElement('li');
    if (t.done)             li.classList.add('done');
    if (flashIds.has(t.id)) li.classList.add('flash');

    // Checkbox — toggling calls the API then re-renders
    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.checked = t.done;
    cb.onchange = () => humanAction(() => setTaskDone(t.id, cb.checked));

    const label = document.createElement('span');
    label.textContent = t.title;

    const idBadge = document.createElement('small');
    idBadge.textContent = `#${t.id}`;

    const del = document.createElement('button');
    del.className = 'secondary';
    del.textContent = 'Delete';
    del.onclick = () => humanAction(() => deleteTask(t.id));

    li.append(cb, label, idBadge, del);
    list.append(li);
  }

  // Clear flash set after every render so items only flash once
  flashIds = new Set();
}

// Schedule the given task IDs to flash on the next render
function markChanged(ids = []) {
  flashIds = new Set(ids);
}

// ---------------------------------------------------------------------------
// Data actions
// Each function: calls the API → updates local state → re-renders.
// Returning the result allows MCP tools to forward data back to the agent.
// ---------------------------------------------------------------------------

async function load() {
  const data = await api('GET', '/api/tasks');
  tasks = data.tasks;
  showError('');
  render();
  return tasks;
}

async function addTask(title) {
  const task = await api('POST', '/api/tasks', { title });
  tasks.push(task);
  markChanged([task.id]);
  render();
  return task;
}

async function setTaskDone(id, done) {
  const updated = await api('PATCH', `/api/tasks/${id}`, { done });
  tasks = tasks.map((t) => (t.id === id ? updated : t));
  markChanged([id]);
  render();
  return updated;
}

async function deleteTask(id) {
  const result = await api('DELETE', `/api/tasks/${id}`);
  tasks = tasks.filter((t) => t.id !== id);
  markChanged();
  render();
  return result;
}

async function clearCompleted() {
  const result = await api('POST', '/api/tasks/clear-completed');
  tasks = tasks.filter((t) => !t.done);
  markChanged();
  render();
  return result;
}

// ---------------------------------------------------------------------------
// Human action wrapper
// Clears the error banner before each action. On failure it shows the error
// and resyncs the task list so stale UI state can't compound the problem.
// ---------------------------------------------------------------------------
async function humanAction(fn) {
  try {
    showError('');
    await fn();
  } catch (err) {
    showError(`${err.message}. The page may be stale — reloading.`);
    await load().catch(() => {}); // best-effort resync; ignore secondary errors
  }
}

// ---------------------------------------------------------------------------
// Human UI event wiring
// ---------------------------------------------------------------------------
$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('task-input');
  const title = input.value.trim();
  input.value = '';
  if (title) humanAction(() => addTask(title));
});

$('clear-done').onclick = () => humanAction(clearCompleted);

// ---------------------------------------------------------------------------
// WebMCP tool infrastructure
// ---------------------------------------------------------------------------

// Log every tool invocation to the browser console for debugging
function log(name, input, result) {
  console.log(`${time()}  [WebMCP] ${name}(${JSON.stringify(input)})\n-> ${result}`);
}

/**
 * Wraps a handler function as a WebMCP tool descriptor.
 *
 * @param {string}   name        - Tool name exposed to the MCP client
 * @param {string}   description - Human-readable description
 * @param {object}   inputSchema - JSON Schema for the tool's input
 * @param {Function} handler     - async (input, client) => any
 * @param {boolean}  readOnly    - Hint to the client that this tool has no side effects
 */
function tool(name, description, inputSchema, handler, readOnly = false) {
  return {
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: readOnly },
    async execute(input, client) {
      let text;
      try {
        text = JSON.stringify(await handler(input ?? {}, client));
      } catch (err) {
        text = JSON.stringify({ error: String(err.message || err) });
      }
      log(name, input, text);
      return { content: [{ type: 'text', text }] };
    },
  };
}

// ---------------------------------------------------------------------------
// WebMCP tool definitions
// These run inside the page so they can call the REST API and update the UI
// in one step, keeping what the agent sees and what the user sees in sync.
// ---------------------------------------------------------------------------
const tools = [
  tool(
    'list_tasks',
    'List all tasks with their id, title and done status.',
    { type: 'object', properties: {} },
    () => load(),
    true, // read-only
  ),

  tool(
    'add_task',
    'Add a new task to the todo list.',
    {
      type: 'object',
      properties: { title: { type: 'string', description: 'Task title' } },
      required: ['title'],
    },
    ({ title }) => addTask(title),
  ),

  tool(
    'set_task_done',
    'Mark a task as done or not done.',
    {
      type: 'object',
      properties: {
        id:   { type: 'number',  description: 'Task id from list_tasks' },
        done: { type: 'boolean', description: 'true = done, false = not done' },
      },
      required: ['id', 'done'],
    },
    ({ id, done }) => setTaskDone(id, done),
  ),

  tool(
    'delete_task',
    'Delete a task by id.',
    {
      type: 'object',
      properties: { id: { type: 'number', description: 'Task id' } },
      required: ['id'],
    },
    ({ id }) => deleteTask(id),
  ),

  // Human-in-the-loop: the agent is paused while the user confirms via dialog.
  tool(
    'clear_completed',
    'Delete all completed tasks. Asks the user to confirm first.',
    { type: 'object', properties: {} },
    async (_input, client) => {
      const ask = () => confirm('An agent wants to delete all completed tasks. Allow?');
      // Use client.requestUserInteraction when available (suspends the agent);
      // fall back to a plain confirm() for environments without it.
      const confirmed = client?.requestUserInteraction
        ? await client.requestUserInteraction(ask)
        : await ask();
      if (!confirmed) return { cleared: 0, reason: 'User declined' };
      return clearCompleted();
    },
  ),
];

// ---------------------------------------------------------------------------
// WebMCP registration
// Chrome 150+ exposes the API on document.modelContext (navigator.modelContext
// is deprecated). We try document first, then navigator.
// ---------------------------------------------------------------------------
function getModelContext() {
  if (document.modelContext)  return { ctx: document.modelContext,  where: 'document' };
  if (navigator.modelContext) return { ctx: navigator.modelContext, where: 'navigator' };
  return null;
}

async function registerAll() {
  const found = getModelContext();
  if (!found) {
    console.warn(
      '[WebMCP] modelContext not found. Enable the WebMCP flag at chrome://flags/#enable-webmcp-testing ' +
      'and open the page via http://localhost. The app works as a normal todo list without it.',
    );
    return;
  }

  try {
    // registerTool may return a Promise (newer Chrome) or undefined (older) — await handles both.
    for (const t of tools) await found.ctx.registerTool(t);
    console.log(
      `[WebMCP] active via ${found.where}.modelContext — ` +
      `${tools.length} tools registered: ${tools.map((t) => t.name).join(', ')}.`,
    );
  } catch (err) {
    console.error(`[WebMCP] tool registration failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
load().catch((err) => showError(`Could not load tasks: ${err.message}`));
registerAll();

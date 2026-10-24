// Backend MCP server — same five tools as the WebMCP (frontend) side.
// All operations go through the REST API so both clients share exactly one
// code path, one validation layer, and one source of truth.
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// REST helper
// Calls the local REST API. baseUrl is injected by createMcpServer() so the
// port is read from the environment in one place (server.js).
// ---------------------------------------------------------------------------
function makeApi(baseUrl) {
  return async function api(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body:    body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };
}

// ---------------------------------------------------------------------------
// Handler factory
// Wraps an API call: logs it to stderr and converts errors to MCP tool errors.
// ---------------------------------------------------------------------------
function handler(name, fn) {
  return async (input) => {
    console.error(`[backend-mcp] ${name} ${JSON.stringify(input ?? {})}`);
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await fn(input)) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
  };
}

// ---------------------------------------------------------------------------
// MCP server factory
// Accepts the base URL of the REST API so it can be passed in from server.js.
// ---------------------------------------------------------------------------
export function createMcpServer(baseUrl) {
  const api = makeApi(baseUrl);
  const server = new McpServer({ name: 'todo-backend', version: '1.0.0' });

  server.registerTool(
    'list_tasks',
    {
      description: 'List all tasks with their id, title and done status.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    handler('list_tasks', () => api('GET', '/api/tasks').then((d) => d.tasks)),
  );

  server.registerTool(
    'add_task',
    {
      description: 'Add a new task to the todo list.',
      inputSchema: z.object({ title: z.string().describe('Task title') }),
    },
    handler('add_task', ({ title }) => api('POST', '/api/tasks', { title })),
  );

  server.registerTool(
    'set_task_done',
    {
      description: 'Mark a task as done or not done.',
      inputSchema: z.object({
        id:   z.number().describe('Task id from list_tasks'),
        done: z.boolean().describe('true = done, false = not done'),
      }),
    },
    handler('set_task_done', ({ id, done }) => api('PATCH', `/api/tasks/${id}`, { done })),
  );

  server.registerTool(
    'delete_task',
    {
      description: 'Delete a task by id.',
      inputSchema: z.object({ id: z.number().describe('Task id') }),
    },
    handler('delete_task', ({ id }) => api('DELETE', `/api/tasks/${id}`)),
  );

  server.registerTool(
    'clear_completed',
    {
      description: 'Delete all completed tasks.',
      inputSchema: z.object({}),
    },
    handler('clear_completed', () => api('POST', '/api/tasks/clear-completed')),
  );

  return server;
}

// JSON-file storage shared by the REST API and the backend MCP server.
// All mutations go through one promise queue and are written atomically.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const FILE = path.join(DATA_DIR, 'tasks.json');
const TMP = FILE + '.tmp';

let queue = Promise.resolve();

// Run fn after all previously queued operations, even if earlier ones failed.
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function readState() {
  try {
    const state = JSON.parse(await fs.readFile(FILE, 'utf8'));
    if (!Array.isArray(state.tasks) || typeof state.nextId !== 'number') throw new Error('bad shape');
    return state;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[store] tasks.json unreadable, resetting:', err.message);
    const fresh = { nextId: 1, tasks: [] };
    await writeState(fresh);
    return fresh;
  }
}

async function writeState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TMP, JSON.stringify(state, null, 2));
  await fs.rename(TMP, FILE);
}

function findTask(state, id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) throw new NotFoundError(`No task with id ${id}`);
  return task;
}

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

export const listTasks = () => enqueue(async () => (await readState()).tasks);

export const addTask = (title) =>
  enqueue(async () => {
    const clean = typeof title === 'string' ? title.trim() : '';
    if (!clean) throw new ValidationError('title must be a non-empty string');
    const state = await readState();
    const task = { id: state.nextId++, title: clean, done: false, createdAt: new Date().toISOString() };
    state.tasks.push(task);
    await writeState(state);
    return task;
  });

export const setTaskDone = (id, done) =>
  enqueue(async () => {
    if (typeof done !== 'boolean') throw new ValidationError('done must be a boolean');
    const state = await readState();
    const task = findTask(state, id);
    task.done = done;
    await writeState(state);
    return task;
  });

export const deleteTask = (id) =>
  enqueue(async () => {
    const state = await readState();
    findTask(state, id);
    state.tasks = state.tasks.filter((t) => t.id !== id);
    await writeState(state);
    return { deleted: id };
  });

export const clearCompleted = () =>
  enqueue(async () => {
    const state = await readState();
    const before = state.tasks.length;
    state.tasks = state.tasks.filter((t) => !t.done);
    await writeState(state);
    return { cleared: before - state.tasks.length };
  });

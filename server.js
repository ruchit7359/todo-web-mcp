import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NodeStreamableHTTPServerTransport,
  localhostHostValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/node';
import * as store from './store.js';
import { createMcpServer } from './mcp-server.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;
const app = express();

app.use(express.json());
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));

// ---------- REST API (used by the web page) ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const parseId = (req) => Number(req.params.id);

app.get('/api/tasks', wrap(async (_req, res) => {
  res.json({ tasks: await store.listTasks(), serverTime: new Date().toISOString() });
}));

app.post('/api/tasks', wrap(async (req, res) => {
  res.status(201).json(await store.addTask(req.body?.title));
}));

app.post('/api/tasks/clear-completed', wrap(async (_req, res) => {
  res.json(await store.clearCompleted());
}));

app.patch('/api/tasks/:id', wrap(async (req, res) => {
  res.json(await store.setTaskDone(parseId(req), req.body?.done));
}));

app.delete('/api/tasks/:id', wrap(async (req, res) => {
  res.json(await store.deleteTask(parseId(req)));
}));

// ---------- Backend MCP (Streamable HTTP, stateless) ----------
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

app.post('/mcp', async (req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
  const server = createMcpServer(BASE_URL);
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[backend-mcp] error:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

const methodNotAllowed = (_req, res) =>
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server)' }, id: null });
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

// ---------- Error handler ----------
app.use((err, _req, res, _next) => {
  const status = err instanceof store.NotFoundError ? 404 : err instanceof store.ValidationError ? 400 : 500;
  if (status === 500) console.error('[server] error:', err);
  res.status(status).json({ error: err.message });
});

app.listen(PORT, HOST, () => {
  console.error(`Web page:    http://localhost:${PORT}`);
  console.error(`REST API:    http://localhost:${PORT}/api/tasks`);
  console.error(`Backend MCP: http://localhost:${PORT}/mcp`);
});

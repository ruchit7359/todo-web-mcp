# WebMCP vs Backend MCP: Todo POC

A single-page todo app on localhost that exposes the **same five tools** two ways, so you can see the difference:

| | Backend MCP (`/mcp`) | WebMCP (in the page) |
|---|---|---|
| Tool code runs in | Node server | Browser tab |
| Changes | Saved data only | Live page state **and** saved data |
| Open page updates? | **No**, stale until Refresh | **Yes**, instantly (row flashes) |
| Browser needs to be open? | No | Yes |

Tasks are saved in `data/tasks.json`, so they survive page refreshes and server restarts.

## Demo

**Backend MCP**: the page stays stale until Refresh.

![Backend MCP demo](video/ServerMCP.gif)

**WebMCP**: the page updates instantly.

![WebMCP demo](video/WebMCP.gif)

## Run

```
npm install
npm start
```

- Web page: http://localhost:3000
- REST API: http://localhost:3000/api/tasks
- Backend MCP: http://localhost:3000/mcp (Streamable HTTP, stateless)

The server binds to `127.0.0.1` only. Set `PORT` to change the port.

## Tools

| Tool | Read-only | Input |
|---|---|---|
| `list_tasks` | yes | none |
| `add_task` | no | `{ "title": string }` |
| `set_task_done` | no | `{ "id": number, "done": boolean }` |
| `delete_task` | no | `{ "id": number }` |
| `clear_completed` | no | none (WebMCP version asks the user to confirm) |

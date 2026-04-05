# No Rake

Play-chip Texas hold’em for private tables (friends/family). Not real money; **no rake** as in no host cut—social stakes only. Target capabilities include room links, auto top-off, and configurable bet sizing. **Status:** pre-MVP / scaffold not landed yet.

## Stack

- **Client:** Vite, React, TypeScript (`client/`)
- **Server:** Node.js, Fastify, `@fastify/websocket` (`server/`)
- **Persistence:** in-memory for now; SQLite later

## Local development

From the repo root:

1. **`npm install`** — npm’s **workspaces** install dependencies for the root, `client/`, and `server/` in one go (one lockfile at the root).

2. **`npm run dev`** — runs two processes in parallel (**concurrently**):
   - **server:** `tsx watch src/index.ts` → HTTP + WebSocket on port **3000** (override with `PORT`).
   - **client:** Vite dev server on **5173** (default).

3. Open **http://localhost:5173** — the page opens a WebSocket to **`ws://localhost:3000/ws`**. To override, copy `client/.env.example` to `client/.env.development` (gitignored) and edit `VITE_WS_URL`.

4. **Checks:** browser should show socket state `open` and a JSON `hello` line; **Send test message** should echo back. **`GET http://localhost:3000/health`** returns `{"ok":true}`.

**Why two ports:** Vite only serves the React app; game authority stays on the Fastify process. Production later will likely serve built static files from the same host as the API or behind one domain.

## Development model

Implementation (source, tests, CI, most docs) is **LLM-generated under maintainer direction** (Cursor and similar). The maintainer sets product behavior, accepts or rejects changes, runs deploys, and holds secrets. **Third parties should review before relying on this codebase.**

| Responsibility | Maintainer | Coding agent |
|----------------|------------|----------------|
| Product rules, UX intent, poker semantics | Yes | — |
| Code, configs, boilerplate, most README text | Rare direct edits | Primary |
| Local run, hosting, env vars, production checks | Yes | Suggests only |
| Security and correctness validation | Maintainer | No guarantee |

Revise this section if the split changes materially.

**Snapshot (2026-04-05):** Client + server scaffold, WebSocket smoke test UI, no poker logic. Tooling: Cursor. Code review: minimal.

## License

TBD.

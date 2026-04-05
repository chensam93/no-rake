# No Rake

Play-chip Texas hold’em for private tables (friends/family). Not real money; **no rake** as in no host cut—social stakes only. Target capabilities include room links, auto top-off, and configurable bet sizing. **Status:** incremental setup (rebuilding the codebase step by step).

## Stack

- **Server:** Node.js + **Fastify** in `server/` (plain **JavaScript** for now; TypeScript can come later).

### Run the server (step 2)

```bash
cd server
npm install
npm run dev
```

Then open **http://127.0.0.1:3000/health** — expect JSON `{"ok":true}`.  
Set **`PORT`** to use another port (environment variable).

## Development model

Implementation (source, tests, CI, most docs) is **LLM-generated under maintainer direction** (Cursor and similar). The maintainer sets product behavior, accepts or rejects changes, runs deploys, and holds secrets. **Third parties should review before relying on this codebase.**

| Responsibility | Maintainer | Coding agent |
|----------------|------------|----------------|
| Product rules, UX intent, poker semantics | Yes | — |
| Code, configs, boilerplate, most README text | Rare direct edits | Primary |
| Local run, hosting, env vars, production checks | Yes | Suggests only |
| Security and correctness validation | Maintainer | No guarantee |

Revise this section if the split changes materially.

**Snapshot (2026-04-05):** Root `package.json` + `.gitignore`; `server/` with Fastify + `GET /health`. No client yet. Tooling: Cursor. Code review: minimal.

## License

TBD.

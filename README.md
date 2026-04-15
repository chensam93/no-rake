# No Rake

Play-chip Texas hold’em for private tables (friends/family). Not real money; **no rake** as in no host cut—social stakes only. Target capabilities include room links, auto top-off, and configurable bet sizing. **Status:** incremental setup (rebuilding the codebase step by step).

## Stack

- **Server:** Node.js + **Fastify** + **`@fastify/websocket`** in `server/` (plain **JavaScript** for now).

### Run the server (step 2)

```bash
cd server
npm install
npm run dev
```

Then open **http://127.0.0.1:3000/health** — expect JSON `{"ok":true}`.  
Set **`PORT`** to use another port (environment variable).

### WebSocket (step 3)

With **`npm run dev`** still running, **`ws://127.0.0.1:3000/ws`** is the socket URL. On connect, the server sends a JSON **`hello`** message; any text you send is echoed as **`echo`**.

Quick check from **`server/`** (uses the **`ws`** library already pulled in as a dependency):

```bash
node --input-type=module -e "import WebSocket from 'ws'; const w=new WebSocket('ws://127.0.0.1:3000/ws'); w.on('message',d=>console.log(d.toString())); w.on('open',()=>w.send('ping'));"
```

### Browser smoke page (step 4)

With the server running, open **http://127.0.0.1:3000/**.  
That page opens `ws://127.0.0.1:3000/ws`, logs events, and has a **Send ping** button.

### In-memory room join (step 5)

Server now supports JSON message:

```json
{ "type": "join_room", "roomId": "home", "playerName": "sam" }
```

On success:
- client gets `joined_room`
- everyone in that room gets `room_state` with current player list
- disconnect removes the player and republishes `room_state`

### Seat assignment (step 6)

After joining, client can send:

```json
{ "type": "sit_down", "seatNumber": 3 }
```

Rules right now:
- valid seats are integers `1..9`
- seat must be free in that room
- client must `join_room` first

On success:
- client gets `sat_down`
- room gets updated `room_state` with `playerName` + `seatNumber`

## Development model

Implementation (source, tests, CI, most docs) is **LLM-generated under maintainer direction** (Cursor and similar). The maintainer sets product behavior, accepts or rejects changes, runs deploys, and holds secrets. **Third parties should review before relying on this codebase.**

| Responsibility | Maintainer | Coding agent |
|----------------|------------|----------------|
| Product rules, UX intent, poker semantics | Yes | — |
| Code, configs, boilerplate, most README text | Rare direct edits | Primary |
| Local run, hosting, env vars, production checks | Yes | Suggests only |
| Security and correctness validation | Maintainer | No guarantee |

Revise this section if the split changes materially.

**Snapshot (2026-04-05):** `server/` — Fastify, `GET /health`, `GET /` smoke page, **`GET /ws`** with `join_room`, `sit_down`, and room_state broadcast (in memory). Tooling: Cursor. Code review: minimal.

## License

TBD.

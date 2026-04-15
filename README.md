# No Rake

Play-chip Texas hold?em for private tables (friends/family). Not real money; **no rake** as in no host cut?social stakes only. Target capabilities include room links, auto top-off, and configurable bet sizing. **Status:** incremental setup (rebuilding the codebase step by step).

## Stack

- **Server:** Node.js + Fastify + `@fastify/websocket` in `server/`
- **Client:** React + Vite in `client/`
- **State:** in memory (single server process)

## Local run

### One command (recommended)

From repo root:

```bash
npm install
npm run dev
```

- client UI: `http://127.0.0.1:5173`
- server health: `http://127.0.0.1:3000/health`

### Server only

```bash
cd server
npm install
npm run dev
```

### Client only

```bash
cd client
npm install
npm run dev
```

Set websocket URL by copying `client/.env.example` to `client/.env.development` and editing `VITE_WS_URL`.

## Protocol implemented so far

- `join_room`
- `sit_down`
- `start_round`
- `player_action` (`check`, `call`, `fold`, `bet`, `raise_to`)
- room broadcast: `room_state` with player seats/stacks and round metadata (`street`, `board`, `pot`, blind seats, `pendingSeatNumbers`, `currentBet`, `minRaiseTo`)

Current betting-round behavior:
- round auto-ends with reason `betting_complete` when all active seats have responded to the latest bet/raise
- round auto-ends with reason `fold_winner` when one active seat remains

Current hand/street behavior:
- `start_round` posts blinds automatically from table config
- round starts on `preflop`
- when betting settles before river, server auto-advances streets (`flop` -> `turn` -> `river`) and updates `board`
- after river betting settles, round ends with `showdown_pending` (winner evaluation not implemented yet)

## Development model

Implementation (source, tests, CI, most docs) is **LLM-generated under maintainer direction** (Cursor and similar). The maintainer sets product behavior, accepts or rejects changes, runs deploys, and holds secrets. **Third parties should review before relying on this codebase.**

| Responsibility | Maintainer | Coding agent |
|----------------|------------|----------------|
| Product rules, UX intent, poker semantics | Yes | ? |
| Code, configs, boilerplate, most README text | Rare direct edits | Primary |
| Local run, hosting, env vars, production checks | Yes | Suggests only |
| Security and correctness validation | Maintainer | No guarantee |

Revise this section if the split changes materially.

**Snapshot (2026-04-15):** Browser client exists (`client/`) and can run through a full preflop/flop/turn/river skeleton with blinds, basic betting, and street auto-advance. Showdown winner logic is not implemented yet.

## License

TBD.

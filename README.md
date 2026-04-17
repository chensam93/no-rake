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
- `set_auto_deal`
- `player_action` (`check`, `call`, `fold`, `bet`, `raise_to`)
- room broadcast: `room_state` with player seats/stacks and round metadata (`street`, `board`, `pot`, blind seats, `pendingSeatNumbers`, `currentBet`, `minRaiseTo`, showdown/payout metadata after hand end)
- hand lifecycle events: `street_advanced`, `round_ended`

Current betting-round behavior:
- round auto-ends with reason `betting_complete` when all active seats have responded to the latest bet/raise
- round auto-ends with reason `fold_winner` when one active seat remains

Current hand/street behavior:
- `start_round` posts blinds automatically from table config
- round starts on `preflop`
- when betting settles before river, server auto-advances streets (`flop` -> `turn` -> `river`) and updates `board`
- after river betting settles, round resolves at showdown with payout metadata
- side-pot distribution for uneven all-ins is implemented

## Rules and smoke checks

- deterministic rules harness: `npm run simulate:round -w server`
- two-player smoke hand: `npm run smoke:two-player -w server`
- combined server rules checks: `npm run test:rules -w server`
- client bot-decision logic check: `npm run test:bot-decision -w client`

## Test suite

- full suite (server + client): `npm test`
- faster suite (skip client lint): `npm run test:quick`
- server checks only: `npm run test:server`
- client checks only: `npm run test:client`

## Secret scanning

- local pre-commit hook lives at `.githooks/pre-commit`
- CI scan runs in `.github/workflows/secret-scan.yml`
- gitleaks config lives at `.gitleaks.toml`

One-time local setup in this repo:

```bash
git config core.hooksPath .githooks
```

Optional (better local detection): install `gitleaks` so the hook runs `gitleaks protect --staged` instead of fallback regex scanning.

## Deploy and operations

- deployment checklist and troubleshooting runbook: `docs/deploy_runbook.md`

## Development model

Implementation (source, tests, CI, most docs) is **LLM-generated under maintainer direction** (Cursor and similar). The maintainer sets product behavior, accepts or rejects changes, runs deploys, and holds secrets. **Third parties should review before relying on this codebase.**

| Responsibility | Maintainer | Coding agent |
|----------------|------------|----------------|
| Product rules, UX intent, poker semantics | Yes | ? |
| Code, configs, boilerplate, most README text | Rare direct edits | Primary |
| Local run, hosting, env vars, production checks | Yes | Suggests only |
| Security and correctness validation | Maintainer | No guarantee |

Revise this section if the split changes materially.

**Snapshot (2026-04-15):** Browser client exists (`client/`) and supports full-hand progression with showdown evaluation, uneven-stack side pots, host auto-deal controls, and deterministic rules smoke checks.

## License

TBD.

# Deploy Runbook

## Scope
- Private home-game deployment for low-traffic use.
- Single server process for websocket game state.
- Optional static client hosting or local Vite preview.

## Runtime Configuration

| Variable | Component | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | server | `3000` | Server listen port for `/health` and `/ws` |
| `VITE_WS_URL` | client | `ws://127.0.0.1:3000/ws` | Websocket endpoint used by browser client |

## Startup Paths

### Local development
- Root: `npm run dev`
- Server only: `npm run dev:server`
- Client only: `npm run dev:client`

### Production-style server start
- Server workspace: `npm run start -w server`

### Deterministic rules verification
- Server workspace: `npm run simulate:round -w server`

## Pre-Deploy Checklist
- Install dependencies: `npm install`
- Run deterministic rules script and confirm `simulate-round: all assertions passed`
- Confirm server starts on target port and `/health` returns HTTP 200
- Confirm a browser can connect and join/sit/start a hand

## Post-Deploy Sanity Checks
- Open two browser sessions and complete one hand end-to-end
- Verify `round_ended` flow includes winner, payouts, and pot breakdown
- Verify next hand can be started and auto-deal host toggle still functions

## Troubleshooting

### Websocket not connecting
- Confirm server is running and listening on expected `PORT`
- Confirm client `VITE_WS_URL` points to reachable `/ws` endpoint
- Confirm local firewall/network rules allow inbound traffic to server port

### Port already in use
- Start server on a different port: `PORT=3010 node src/index.js` (PowerShell: `$env:PORT='3010'; node src/index.js`)
- Update client websocket URL to matching port

### Rules script timeout or fail
- Re-run with clean server process
- Verify server logs for rejected actions or unexpected room state
- Treat a failing deterministic script as a release blocker

## Operational Notes
- State is currently in-memory. Server restart clears active room state.
- There is no persistent database checkpoint yet.

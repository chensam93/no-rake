import { useEffect, useRef, useState } from "react";
import "./App.css";

const DEFAULT_WS_URL = "ws://127.0.0.1:3000/ws";
const WS_URL = import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;

function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function App() {
  const wsRef = useRef(null);
  const [connectionState, setConnectionState] = useState("connecting");
  const [events, setEvents] = useState([]);
  const [roomId, setRoomId] = useState("home");
  const [playerName, setPlayerName] = useState("player");
  const [seatNumber, setSeatNumber] = useState(1);
  const [amount, setAmount] = useState(40);
  const [roomState, setRoomState] = useState(null);
  const [lastError, setLastError] = useState(null);

  const appendEvent = (line) => {
    setEvents((prev) => [...prev.slice(-79), line]);
  };

  const sendJson = (payload, label) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      appendEvent("[local] blocked: websocket not open");
      return;
    }

    ws.send(JSON.stringify(payload));
    appendEvent(`[out] ${label}`);
  };

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState("open");
      appendEvent("[local] websocket open");
    };

    ws.onclose = () => {
      setConnectionState("closed");
      appendEvent("[local] websocket closed");
      wsRef.current = null;
    };

    ws.onerror = () => {
      setConnectionState("error");
      appendEvent("[local] websocket error");
    };

    ws.onmessage = (event) => {
      appendEvent(`[in] ${event.data}`);

      let parsed;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      if (parsed.type === "room_state") {
        setRoomState(parsed);
      }

      if (parsed.type === "error") {
        setLastError(parsed.message);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  const seats = Array.from({ length: 9 }, (_, index) => index + 1);
  const seatOwners = new Map();
  if (roomState?.players) {
    for (const player of roomState.players) {
      if (player.seatNumber !== null) {
        seatOwners.set(player.seatNumber, player.playerName);
      }
    }
  }

  return (
    <main className="app-shell">
      <header>
        <h1>No Rake</h1>
        <p className="sub">Playable dev UI (join, seat, start round, actions, bet sizing)</p>
      </header>

      <section className="card">
        <h2>Connection</h2>
        <p>
          WebSocket: <code>{WS_URL}</code>
        </p>
        <p>
          Status: <strong>{connectionState}</strong>
        </p>
      </section>

      <section className="card controls">
        <h2>Player Controls</h2>
        <div className="row">
          <label>
            Room
            <input value={roomId} onChange={(event) => setRoomId(event.target.value)} />
          </label>
          <label>
            Name
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
            />
          </label>
          <label>
            Seat
            <input
              type="number"
              min={1}
              max={9}
              value={seatNumber}
              onChange={(event) => setSeatNumber(Number(event.target.value || 1))}
            />
          </label>
          <label>
            Amount
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(event) => setAmount(Number(event.target.value || 1))}
            />
          </label>
        </div>

        <div className="row buttons">
          <button onClick={() => sendJson({ type: "join_room", roomId, playerName }, "join_room")}>Join room</button>
          <button onClick={() => sendJson({ type: "sit_down", seatNumber }, "sit_down")}>Sit down</button>
          <button onClick={() => sendJson({ type: "start_round" }, "start_round")}>Start round</button>
          <button onClick={() => sendJson({ type: "player_action", actionType: "check" }, "player_action:check")}>Check</button>
          <button onClick={() => sendJson({ type: "player_action", actionType: "call" }, "player_action:call")}>Call</button>
          <button
            onClick={() =>
              sendJson(
                { type: "player_action", actionType: "bet", amount },
                "player_action:bet",
              )
            }
          >
            Bet
          </button>
          <button
            onClick={() =>
              sendJson(
                { type: "player_action", actionType: "raise_to", amount },
                "player_action:raise_to",
              )
            }
          >
            Raise To
          </button>
          <button onClick={() => sendJson({ type: "player_action", actionType: "fold" }, "player_action:fold")}>Fold</button>
          <button
            onClick={() => {
              const ws = wsRef.current;
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send("ping-" + Date.now());
                appendEvent("[out] ping-*");
              }
            }}
          >
            Ping (text)
          </button>
        </div>

        {lastError ? <p className="error">Last server error: {lastError}</p> : null}
      </section>

      <section className="card">
        <h2>Seats</h2>
        <div className="seat-grid">
          {seats.map((seat) => (
            <div key={seat} className="seat">
              <div className="seat-number">Seat {seat}</div>
              <div className="seat-player">{seatOwners.get(seat) || "open"}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Players</h2>
        {roomState?.players?.length ? (
          <table className="players-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Seat</th>
                <th>Stack</th>
                <th>Committed</th>
              </tr>
            </thead>
            <tbody>
              {roomState.players.map((player) => (
                <tr key={`${player.playerName}-${player.seatNumber ?? "none"}`}>
                  <td>{player.playerName}</td>
                  <td>{player.seatNumber ?? "open"}</td>
                  <td>{player.stack}</td>
                  <td>{player.committedThisRound}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No players yet.</p>
        )}
      </section>

      <section className="card state-grid">
        <div>
          <h2>Round</h2>
          {roomState?.round ? (
            <ul>
              <li>inProgress: {String(roomState.round.inProgress)}</li>
              <li>turnSeatNumber: {String(roomState.round.turnSeatNumber)}</li>
              <li>currentBet: {roomState.round.currentBet}</li>
              <li>minRaiseTo: {String(roomState.round.minRaiseTo)}</li>
              <li>folded: {roomState.round.foldedSeatNumbers.join(", ") || "none"}</li>
            </ul>
          ) : (
            <p>No round state yet.</p>
          )}
        </div>
        <div>
          <h2>Raw room_state</h2>
          <pre>{roomState ? prettyJson(roomState) : "waiting for room_state..."}</pre>
        </div>
      </section>

      <section className="card">
        <h2>Event Log</h2>
        <pre>{events.length > 0 ? events.join("\n") : "waiting..."}</pre>
      </section>
    </main>
  );
}

export default App;


import websocket from "@fastify/websocket";
import Fastify from "fastify";

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT) || 3000;
const OPEN = 1;
const MAX_SEATS = 9;

const rooms = new Map();

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      members: new Set(),
      playersBySocket: new Map(),
    });
  }

  return rooms.get(roomId);
}

function removeSocketFromRoom(roomId, socket) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.members.delete(socket);
  room.playersBySocket.delete(socket);

  if (room.members.size === 0) {
    rooms.delete(roomId);
  }
}

function publishRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const players = [...room.playersBySocket.values()].sort((left, right) => {
    if (left.seatNumber === null && right.seatNumber === null) return 0;
    if (left.seatNumber === null) return 1;
    if (right.seatNumber === null) return -1;
    return left.seatNumber - right.seatNumber;
  });
  const payload = {
    type: "room_state",
    roomId,
    players,
  };

  for (const member of room.members) {
    if (member.readyState === OPEN) {
      sendJson(member, payload);
    }
  }
}

await app.register(websocket);

app.get("/health", async () => ({ ok: true }));

app.get("/", async () => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>No Rake - WS smoke page</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
      pre { background: #f5f5f5; padding: 0.75rem; border-radius: 6px; min-height: 8rem; }
      button { padding: 0.5rem 0.75rem; }
      code { background: #f0f0f0; padding: 0.1rem 0.25rem; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>No Rake</h1>
    <p>Step 6 browser smoke test for room join + seat assignment.</p>
    <p>Socket URL: <code>ws://127.0.0.1:${PORT}/ws</code></p>
    <div>
      <label>Room <input id="room" value="home" /></label>
      <label>Name <input id="name" value="player" /></label>
      <label>Seat <input id="seat" value="1" type="number" min="1" max="9" /></label>
    </div>
    <button id="join">Join room</button>
    <button id="sit">Sit down</button>
    <button id="send">Send ping</button>
    <pre id="log">waiting...</pre>
    <script>
      const log = document.getElementById("log");
      const ws = new WebSocket("ws://127.0.0.1:${PORT}/ws");
      const line = (msg) => {
        log.textContent = log.textContent === "waiting..." ? msg : log.textContent + "\\n" + msg;
      };
      ws.onopen = () => line("[open]");
      ws.onmessage = (ev) => line("[in] " + ev.data);
      ws.onclose = () => line("[close]");
      ws.onerror = () => line("[error]");
      document.getElementById("join").onclick = () => {
        const roomId = document.getElementById("room").value.trim();
        const playerName = document.getElementById("name").value.trim();
        ws.send(JSON.stringify({ type: "join_room", roomId, playerName }));
        line("[out] join_room");
      };
      document.getElementById("sit").onclick = () => {
        const seatNumber = Number(document.getElementById("seat").value);
        ws.send(JSON.stringify({ type: "sit_down", seatNumber }));
        line("[out] sit_down");
      };
      document.getElementById("send").onclick = () => {
        ws.send("ping-" + Date.now());
        line("[out] ping");
      };
    </script>
  </body>
</html>`);

app.get("/ws", { websocket: true }, (socket) => {
  const session = {
    roomId: null,
    playerName: null,
  };

  sendJson(socket, {
    type: "hello",
    message: "no-rake",
    supportedMessages: ["join_room", "sit_down", "ping-*"],
  });

  socket.on("message", (raw) => {
    const text = typeof raw === "string" ? raw : raw.toString();

    if (text.startsWith("ping-")) {
      sendJson(socket, { type: "echo", body: text });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      sendJson(socket, { type: "error", message: "invalid JSON payload" });
      return;
    }

    if (parsed.type === "join_room") {
      const roomId = parsed.roomId?.trim();
      const playerName = parsed.playerName?.trim();

      if (!roomId || !playerName) {
        sendJson(socket, {
          type: "error",
          message: "join_room requires roomId and playerName",
        });
        return;
      }

      if (session.roomId) {
        removeSocketFromRoom(session.roomId, socket);
        publishRoomState(session.roomId);
      }

      session.roomId = roomId;
      session.playerName = playerName;

      const room = getOrCreateRoom(roomId);
      room.members.add(socket);
      room.playersBySocket.set(socket, {
        playerName,
        seatNumber: null,
      });

      sendJson(socket, {
        type: "joined_room",
        roomId,
        playerName,
      });

      publishRoomState(roomId);
      return;
    }

    if (parsed.type === "sit_down") {
      if (!session.roomId || !session.playerName) {
        sendJson(socket, {
          type: "error",
          message: "join_room before sit_down",
        });
        return;
      }

      const seatNumber = Number(parsed.seatNumber);
      if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > MAX_SEATS) {
        sendJson(socket, {
          type: "error",
          message: `seatNumber must be an integer between 1 and ${MAX_SEATS}`,
        });
        return;
      }

      const room = rooms.get(session.roomId);
      if (!room) {
        sendJson(socket, { type: "error", message: "room not found" });
        return;
      }

      for (const [memberSocket, player] of room.playersBySocket.entries()) {
        if (memberSocket !== socket && player.seatNumber === seatNumber) {
          sendJson(socket, { type: "error", message: "seat already taken" });
          return;
        }
      }

      const currentPlayer = room.playersBySocket.get(socket);
      if (!currentPlayer) {
        sendJson(socket, { type: "error", message: "player not found in room" });
        return;
      }

      currentPlayer.seatNumber = seatNumber;
      sendJson(socket, {
        type: "sat_down",
        roomId: session.roomId,
        playerName: currentPlayer.playerName,
        seatNumber,
      });

      publishRoomState(session.roomId);
      return;
    }

    sendJson(socket, { type: "error", message: "unsupported message type" });
  });

  socket.on("close", () => {
    if (!session.roomId) return;

    const roomId = session.roomId;
    removeSocketFromRoom(roomId, socket);
    publishRoomState(roomId);
  });
});

await app.listen({ port: PORT, host: "0.0.0.0" });

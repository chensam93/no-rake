import websocket from "@fastify/websocket";
import Fastify from "fastify";

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT) || 3000;
const OPEN = 1;
const MAX_SEATS = 9;
const PLAYER_ACTIONS = new Set(["fold", "check", "call"]);

const rooms = new Map();

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      members: new Set(),
      playersBySocket: new Map(),
      hand: {
        inProgress: false,
        turnSeatNumber: null,
        foldedSeatNumbers: new Set(),
        actionLog: [],
      },
    });
  }

  return rooms.get(roomId);
}

function getSortedPlayers(room) {
  return [...room.playersBySocket.values()].sort((left, right) => {
    if (left.seatNumber === null && right.seatNumber === null) return 0;
    if (left.seatNumber === null) return 1;
    if (right.seatNumber === null) return -1;
    return left.seatNumber - right.seatNumber;
  });
}

function getSeatedPlayers(room) {
  return getSortedPlayers(room).filter((player) => player.seatNumber !== null);
}

function getActiveSeatNumbers(room) {
  return getSeatedPlayers(room)
    .map((player) => player.seatNumber)
    .filter((seatNumber) => !room.hand.foldedSeatNumbers.has(seatNumber));
}

function getNextTurnSeatNumber(room, currentSeatNumber) {
  const activeSeatNumbers = getActiveSeatNumbers(room);
  if (activeSeatNumbers.length === 0) return null;

  const currentIndex = activeSeatNumbers.indexOf(currentSeatNumber);
  if (currentIndex === -1) {
    return activeSeatNumbers[0];
  }

  const nextIndex = (currentIndex + 1) % activeSeatNumbers.length;
  return activeSeatNumbers[nextIndex];
}

function maybeResolveHandAfterMembershipChange(room) {
  if (!room.hand.inProgress) return;

  const activeSeatNumbers = getActiveSeatNumbers(room);
  if (activeSeatNumbers.length <= 1) {
    room.hand.inProgress = false;
    room.hand.turnSeatNumber = null;
  } else if (!activeSeatNumbers.includes(room.hand.turnSeatNumber)) {
    room.hand.turnSeatNumber = activeSeatNumbers[0];
  }
}

function removeSocketFromRoom(roomId, socket) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.members.delete(socket);
  room.playersBySocket.delete(socket);
  maybeResolveHandAfterMembershipChange(room);

  if (room.members.size === 0) {
    rooms.delete(roomId);
  }
}

function publishRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const payload = {
    type: "room_state",
    roomId,
    players: getSortedPlayers(room),
    round: {
      inProgress: room.hand.inProgress,
      turnSeatNumber: room.hand.turnSeatNumber,
      foldedSeatNumbers: [...room.hand.foldedSeatNumbers].sort((left, right) => left - right),
      actionLog: room.hand.actionLog,
    },
  };

  for (const member of room.members) {
    if (member.readyState === OPEN) {
      sendJson(member, payload);
    }
  }
}

function startRound(room) {
  const seatedPlayers = getSeatedPlayers(room);
  if (seatedPlayers.length < 2) {
    return { ok: false, message: "need at least 2 seated players" };
  }

  room.hand.inProgress = true;
  room.hand.foldedSeatNumbers.clear();
  room.hand.actionLog = [];
  room.hand.turnSeatNumber = seatedPlayers[0].seatNumber;

  return {
    ok: true,
    turnSeatNumber: room.hand.turnSeatNumber,
  };
}

function renderSmokePage() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>No Rake - WS smoke page</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
      pre { background: #f5f5f5; padding: 0.75rem; border-radius: 6px; min-height: 10rem; }
      button { padding: 0.4rem 0.75rem; }
      code { background: #f0f0f0; padding: 0.1rem 0.25rem; border-radius: 4px; }
      .row { margin-bottom: 0.5rem; }
    </style>
  </head>
  <body>
    <h1>No Rake</h1>
    <p>Step 7 smoke test for room, seat, and simple round flow.</p>
    <p>Socket URL: <code>ws://127.0.0.1:${PORT}/ws</code></p>

    <div class="row">
      <label>Room <input id="room" value="home" /></label>
      <label>Name <input id="name" value="player" /></label>
      <label>Seat <input id="seat" value="1" type="number" min="1" max="9" /></label>
    </div>

    <div class="row">
      <button id="join">Join room</button>
      <button id="sit">Sit down</button>
      <button id="startRound">Start round</button>
      <button id="check">Check</button>
      <button id="call">Call</button>
      <button id="fold">Fold</button>
      <button id="send">Send ping</button>
    </div>

    <pre id="log">waiting...</pre>

    <script>
      const log = document.getElementById("log");
      const ws = new WebSocket("ws://127.0.0.1:${PORT}/ws");

      const line = (message) => {
        log.textContent = log.textContent === "waiting..." ? message : log.textContent + "\\n" + message;
      };

      const send = (payload, label) => {
        ws.send(JSON.stringify(payload));
        line("[out] " + label);
      };

      ws.onopen = () => line("[open]");
      ws.onmessage = (event) => line("[in] " + event.data);
      ws.onclose = () => line("[close]");
      ws.onerror = () => line("[error]");

      document.getElementById("join").onclick = () => {
        send(
          {
            type: "join_room",
            roomId: document.getElementById("room").value.trim(),
            playerName: document.getElementById("name").value.trim(),
          },
          "join_room",
        );
      };

      document.getElementById("sit").onclick = () => {
        send(
          {
            type: "sit_down",
            seatNumber: Number(document.getElementById("seat").value),
          },
          "sit_down",
        );
      };

      document.getElementById("startRound").onclick = () => {
        send({ type: "start_round" }, "start_round");
      };

      document.getElementById("check").onclick = () => {
        send({ type: "player_action", actionType: "check" }, "player_action:check");
      };

      document.getElementById("call").onclick = () => {
        send({ type: "player_action", actionType: "call" }, "player_action:call");
      };

      document.getElementById("fold").onclick = () => {
        send({ type: "player_action", actionType: "fold" }, "player_action:fold");
      };

      document.getElementById("send").onclick = () => {
        ws.send("ping-" + Date.now());
        line("[out] ping");
      };
    </script>
  </body>
</html>`;
}

await app.register(websocket);

app.get("/health", async () => ({ ok: true }));
app.get("/", async () => renderSmokePage());

app.get("/ws", { websocket: true }, (socket) => {
  const session = {
    roomId: null,
    playerName: null,
  };

  sendJson(socket, {
    type: "hello",
    message: "no-rake",
    supportedMessages: [
      "join_room",
      "sit_down",
      "start_round",
      "player_action",
      "ping-*",
    ],
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

      if (room.hand.inProgress) {
        sendJson(socket, {
          type: "error",
          message: "cannot change seats during active round",
        });
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

    if (parsed.type === "start_round") {
      if (!session.roomId) {
        sendJson(socket, { type: "error", message: "join_room before start_round" });
        return;
      }

      const room = rooms.get(session.roomId);
      if (!room) {
        sendJson(socket, { type: "error", message: "room not found" });
        return;
      }

      if (room.hand.inProgress) {
        sendJson(socket, { type: "error", message: "round already in progress" });
        return;
      }

      const result = startRound(room);
      if (!result.ok) {
        sendJson(socket, { type: "error", message: result.message });
        return;
      }

      sendJson(socket, {
        type: "round_started",
        roomId: session.roomId,
        turnSeatNumber: result.turnSeatNumber,
      });

      publishRoomState(session.roomId);
      return;
    }

    if (parsed.type === "player_action") {
      if (!session.roomId || !session.playerName) {
        sendJson(socket, { type: "error", message: "join_room before player_action" });
        return;
      }

      const actionType = parsed.actionType;
      if (!PLAYER_ACTIONS.has(actionType)) {
        sendJson(socket, {
          type: "error",
          message: "player_action actionType must be fold, check, or call",
        });
        return;
      }

      const room = rooms.get(session.roomId);
      if (!room) {
        sendJson(socket, { type: "error", message: "room not found" });
        return;
      }

      if (!room.hand.inProgress) {
        sendJson(socket, { type: "error", message: "no active round" });
        return;
      }

      const currentPlayer = room.playersBySocket.get(socket);
      if (!currentPlayer || currentPlayer.seatNumber === null) {
        sendJson(socket, { type: "error", message: "you are not seated" });
        return;
      }

      if (currentPlayer.seatNumber !== room.hand.turnSeatNumber) {
        sendJson(socket, {
          type: "error",
          message: `not your turn; turnSeatNumber is ${room.hand.turnSeatNumber}`,
        });
        return;
      }

      if (actionType === "fold") {
        room.hand.foldedSeatNumbers.add(currentPlayer.seatNumber);
      }

      room.hand.actionLog.push({
        seatNumber: currentPlayer.seatNumber,
        playerName: currentPlayer.playerName,
        actionType,
      });

      const activeSeatNumbers = getActiveSeatNumbers(room);
      if (activeSeatNumbers.length <= 1) {
        const winnerSeatNumber = activeSeatNumbers[0] ?? null;
        room.hand.inProgress = false;
        room.hand.turnSeatNumber = null;

        sendJson(socket, {
          type: "round_ended",
          roomId: session.roomId,
          winnerSeatNumber,
        });

        publishRoomState(session.roomId);
        return;
      }

      room.hand.turnSeatNumber = getNextTurnSeatNumber(
        room,
        currentPlayer.seatNumber,
      );

      sendJson(socket, {
        type: "action_applied",
        roomId: session.roomId,
        actionType,
        nextTurnSeatNumber: room.hand.turnSeatNumber,
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

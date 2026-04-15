import websocket from "@fastify/websocket";
import Fastify from "fastify";

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT) || 3000;
const OPEN = 1;
const MAX_SEATS = 9;
const STARTING_STACK = 1000;
const STREETS = ["preflop", "flop", "turn", "river"];
const PLAYER_ACTIONS = new Set(["fold", "check", "call", "bet", "raise_to"]);

const rooms = new Map();

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

function buildDeck() {
  const suits = ["c", "d", "h", "s"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

function shuffle(array) {
  const copy = [...array];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = temp;
  }
  return copy;
}

function drawCards(room, count) {
  if (!room.hand.deck || room.hand.deck.length < count) {
    return [];
  }

  return room.hand.deck.splice(0, count);
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      members: new Set(),
      playersBySocket: new Map(),
      table: {
        smallBlind: 10,
        bigBlind: 20,
        dealerSeatNumber: null,
      },
      hand: {
        inProgress: false,
        street: null,
        board: [],
        deck: [],
        pot: 0,
        turnSeatNumber: null,
        dealerSeatNumber: null,
        smallBlindSeatNumber: null,
        bigBlindSeatNumber: null,
        foldedSeatNumbers: new Set(),
        pendingSeatNumbers: new Set(),
        actionLog: [],
        currentBet: 0,
        minRaiseTo: null,
        lastEndReason: null,
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

function getPlayerBySeatNumber(room, seatNumber) {
  for (const player of room.playersBySocket.values()) {
    if (player.seatNumber === seatNumber) {
      return player;
    }
  }

  return null;
}

function getActiveSeatNumbers(room) {
  return getSeatedPlayers(room)
    .map((player) => player.seatNumber)
    .filter((seatNumber) => !room.hand.foldedSeatNumbers.has(seatNumber));
}

function getNextSeatInList(seatNumbers, currentSeatNumber) {
  if (seatNumbers.length === 0) return null;

  const currentIndex = seatNumbers.indexOf(currentSeatNumber);
  if (currentIndex === -1) {
    return seatNumbers[0];
  }

  const nextIndex = (currentIndex + 1) % seatNumbers.length;
  return seatNumbers[nextIndex];
}

function getNextActiveSeatAfter(room, currentSeatNumber) {
  const activeSeatNumbers = getActiveSeatNumbers(room);
  return getNextSeatInList(activeSeatNumbers, currentSeatNumber);
}

function getNextPendingTurnSeatNumber(room, currentSeatNumber) {
  const activeSeatNumbers = getActiveSeatNumbers(room);
  if (activeSeatNumbers.length === 0) return null;

  const pendingSeatNumbers = room.hand.pendingSeatNumbers;
  const seatsNeedingAction = activeSeatNumbers.filter((seatNumber) =>
    pendingSeatNumbers.has(seatNumber),
  );

  if (seatsNeedingAction.length === 0) return null;

  const currentIndex = activeSeatNumbers.indexOf(currentSeatNumber);
  if (currentIndex === -1) {
    return seatsNeedingAction[0];
  }

  for (let step = 1; step <= activeSeatNumbers.length; step += 1) {
    const index = (currentIndex + step) % activeSeatNumbers.length;
    const seatNumber = activeSeatNumbers[index];
    if (pendingSeatNumbers.has(seatNumber)) {
      return seatNumber;
    }
  }

  return seatsNeedingAction[0];
}

function endRound(room, reason, winnerSeatNumber = null) {
  room.hand.inProgress = false;
  room.hand.turnSeatNumber = null;
  room.hand.currentBet = 0;
  room.hand.minRaiseTo = null;
  room.hand.pendingSeatNumbers.clear();
  room.hand.lastEndReason = reason;

  return { reason, winnerSeatNumber };
}

function maybeResolveHandAfterMembershipChange(room) {
  if (!room.hand.inProgress) return;

  const activeSeatNumbers = getActiveSeatNumbers(room);
  for (const pendingSeatNumber of [...room.hand.pendingSeatNumbers]) {
    if (!activeSeatNumbers.includes(pendingSeatNumber)) {
      room.hand.pendingSeatNumbers.delete(pendingSeatNumber);
    }
  }

  if (activeSeatNumbers.length <= 1) {
    endRound(room, "fold_winner", activeSeatNumbers[0] ?? null);
    return;
  }

  if (room.hand.pendingSeatNumbers.size === 0) {
    room.hand.turnSeatNumber = null;
    return;
  }

  if (
    room.hand.turnSeatNumber === null ||
    !activeSeatNumbers.includes(room.hand.turnSeatNumber) ||
    !room.hand.pendingSeatNumbers.has(room.hand.turnSeatNumber)
  ) {
    room.hand.turnSeatNumber = getNextPendingTurnSeatNumber(
      room,
      room.hand.turnSeatNumber ?? activeSeatNumbers[0],
    );
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
      street: room.hand.street,
      board: room.hand.board,
      pot: room.hand.pot,
      dealerSeatNumber: room.hand.dealerSeatNumber,
      smallBlindSeatNumber: room.hand.smallBlindSeatNumber,
      bigBlindSeatNumber: room.hand.bigBlindSeatNumber,
      smallBlind: room.table.smallBlind,
      bigBlind: room.table.bigBlind,
      turnSeatNumber: room.hand.turnSeatNumber,
      foldedSeatNumbers: [...room.hand.foldedSeatNumbers].sort((left, right) => left - right),
      pendingSeatNumbers: [...room.hand.pendingSeatNumbers].sort((left, right) => left - right),
      currentBet: room.hand.currentBet,
      minRaiseTo: room.hand.minRaiseTo,
      lastEndReason: room.hand.lastEndReason,
      actionLog: room.hand.actionLog,
    },
  };

  for (const member of room.members) {
    if (member.readyState === OPEN) {
      sendJson(member, payload);
    }
  }
}

function postBlind(room, seatNumber, amount, blindType) {
  if (seatNumber === null) return;

  const player = getPlayerBySeatNumber(room, seatNumber);
  if (!player) return;

  const blindAmount = Math.min(amount, player.stack);

  player.stack -= blindAmount;
  player.committedThisStreet += blindAmount;
  player.committedThisHand += blindAmount;

  room.hand.pot += blindAmount;
  room.hand.currentBet = Math.max(room.hand.currentBet, player.committedThisStreet);

  room.hand.actionLog.push({
    seatNumber,
    playerName: player.playerName,
    actionType: blindType,
    amountCommitted: blindAmount,
    toCallBeforeAction: 0,
    street: room.hand.street,
  });
}

function startRound(room) {
  const seatedPlayers = getSeatedPlayers(room);
  if (seatedPlayers.length < 2) {
    return { ok: false, message: "need at least 2 seated players" };
  }

  const seatedSeatNumbers = seatedPlayers.map((player) => player.seatNumber);

  let dealerSeatNumber;
  if (
    room.table.dealerSeatNumber === null ||
    !seatedSeatNumbers.includes(room.table.dealerSeatNumber)
  ) {
    dealerSeatNumber = seatedSeatNumbers[0];
  } else {
    dealerSeatNumber = getNextSeatInList(seatedSeatNumbers, room.table.dealerSeatNumber);
  }

  room.table.dealerSeatNumber = dealerSeatNumber;

  const smallBlindSeatNumber = getNextSeatInList(seatedSeatNumbers, dealerSeatNumber);
  const bigBlindSeatNumber = getNextSeatInList(seatedSeatNumbers, smallBlindSeatNumber);

  room.hand.inProgress = true;
  room.hand.street = "preflop";
  room.hand.board = [];
  room.hand.deck = shuffle(buildDeck());
  room.hand.pot = 0;
  room.hand.foldedSeatNumbers.clear();
  room.hand.pendingSeatNumbers = new Set(seatedSeatNumbers);
  room.hand.actionLog = [];
  room.hand.turnSeatNumber = null;
  room.hand.currentBet = 0;
  room.hand.minRaiseTo = null;
  room.hand.lastEndReason = null;
  room.hand.dealerSeatNumber = dealerSeatNumber;
  room.hand.smallBlindSeatNumber = smallBlindSeatNumber;
  room.hand.bigBlindSeatNumber = bigBlindSeatNumber;

  for (const player of room.playersBySocket.values()) {
    player.committedThisStreet = 0;
    player.committedThisHand = 0;
  }

  postBlind(room, smallBlindSeatNumber, room.table.smallBlind, "post_small_blind");
  postBlind(room, bigBlindSeatNumber, room.table.bigBlind, "post_big_blind");

  room.hand.minRaiseTo = room.hand.currentBet + room.table.bigBlind;
  room.hand.turnSeatNumber = getNextActiveSeatAfter(room, bigBlindSeatNumber);

  return {
    ok: true,
    turnSeatNumber: room.hand.turnSeatNumber,
    street: room.hand.street,
  };
}

function getPlayerToCallAmount(room, player) {
  return Math.max(0, room.hand.currentBet - player.committedThisStreet);
}

function maybeEndRoundOnFold(room) {
  const activeSeatNumbers = getActiveSeatNumbers(room);
  if (activeSeatNumbers.length > 1) return null;
  return endRound(room, "fold_winner", activeSeatNumbers[0] ?? null);
}

function advanceStreet(room) {
  const currentStreetIndex = STREETS.indexOf(room.hand.street);
  if (currentStreetIndex === -1 || currentStreetIndex >= STREETS.length - 1) {
    return null;
  }

  const nextStreet = STREETS[currentStreetIndex + 1];

  let drawnCards = [];
  if (nextStreet === "flop") {
    drawnCards = drawCards(room, 3);
  } else {
    drawnCards = drawCards(room, 1);
  }

  room.hand.street = nextStreet;
  room.hand.board.push(...drawnCards);
  room.hand.currentBet = 0;
  room.hand.minRaiseTo = null;

  const activeSeatNumbers = getActiveSeatNumbers(room);
  room.hand.pendingSeatNumbers = new Set(activeSeatNumbers);

  for (const player of room.playersBySocket.values()) {
    player.committedThisStreet = 0;
  }

  room.hand.turnSeatNumber = getNextActiveSeatAfter(room, room.hand.dealerSeatNumber);

  return {
    street: nextStreet,
    boardCards: drawnCards,
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
      input { margin-right: 8px; }
    </style>
  </head>
  <body>
    <h1>No Rake</h1>
    <p>Step 11 smoke test for street progression skeleton.</p>
    <p>Socket URL: <code>ws://127.0.0.1:${PORT}/ws</code></p>

    <div class="row">
      <label>Room <input id="room" value="home" /></label>
      <label>Name <input id="name" value="player" /></label>
      <label>Seat <input id="seat" value="1" type="number" min="1" max="9" /></label>
      <label>Amount <input id="amount" value="40" type="number" min="1" /></label>
    </div>

    <div class="row">
      <button id="join">Join room</button>
      <button id="sit">Sit down</button>
      <button id="startRound">Start round</button>
      <button id="check">Check</button>
      <button id="call">Call</button>
      <button id="bet">Bet</button>
      <button id="raiseTo">Raise To</button>
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

      const amount = () => Number(document.getElementById("amount").value);

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

      document.getElementById("startRound").onclick = () => send({ type: "start_round" }, "start_round");
      document.getElementById("check").onclick = () => send({ type: "player_action", actionType: "check" }, "check");
      document.getElementById("call").onclick = () => send({ type: "player_action", actionType: "call" }, "call");
      document.getElementById("bet").onclick = () => send({ type: "player_action", actionType: "bet", amount: amount() }, "bet");
      document.getElementById("raiseTo").onclick = () => send({ type: "player_action", actionType: "raise_to", amount: amount() }, "raise_to");
      document.getElementById("fold").onclick = () => send({ type: "player_action", actionType: "fold" }, "fold");

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
      "player_action:check/call/fold/bet/raise_to",
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
        stack: STARTING_STACK,
        committedThisStreet: 0,
        committedThisHand: 0,
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
        street: result.street,
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
          message: "actionType must be fold, check, call, bet, or raise_to",
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

      const toCall = getPlayerToCallAmount(room, currentPlayer);
      let amountCommitted = 0;
      let note = null;

      if (actionType === "check") {
        if (toCall > 0) {
          sendJson(socket, {
            type: "error",
            message: `cannot check; call amount is ${toCall}`,
          });
          return;
        }
        room.hand.pendingSeatNumbers.delete(currentPlayer.seatNumber);
      } else if (actionType === "call") {
        if (toCall <= 0) {
          sendJson(socket, {
            type: "error",
            message: "nothing to call; use check",
          });
          return;
        }

        if (currentPlayer.stack < toCall) {
          sendJson(socket, {
            type: "error",
            message: "insufficient stack; all-in not implemented yet",
          });
          return;
        }

        currentPlayer.stack -= toCall;
        currentPlayer.committedThisStreet += toCall;
        currentPlayer.committedThisHand += toCall;
        room.hand.pot += toCall;
        amountCommitted = toCall;
        room.hand.pendingSeatNumbers.delete(currentPlayer.seatNumber);
      } else if (actionType === "bet") {
        if (room.hand.currentBet > 0) {
          sendJson(socket, {
            type: "error",
            message: "bet only allowed when currentBet is 0; use raise_to",
          });
          return;
        }

        const amount = Number(parsed.amount);
        if (!Number.isInteger(amount) || amount <= 0) {
          sendJson(socket, {
            type: "error",
            message: "bet requires a positive integer amount",
          });
          return;
        }

        if (amount > currentPlayer.stack) {
          sendJson(socket, { type: "error", message: "insufficient stack for bet" });
          return;
        }

        currentPlayer.stack -= amount;
        currentPlayer.committedThisStreet += amount;
        currentPlayer.committedThisHand += amount;
        room.hand.pot += amount;

        room.hand.currentBet = currentPlayer.committedThisStreet;
        room.hand.minRaiseTo = room.hand.currentBet * 2;
        amountCommitted = amount;
        note = `currentBet=${room.hand.currentBet}`;

        const activeSeatNumbers = getActiveSeatNumbers(room);
        room.hand.pendingSeatNumbers = new Set(
          activeSeatNumbers.filter(
            (seatNumber) => seatNumber !== currentPlayer.seatNumber,
          ),
        );
      } else if (actionType === "raise_to") {
        if (room.hand.currentBet <= 0) {
          sendJson(socket, {
            type: "error",
            message: "raise_to requires an existing currentBet; use bet first",
          });
          return;
        }

        const targetAmount = Number(parsed.amount);
        if (!Number.isInteger(targetAmount) || targetAmount <= room.hand.currentBet) {
          sendJson(socket, {
            type: "error",
            message: `raise_to must be an integer greater than ${room.hand.currentBet}`,
          });
          return;
        }

        if (room.hand.minRaiseTo !== null && targetAmount < room.hand.minRaiseTo) {
          sendJson(socket, {
            type: "error",
            message: `raise_to must be at least ${room.hand.minRaiseTo}`,
          });
          return;
        }

        const amountToCommit = targetAmount - currentPlayer.committedThisStreet;
        if (amountToCommit <= 0) {
          sendJson(socket, {
            type: "error",
            message: "raise_to amount must exceed your current committed amount",
          });
          return;
        }

        if (amountToCommit > currentPlayer.stack) {
          sendJson(socket, {
            type: "error",
            message: "insufficient stack for raise",
          });
          return;
        }

        const previousCurrentBet = room.hand.currentBet;

        currentPlayer.stack -= amountToCommit;
        currentPlayer.committedThisStreet += amountToCommit;
        currentPlayer.committedThisHand += amountToCommit;
        room.hand.pot += amountToCommit;

        room.hand.currentBet = currentPlayer.committedThisStreet;

        const raiseIncrement = room.hand.currentBet - previousCurrentBet;
        room.hand.minRaiseTo = room.hand.currentBet + raiseIncrement;
        amountCommitted = amountToCommit;
        note = `currentBet=${room.hand.currentBet}`;

        const activeSeatNumbers = getActiveSeatNumbers(room);
        room.hand.pendingSeatNumbers = new Set(
          activeSeatNumbers.filter(
            (seatNumber) => seatNumber !== currentPlayer.seatNumber,
          ),
        );
      } else if (actionType === "fold") {
        room.hand.foldedSeatNumbers.add(currentPlayer.seatNumber);
        room.hand.pendingSeatNumbers.delete(currentPlayer.seatNumber);
      }

      room.hand.actionLog.push({
        seatNumber: currentPlayer.seatNumber,
        playerName: currentPlayer.playerName,
        actionType,
        amountCommitted,
        toCallBeforeAction: toCall,
        street: room.hand.street,
      });

      const foldEndResult = maybeEndRoundOnFold(room);
      if (foldEndResult !== null) {
        sendJson(socket, {
          type: "round_ended",
          roomId: session.roomId,
          winnerSeatNumber: foldEndResult.winnerSeatNumber,
          reason: foldEndResult.reason,
        });

        publishRoomState(session.roomId);
        return;
      }

      if (room.hand.pendingSeatNumbers.size === 0) {
        if (room.hand.street === "river") {
          const completeResult = endRound(room, "showdown_pending", null);
          sendJson(socket, {
            type: "round_ended",
            roomId: session.roomId,
            winnerSeatNumber: completeResult.winnerSeatNumber,
            reason: completeResult.reason,
          });
          publishRoomState(session.roomId);
          return;
        }

        const transition = advanceStreet(room);
        if (!transition) {
          const fallbackResult = endRound(room, "street_advance_failed", null);
          sendJson(socket, {
            type: "round_ended",
            roomId: session.roomId,
            winnerSeatNumber: fallbackResult.winnerSeatNumber,
            reason: fallbackResult.reason,
          });
          publishRoomState(session.roomId);
          return;
        }

        sendJson(socket, {
          type: "street_advanced",
          roomId: session.roomId,
          street: transition.street,
          boardCards: transition.boardCards,
          turnSeatNumber: transition.turnSeatNumber,
        });

        publishRoomState(session.roomId);
        return;
      }

      room.hand.turnSeatNumber = getNextPendingTurnSeatNumber(
        room,
        currentPlayer.seatNumber,
      );

      sendJson(socket, {
        type: "action_applied",
        roomId: session.roomId,
        actionType,
        amountCommitted,
        nextTurnSeatNumber: room.hand.turnSeatNumber,
        note,
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

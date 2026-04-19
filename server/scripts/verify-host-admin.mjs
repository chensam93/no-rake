import { createHostAdminHandlers } from "../src/ws/handlers/hostAdminHandlers.js";

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const MAX_SEATS = 9;

function makePlayer(overrides = {}) {
  return {
    playerName: "p",
    seatNumber: null,
    stack: 1000,
    committedThisStreet: 0,
    committedThisHand: 0,
    holeCards: [],
    ...overrides,
  };
}

function makeSocket(tag) {
  const sent = [];
  return {
    tag,
    sent,
    readyState: 1,
    send(text) {
      sent.push(typeof text === "string" ? JSON.parse(text) : text);
    },
    close() {
      this.readyState = 3;
    },
  };
}

function makeRoom({ hostSocket, playersBySocket, hand = { inProgress: false }, table = {} } = {}) {
  return {
    id: "test-room",
    hostSocket,
    members: new Set(playersBySocket.keys()),
    playersBySocket,
    hand: { inProgress: false, ...hand },
    table: { dealerSeatNumber: null, ...table },
    serverBot: { seatNumber: null, botHandle: null, profile: "tag" },
  };
}

function makeContext(room) {
  const sendLog = [];
  const kicked = [];
  const published = [];
  return {
    log: { sendLog, kicked, published },
    MAX_SEATS,
    getRoom: () => room,
    sendJson(socket, payload) {
      sendLog.push({ socket, payload });
      if (typeof socket?.send === "function") {
        socket.send(JSON.stringify(payload));
      }
    },
    publishRoomState(roomId) {
      published.push(roomId);
    },
    removeSocketFromRoom(roomId, socket) {
      kicked.push({ roomId, socket });
      room.playersBySocket.delete(socket);
      room.members.delete(socket);
    },
    clearServerBotSeat(targetRoom) {
      const handle = targetRoom.serverBot?.botHandle;
      if (handle) targetRoom.playersBySocket.delete(handle);
      if (targetRoom.serverBot) {
        targetRoom.serverBot.seatNumber = null;
        targetRoom.serverBot.botHandle = null;
      }
    },
  };
}

// Scenario 1: host adjusts stack (set + delta)
{
  const hostSocket = makeSocket("host");
  const otherSocket = makeSocket("other");
  const players = new Map([
    [hostSocket, makePlayer({ playerName: "host", seatNumber: 1, stack: 1000 })],
    [otherSocket, makePlayer({ playerName: "other", seatNumber: 2, stack: 500 })],
  ]);
  const room = makeRoom({ hostSocket, playersBySocket: players });
  const context = makeContext(room);
  const handlers = createHostAdminHandlers(context);

  handlers.handleAdjustStack(hostSocket, { roomId: room.id }, {
    seatNumber: 2,
    mode: "set",
    amount: 2500,
  });
  assert(players.get(otherSocket).stack === 2500, "set mode should overwrite stack");

  handlers.handleAdjustStack(hostSocket, { roomId: room.id }, {
    seatNumber: 2,
    mode: "delta",
    amount: -1000,
  });
  assert(players.get(otherSocket).stack === 1500, "delta mode should adjust stack by amount");

  handlers.handleAdjustStack(hostSocket, { roomId: room.id }, {
    seatNumber: 2,
    mode: "delta",
    amount: -9999,
  });
  assert(players.get(otherSocket).stack === 0, "delta mode should clamp stack at 0");

  const nonHostResult = (() => {
    const baseSendCount = context.log.sendLog.length;
    handlers.handleAdjustStack(otherSocket, { roomId: room.id }, {
      seatNumber: 1,
      mode: "set",
      amount: 0,
    });
    return context.log.sendLog.slice(baseSendCount);
  })();
  assert(
    nonHostResult[0]?.payload?.type === "error" &&
      /only host/.test(nonHostResult[0].payload.message),
    "non-host should be rejected",
  );
  assert(
    players.get(hostSocket).stack === 1000,
    "non-host adjust attempt should not change stacks",
  );
}

// Scenario 2: host moves a player to an empty seat, then swaps with another
{
  const hostSocket = makeSocket("host");
  const otherSocket = makeSocket("other");
  const players = new Map([
    [hostSocket, makePlayer({ playerName: "host", seatNumber: 1 })],
    [otherSocket, makePlayer({ playerName: "other", seatNumber: 2 })],
  ]);
  const room = makeRoom({
    hostSocket,
    playersBySocket: players,
    table: { dealerSeatNumber: 1 },
  });
  const context = makeContext(room);
  const handlers = createHostAdminHandlers(context);

  handlers.handleMovePlayer(hostSocket, { roomId: room.id }, {
    fromSeatNumber: 1,
    toSeatNumber: 5,
  });
  assert(players.get(hostSocket).seatNumber === 5, "host should move to empty seat 5");
  assert(
    room.table.dealerSeatNumber === 5,
    "dealer button should follow the moved seat",
  );

  handlers.handleMovePlayer(hostSocket, { roomId: room.id }, {
    fromSeatNumber: 5,
    toSeatNumber: 2,
  });
  assert(players.get(hostSocket).seatNumber === 2, "host should swap into seat 2");
  assert(players.get(otherSocket).seatNumber === 5, "other should swap into seat 5");
}

// Scenario 3: host kicks a human (socket removed) then kicks a bot
{
  const hostSocket = makeSocket("host");
  const otherSocket = makeSocket("other");
  const botHandle = { readyState: 1, send() {} };
  const players = new Map([
    [hostSocket, makePlayer({ playerName: "host", seatNumber: 1 })],
    [otherSocket, makePlayer({ playerName: "other", seatNumber: 2 })],
    [botHandle, makePlayer({ playerName: "bot-s3", seatNumber: 3, isServerBot: true })],
  ]);
  const room = makeRoom({
    hostSocket,
    playersBySocket: players,
  });
  room.serverBot = { seatNumber: 3, botHandle, profile: "tag" };

  const context = makeContext(room);
  const handlers = createHostAdminHandlers(context);

  handlers.handleKickPlayer(hostSocket, { roomId: room.id }, { seatNumber: 2 });
  assert(!players.has(otherSocket), "kicked human socket should be removed from room");
  assert(
    context.log.kicked.some(({ socket }) => socket === otherSocket),
    "removeSocketFromRoom should be called for human kick",
  );
  assert(
    otherSocket.sent.some((message) => message.type === "kicked"),
    "kicked socket should receive a kicked notice",
  );

  handlers.handleKickPlayer(hostSocket, { roomId: room.id }, { seatNumber: 3 });
  assert(!players.has(botHandle), "kicked bot should be removed from room");
  assert(room.serverBot.seatNumber === null, "serverBot seat should be cleared after bot kick");

  // Host kicking themselves should fail
  const baseSendCount = context.log.sendLog.length;
  handlers.handleKickPlayer(hostSocket, { roomId: room.id }, { seatNumber: 1 });
  const tail = context.log.sendLog.slice(baseSendCount);
  assert(
    tail[0]?.payload?.type === "error" && /cannot kick themselves/.test(tail[0].payload.message),
    "host cannot kick themselves",
  );
  assert(players.has(hostSocket), "host should remain seated after self-kick attempt");
}

// Scenario 4: all host admin actions blocked during active hand
{
  const hostSocket = makeSocket("host");
  const otherSocket = makeSocket("other");
  const players = new Map([
    [hostSocket, makePlayer({ playerName: "host", seatNumber: 1 })],
    [otherSocket, makePlayer({ playerName: "other", seatNumber: 2 })],
  ]);
  const room = makeRoom({
    hostSocket,
    playersBySocket: players,
    hand: { inProgress: true },
  });
  const context = makeContext(room);
  const handlers = createHostAdminHandlers(context);

  handlers.handleAdjustStack(hostSocket, { roomId: room.id }, { seatNumber: 2, mode: "set", amount: 0 });
  handlers.handleMovePlayer(hostSocket, { roomId: room.id }, { fromSeatNumber: 1, toSeatNumber: 3 });
  handlers.handleKickPlayer(hostSocket, { roomId: room.id }, { seatNumber: 2 });

  assert(players.get(otherSocket).stack === 1000, "stack should not change during active hand");
  assert(players.get(hostSocket).seatNumber === 1, "seats should not move during active hand");
  assert(players.has(otherSocket), "players should not be kicked during active hand");

  const errors = context.log.sendLog
    .map((entry) => entry.payload)
    .filter((payload) => payload?.type === "error");
  assert(
    errors.length === 3 && errors.every((error) => /active hand/.test(error.message)),
    "each host action should emit an active-hand error",
  );
}

console.log("verify-host-admin: passed");

export const rooms = new Map();

export function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      members: new Set(),
      playersBySocket: new Map(),
      hostSocket: null,
      autoStartTimer: null,
      table: {
        smallBlind: 10,
        bigBlind: 20,
        dealerSeatNumber: null,
        autoDealEnabled: true,
        autoDealDelayMs: 1800,
        manualStepMode: false,
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
        raiseClosedSeatNumbers: new Set(),
        actionLog: [],
        currentBet: 0,
        minRaiseTo: null,
        lastEndReason: null,
        lastWinnerSeatNumber: null,
        lastWinnerSeatNumbers: [],
        lastPayouts: [],
        lastShowdown: null,
        lastPotBreakdown: [],
      },
      serverBot: {
        seatNumber: null,
        profile: "tag",
        seed: 1337,
        actingDelayMs: 320,
        timer: null,
        botHandle: null,
      },
    });
  }

  return rooms.get(roomId);
}

export function getRoom(roomId) {
  return rooms.get(roomId);
}

export function removeSocketFromRoom(roomId, socket, helpers) {
  const room = rooms.get(roomId);
  if (!room) return;

  const wasHost = room.hostSocket === socket;
  room.members.delete(socket);
  room.playersBySocket.delete(socket);

  if (wasHost) {
    room.hostSocket = room.members.values().next().value ?? null;
  }

  helpers.maybeResolveHandAfterMembershipChange(room);

  if (room.members.size === 0) {
    helpers.clearAutoStartTimer(room);
    if (typeof helpers.clearServerBotTimer === "function") {
      helpers.clearServerBotTimer(room);
    }
    rooms.delete(roomId);
  }
}

export function getHostPlayerName(room) {
  if (!room.hostSocket) return null;
  const hostPlayer = room.playersBySocket.get(room.hostSocket);
  return hostPlayer?.playerName ?? null;
}

export function publishRoomState(roomId, rooms, sendJson, getSortedPlayers) {
  const room = rooms.get(roomId);
  if (!room) return;

  const payload = {
    type: "room_state",
    roomId,
    table: {
      smallBlind: room.table.smallBlind,
      bigBlind: room.table.bigBlind,
      autoDealEnabled: room.table.autoDealEnabled,
      autoDealDelayMs: room.table.autoDealDelayMs,
      manualStepMode: room.table.manualStepMode,
      hostPlayerName: getHostPlayerName(room),
    },
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
      lastWinnerSeatNumber: room.hand.lastWinnerSeatNumber,
      lastWinnerSeatNumbers: room.hand.lastWinnerSeatNumbers,
      lastPayouts: room.hand.lastPayouts,
      lastShowdown: room.hand.lastShowdown,
      lastPotBreakdown: room.hand.lastPotBreakdown,
      actionLog: room.hand.actionLog,
    },
  };

  for (const member of room.members) {
    if (member.readyState === 1) {
      sendJson(member, payload);
    }
  }
}

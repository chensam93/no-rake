export function computeBotDecision(roomStatePayload, botSeat, lastActionKey = null) {
  if (!botSeat) return null;
  const round = roomStatePayload?.round;
  if (!round?.inProgress || round.turnSeatNumber !== botSeat) return null;

  const players = roomStatePayload.players ?? [];
  const botPlayer = players.find((player) => player.seatNumber === botSeat);
  if (!botPlayer) return null;

  const currentBet = round.currentBet ?? 0;
  const committed = botPlayer.committedThisStreet ?? 0;
  const toCall = Math.max(0, currentBet - committed);
  const actionLogLength = Array.isArray(round.actionLog) ? round.actionLog.length : 0;
  const actionKey = `${round.street}|${round.turnSeatNumber}|${actionLogLength}|${toCall}`;

  if (lastActionKey === actionKey) return null;
  if (toCall === 0) {
    return { actionKey, actionType: "check", label: "player_action:check", toCall };
  }
  if (toCall <= botPlayer.stack) {
    return { actionKey, actionType: "call", label: "player_action:call", toCall };
  }
  return { actionKey, actionType: "fold", label: "player_action:fold", toCall };
}

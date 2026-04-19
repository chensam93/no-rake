export function clearAutoStartTimer(room) {
  if (room.autoStartTimer) {
    clearTimeout(room.autoStartTimer);
    room.autoStartTimer = null;
  }
}

function broadcastGameOver(room, context, reason) {
  if (typeof context.sendJson !== "function") return;
  const payload = {
    type: "game_over",
    roomId: room.id,
    reason,
  };
  for (const member of room.members) {
    if (member.readyState === 1) {
      context.sendJson(member, payload);
    }
  }
}

export function maybeScheduleAutoStart(room, reason, context) {
  clearAutoStartTimer(room);

  const autoDealReasons = new Set(["fold_winner", "showdown"]);
  if (reason && !autoDealReasons.has(reason)) return;
  if (room.hand.inProgress) return;
  if (!room.table.autoDealEnabled) return;
  if (room.table.manualStepMode) return;
  if (context.getSeatedPlayers(room).length < 2) return;

  const chipEligibleCount =
    typeof context.getChipEligibleSeatedPlayers === "function"
      ? context.getChipEligibleSeatedPlayers(room).length
      : context
          .getSeatedPlayers(room)
          .filter((player) => Number(player.stack ?? 0) > 0).length;
  if (chipEligibleCount < 2) {
    broadcastGameOver(room, context, "insufficient_chips");
    return;
  }

  const delayMs = room.table.autoDealDelayMs ?? 1800;
  room.autoStartTimer = setTimeout(() => {
    room.autoStartTimer = null;

    if (!context.rooms.has(room.id)) return;
    if (room.hand.inProgress) return;
    if (!room.table.autoDealEnabled) return;
    if (room.table.manualStepMode) return;

    const result = context.startRound(room);
    if (!result.ok) {
      if (result.code === "insufficient_chips") {
        broadcastGameOver(room, context, "insufficient_chips");
      }
      return;
    }

    for (const member of room.members) {
      if (member.readyState === 1) {
        context.sendJson(member, {
          type: "round_started",
          roomId: room.id,
          turnSeatNumber: result.turnSeatNumber,
          street: result.street,
          auto: true,
        });
      }
    }

    if (typeof context.maybeScheduleServerBotAction === "function") {
      context.maybeScheduleServerBotAction(room);
    }
    context.publishRoomState(room.id);
  }, delayMs);
}

export function createTableControlHandlers(context) {
  function handleSetAutoDeal(socket, session, parsed) {
    if (!session.roomId) {
      context.sendJson(socket, { type: "error", message: "join_room before set_auto_deal" });
      return;
    }

    const room = context.getRoom(session.roomId);
    if (!room) {
      context.sendJson(socket, { type: "error", message: "room not found" });
      return;
    }

    if (room.hostSocket !== socket) {
      context.sendJson(socket, { type: "error", message: "only host can change auto deal settings" });
      return;
    }

    room.table.autoDealEnabled = Boolean(parsed.enabled);

    const delayMs = Number(parsed.delayMs);
    if (Number.isInteger(delayMs) && delayMs >= 500 && delayMs <= 10000) {
      room.table.autoDealDelayMs = delayMs;
    }

    if (room.table.autoDealEnabled) {
      context.maybeScheduleAutoStart(room);
    } else {
      context.clearAutoStartTimer(room);
    }

    context.sendJson(socket, {
      type: "auto_deal_updated",
      roomId: session.roomId,
      enabled: room.table.autoDealEnabled,
      delayMs: room.table.autoDealDelayMs,
    });
    context.publishRoomState(session.roomId);
  }

  function handleSetManualStepMode(socket, session, parsed) {
    if (!session.roomId) {
      context.sendJson(socket, { type: "error", message: "join_room before set_manual_step_mode" });
      return;
    }

    const room = context.getRoom(session.roomId);
    if (!room) {
      context.sendJson(socket, { type: "error", message: "room not found" });
      return;
    }

    if (room.hostSocket !== socket) {
      context.sendJson(socket, {
        type: "error",
        message: "only host can change manual step mode",
      });
      return;
    }

    room.table.manualStepMode = Boolean(parsed.enabled);
    if (room.table.manualStepMode) {
      context.clearAutoStartTimer(room);
    } else if (room.table.autoDealEnabled) {
      context.maybeScheduleAutoStart(room);
    }

    context.sendJson(socket, {
      type: "manual_step_mode_updated",
      roomId: session.roomId,
      enabled: room.table.manualStepMode,
    });
    context.publishRoomState(session.roomId);
  }

  function handleStepProgress(socket, session) {
    if (!session.roomId) {
      context.sendJson(socket, { type: "error", message: "join_room before step_progress" });
      return;
    }

    const room = context.getRoom(session.roomId);
    if (!room) {
      context.sendJson(socket, { type: "error", message: "room not found" });
      return;
    }

    if (room.hostSocket !== socket) {
      context.sendJson(socket, { type: "error", message: "only host can step progression" });
      return;
    }

    if (!room.table.manualStepMode) {
      context.sendJson(socket, { type: "error", message: "manual step mode is not enabled" });
      return;
    }

    if (room.hand.inProgress) {
      if (room.hand.pendingSeatNumbers.size > 0) {
        context.sendJson(socket, {
          type: "error",
          message: "cannot progress while player actions are still pending",
        });
        return;
      }

      const progression = context.progressRoundWhenNoPending(room);
      for (const transition of progression.streetEvents) {
        context.sendJson(socket, {
          type: "street_advanced",
          roomId: session.roomId,
          street: transition.street,
          boardCards: transition.boardCards,
          turnSeatNumber: transition.turnSeatNumber,
        });
      }

      if (progression.ended) {
        context.sendJson(socket, {
          type: "round_ended",
          roomId: session.roomId,
          winnerSeatNumber: progression.endResult.winnerSeatNumber,
          winnerSeatNumbers: progression.endResult.winnerSeatNumbers,
          payouts: progression.endResult.payouts,
          potBreakdown: progression.endResult.potBreakdown,
          showdown: progression.endResult.showdown,
          reason: progression.endResult.reason,
        });
      }

      context.publishRoomState(session.roomId);
      return;
    }

    const result = context.startRound(room);
    if (!result.ok) {
      context.sendJson(socket, { type: "error", message: result.message });
      return;
    }

    context.sendJson(socket, {
      type: "round_started",
      roomId: session.roomId,
      turnSeatNumber: result.turnSeatNumber,
      street: result.street,
      auto: false,
    });
    context.publishRoomState(session.roomId);
  }

  function handleStartRound(socket, session) {
    if (!session.roomId) {
      context.sendJson(socket, { type: "error", message: "join_room before start_round" });
      return;
    }

    const room = context.getRoom(session.roomId);
    if (!room) {
      context.sendJson(socket, { type: "error", message: "room not found" });
      return;
    }

    if (room.hand.inProgress) {
      context.sendJson(socket, { type: "error", message: "round already in progress" });
      return;
    }

    const result = context.startRound(room);
    if (!result.ok) {
      context.sendJson(socket, { type: "error", message: result.message });
      return;
    }

    context.sendJson(socket, {
      type: "round_started",
      roomId: session.roomId,
      turnSeatNumber: result.turnSeatNumber,
      street: result.street,
    });

    context.publishRoomState(session.roomId);
  }

  return {
    handleSetAutoDeal,
    handleSetManualStepMode,
    handleStepProgress,
    handleStartRound,
  };
}

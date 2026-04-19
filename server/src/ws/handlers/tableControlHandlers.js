export function createTableControlHandlers(context) {
  function getHostRoom(socket, session, actionLabel) {
    if (!session.roomId) {
      context.sendJson(socket, { type: "error", message: `join_room before ${actionLabel}` });
      return null;
    }
    const room = context.getRoom(session.roomId);
    if (!room) {
      context.sendJson(socket, { type: "error", message: "room not found" });
      return null;
    }
    if (room.hostSocket !== socket) {
      context.sendJson(socket, { type: "error", message: `only host can ${actionLabel}` });
      return null;
    }
    return room;
  }

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
    context.maybeScheduleServerBotAction(room);
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
      if (room.hand.pendingSeatNumbers.size > 0 && room.table.manualStepMode) {
        const botStep = context.runServerBotStep(room);
        if (botStep.acted) {
          context.sendJson(socket, {
            type: "bot_step_applied",
            roomId: session.roomId,
            reason: botStep.reason,
          });
          context.publishRoomState(session.roomId);
          return;
        }
      }

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
    context.maybeScheduleServerBotAction(room);
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

    context.maybeScheduleServerBotAction(room);
    context.publishRoomState(session.roomId);
  }

  function handleEndGame(socket, session) {
    const room = getHostRoom(socket, session, "end game");
    if (!room) return;

    context.clearAutoStartTimer(room);
    if (typeof context.clearServerBotTimer === "function") {
      context.clearServerBotTimer(room);
    }

    room.table.dealerSeatNumber = null;

    room.hand.inProgress = false;
    room.hand.street = null;
    room.hand.board = [];
    room.hand.deck = [];
    room.hand.pot = 0;
    room.hand.turnSeatNumber = null;
    room.hand.dealerSeatNumber = null;
    room.hand.smallBlindSeatNumber = null;
    room.hand.bigBlindSeatNumber = null;
    room.hand.foldedSeatNumbers.clear();
    room.hand.pendingSeatNumbers.clear();
    room.hand.raiseClosedSeatNumbers.clear();
    room.hand.actionLog = [];
    room.hand.currentBet = 0;
    room.hand.minRaiseTo = null;
    room.hand.lastEndReason = null;
    room.hand.lastWinnerSeatNumber = null;
    room.hand.lastWinnerSeatNumbers = [];
    room.hand.lastPayouts = [];
    room.hand.lastShowdown = null;
    room.hand.lastPotBreakdown = [];

    for (const player of room.playersBySocket.values()) {
      player.stack = context.STARTING_STACK;
      player.committedThisStreet = 0;
      player.committedThisHand = 0;
      player.holeCards = [];
    }

    context.sendJson(socket, {
      type: "game_reset",
      roomId: session.roomId,
    });
    context.publishRoomState(session.roomId);
  }

  function handleSetServerBot(socket, session, parsed) {
    const room = getHostRoom(socket, session, "change server bot seat");
    if (!room) return;
    if (room.hand.inProgress) {
      context.sendJson(socket, {
        type: "error",
        message: "cannot change server bot seat during active round",
      });
      return;
    }

    const enabled = parsed.enabled !== false;
    let result;
    if (enabled) {
      result = context.setServerBotSeat(room, parsed.seatNumber, parsed.profile);
    } else {
      result = context.clearServerBotSeat(room);
    }
    if (!result.ok) {
      context.sendJson(socket, { type: "error", message: result.message });
      return;
    }
    context.sendJson(socket, {
      type: "server_bot_updated",
      roomId: session.roomId,
      enabled,
      seatNumber: result.seatNumber ?? null,
      profile: result.profile ?? room.serverBot?.profile ?? "tag",
    });
    context.publishRoomState(session.roomId);
  }

  function handleSetServerBotProfile(socket, session, parsed) {
    const room = getHostRoom(socket, session, "change server bot profile");
    if (!room) return;
    const result = context.setServerBotProfile(room, parsed.profile);
    if (!result.ok) {
      context.sendJson(socket, { type: "error", message: result.message });
      return;
    }
    context.sendJson(socket, {
      type: "server_bot_profile_updated",
      roomId: session.roomId,
      profile: result.profile,
    });
    context.maybeScheduleServerBotAction(room);
    context.publishRoomState(session.roomId);
  }

  function handleSetServerBotSeed(socket, session, parsed) {
    const room = getHostRoom(socket, session, "change server bot seed");
    if (!room) return;
    const result = context.setServerBotSeed(room, parsed.seed);
    if (!result.ok) {
      context.sendJson(socket, { type: "error", message: result.message });
      return;
    }
    context.sendJson(socket, {
      type: "server_bot_seed_updated",
      roomId: session.roomId,
      seed: result.seed,
    });
    context.publishRoomState(session.roomId);
  }

  function handleSetServerBotDelay(socket, session, parsed) {
    const room = getHostRoom(socket, session, "change server bot delay");
    if (!room) return;
    const result = context.setServerBotDelay(room, parsed.delayMs);
    if (!result.ok) {
      context.sendJson(socket, { type: "error", message: result.message });
      return;
    }
    context.sendJson(socket, {
      type: "server_bot_delay_updated",
      roomId: session.roomId,
      delayMs: result.delayMs,
    });
    context.maybeScheduleServerBotAction(room);
    context.publishRoomState(session.roomId);
  }

  return {
    handleSetAutoDeal,
    handleSetManualStepMode,
    handleStepProgress,
    handleStartRound,
    handleEndGame,
    handleSetServerBot,
    handleSetServerBotProfile,
    handleSetServerBotSeed,
    handleSetServerBotDelay,
  };
}

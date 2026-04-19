const MAX_STACK_VALUE = 1_000_000;

function findPlayerEntryBySeat(room, seatNumber) {
  for (const [socketKey, player] of room.playersBySocket.entries()) {
    if (player.seatNumber === seatNumber) {
      return { socketKey, player };
    }
  }
  return null;
}

function isBotPlayerEntry(room, socketKey) {
  const botHandle = room.serverBot?.botHandle;
  return Boolean(botHandle && socketKey === botHandle);
}

export function createHostAdminHandlers(context) {
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

  function requireIdleHand(socket, room, actionLabel) {
    if (room.hand.inProgress) {
      context.sendJson(socket, {
        type: "error",
        message: `cannot ${actionLabel} during active hand`,
      });
      return false;
    }
    return true;
  }

  function handleAdjustStack(socket, session, parsed) {
    const room = getHostRoom(socket, session, "adjust stacks");
    if (!room) return;
    if (!requireIdleHand(socket, room, "adjust stacks")) return;

    const seatNumber = Number(parsed.seatNumber);
    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > context.MAX_SEATS) {
      context.sendJson(socket, {
        type: "error",
        message: `seatNumber must be an integer between 1 and ${context.MAX_SEATS}`,
      });
      return;
    }

    const entry = findPlayerEntryBySeat(room, seatNumber);
    if (!entry) {
      context.sendJson(socket, { type: "error", message: "no player at that seat" });
      return;
    }

    const mode = parsed.mode === "delta" ? "delta" : "set";
    const rawAmount = Number(parsed.amount);
    if (!Number.isFinite(rawAmount)) {
      context.sendJson(socket, { type: "error", message: "amount must be a number" });
      return;
    }
    const amount = Math.trunc(rawAmount);
    if (Math.abs(amount) > MAX_STACK_VALUE) {
      context.sendJson(socket, {
        type: "error",
        message: `amount must be between -${MAX_STACK_VALUE} and ${MAX_STACK_VALUE}`,
      });
      return;
    }

    const priorStack = Math.max(0, Number(entry.player.stack ?? 0));
    const nextStack =
      mode === "delta"
        ? Math.max(0, Math.min(MAX_STACK_VALUE, priorStack + amount))
        : Math.max(0, Math.min(MAX_STACK_VALUE, amount));

    entry.player.stack = nextStack;

    context.sendJson(socket, {
      type: "host_stack_adjusted",
      roomId: session.roomId,
      seatNumber,
      mode,
      amount,
      priorStack,
      stack: nextStack,
    });
    context.publishRoomState(session.roomId);
  }

  function handleMovePlayer(socket, session, parsed) {
    const room = getHostRoom(socket, session, "move players");
    if (!room) return;
    if (!requireIdleHand(socket, room, "move players")) return;

    const fromSeatNumber = Number(parsed.fromSeatNumber);
    const toSeatNumber = Number(parsed.toSeatNumber);
    const validSeat = (value) =>
      Number.isInteger(value) && value >= 1 && value <= context.MAX_SEATS;
    if (!validSeat(fromSeatNumber) || !validSeat(toSeatNumber)) {
      context.sendJson(socket, {
        type: "error",
        message: `seat numbers must be integers between 1 and ${context.MAX_SEATS}`,
      });
      return;
    }
    if (fromSeatNumber === toSeatNumber) {
      context.sendJson(socket, { type: "error", message: "fromSeat and toSeat must differ" });
      return;
    }

    const sourceEntry = findPlayerEntryBySeat(room, fromSeatNumber);
    if (!sourceEntry) {
      context.sendJson(socket, { type: "error", message: "no player at fromSeat" });
      return;
    }

    const targetEntry = findPlayerEntryBySeat(room, toSeatNumber);

    sourceEntry.player.seatNumber = toSeatNumber;
    if (targetEntry) {
      targetEntry.player.seatNumber = fromSeatNumber;
    }

    if (room.serverBot && Number.isInteger(room.serverBot.seatNumber)) {
      if (isBotPlayerEntry(room, sourceEntry.socketKey)) {
        room.serverBot.seatNumber = toSeatNumber;
      } else if (targetEntry && isBotPlayerEntry(room, targetEntry.socketKey)) {
        room.serverBot.seatNumber = fromSeatNumber;
      }
    }

    if (Number.isInteger(room.table.dealerSeatNumber)) {
      if (room.table.dealerSeatNumber === fromSeatNumber) {
        room.table.dealerSeatNumber = toSeatNumber;
      } else if (room.table.dealerSeatNumber === toSeatNumber) {
        room.table.dealerSeatNumber = fromSeatNumber;
      }
    }

    context.sendJson(socket, {
      type: "host_player_moved",
      roomId: session.roomId,
      fromSeatNumber,
      toSeatNumber,
      swapped: Boolean(targetEntry),
    });
    context.publishRoomState(session.roomId);
  }

  function handleKickPlayer(socket, session, parsed) {
    const room = getHostRoom(socket, session, "kick players");
    if (!room) return;
    if (!requireIdleHand(socket, room, "kick players")) return;

    const seatNumber = Number(parsed.seatNumber);
    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > context.MAX_SEATS) {
      context.sendJson(socket, {
        type: "error",
        message: `seatNumber must be an integer between 1 and ${context.MAX_SEATS}`,
      });
      return;
    }

    const entry = findPlayerEntryBySeat(room, seatNumber);
    if (!entry) {
      context.sendJson(socket, { type: "error", message: "no player at that seat" });
      return;
    }

    if (entry.socketKey === socket) {
      context.sendJson(socket, {
        type: "error",
        message: "host cannot kick themselves - use move/adjust or leave the room",
      });
      return;
    }

    const kickedPlayerName = entry.player.playerName ?? null;

    if (isBotPlayerEntry(room, entry.socketKey)) {
      if (typeof context.clearServerBotSeat === "function") {
        context.clearServerBotSeat(room);
      } else {
        room.playersBySocket.delete(entry.socketKey);
        if (room.serverBot) {
          room.serverBot.seatNumber = null;
          room.serverBot.botHandle = null;
        }
      }
      context.sendJson(socket, {
        type: "host_player_kicked",
        roomId: session.roomId,
        seatNumber,
        playerName: kickedPlayerName,
        kind: "bot",
      });
      context.publishRoomState(session.roomId);
      return;
    }

    const kickedSocket = entry.socketKey;
    if (kickedSocket && kickedSocket !== socket) {
      try {
        context.sendJson(kickedSocket, {
          type: "kicked",
          roomId: session.roomId,
          reason: parsed.reason ?? "kicked_by_host",
        });
      } catch {
        // best-effort notify
      }
    }

    context.removeSocketFromRoom(session.roomId, kickedSocket);

    if (kickedSocket && typeof kickedSocket.close === "function") {
      try {
        kickedSocket.close(4000, "kicked_by_host");
      } catch {
        // socket may already be closed
      }
    }

    context.sendJson(socket, {
      type: "host_player_kicked",
      roomId: session.roomId,
      seatNumber,
      playerName: kickedPlayerName,
      kind: "human",
    });
    context.publishRoomState(session.roomId);
  }

  return {
    handleAdjustStack,
    handleMovePlayer,
    handleKickPlayer,
  };
}

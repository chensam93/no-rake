export function createSessionHandlers(context) {
  function handleJoinRoom(socket, session, parsed) {
    const roomId = parsed.roomId?.trim();
    const playerName = parsed.playerName?.trim();

    if (!roomId || !playerName) {
      context.sendJson(socket, {
        type: "error",
        message: "join_room requires roomId and playerName",
      });
      return;
    }

    if (session.roomId) {
      context.removeSocketFromRoom(session.roomId, socket);
      context.publishRoomState(session.roomId);
    }

    session.roomId = roomId;
    session.playerName = playerName;

    const room = context.getOrCreateRoom(roomId);
    room.members.add(socket);
    if (!room.hostSocket) {
      room.hostSocket = socket;
    }
    room.playersBySocket.set(socket, {
      playerName,
      seatNumber: null,
      stack: context.STARTING_STACK,
      committedThisStreet: 0,
      committedThisHand: 0,
      holeCards: [],
    });

    context.sendJson(socket, {
      type: "joined_room",
      roomId,
      playerName,
    });

    context.publishRoomState(roomId);
  }

  function handleSitDown(socket, session, parsed) {
    if (!session.roomId || !session.playerName) {
      context.sendJson(socket, {
        type: "error",
        message: "join_room before sit_down",
      });
      return;
    }

    const seatNumber = Number(parsed.seatNumber);
    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > context.MAX_SEATS) {
      context.sendJson(socket, {
        type: "error",
        message: `seatNumber must be an integer between 1 and ${context.MAX_SEATS}`,
      });
      return;
    }

    const room = context.getRoom(session.roomId);
    if (!room) {
      context.sendJson(socket, { type: "error", message: "room not found" });
      return;
    }

    if (room.hand.inProgress) {
      context.sendJson(socket, {
        type: "error",
        message: "cannot change seats during active round",
      });
      return;
    }

    for (const [memberSocket, player] of room.playersBySocket.entries()) {
      if (memberSocket !== socket && player.seatNumber === seatNumber) {
        context.sendJson(socket, { type: "error", message: "seat already taken" });
        return;
      }
    }

    const currentPlayer = room.playersBySocket.get(socket);
    if (!currentPlayer) {
      context.sendJson(socket, { type: "error", message: "player not found in room" });
      return;
    }

    currentPlayer.seatNumber = seatNumber;

    context.sendJson(socket, {
      type: "sat_down",
      roomId: session.roomId,
      playerName: currentPlayer.playerName,
      seatNumber,
    });

    context.publishRoomState(session.roomId);
  }

  return {
    handleJoinRoom,
    handleSitDown,
  };
}

export function buildPlayersBySeat(roomState) {
  const playersBySeat = new Map();
  if (roomState?.players) {
    for (const player of roomState.players) {
      if (player.seatNumber !== null) {
        playersBySeat.set(player.seatNumber, player);
      }
    }
  }
  return playersBySeat;
}

export function deriveLocalPlayer(roomState, playersBySeat, playerName, fallbackSeatNumber) {
  return (
    roomState?.players?.find(
      (candidate) => candidate.seatNumber !== null && candidate.playerName === playerName,
    ) ??
    playersBySeat.get(fallbackSeatNumber) ??
    null
  );
}

export function deriveSeatOccupancy(seats, playersBySeat) {
  return {
    occupiedSeatNumbers: seats.filter((seat) => playersBySeat.has(seat)),
    openSeatNumbers: seats.filter((seat) => !playersBySeat.has(seat)),
  };
}

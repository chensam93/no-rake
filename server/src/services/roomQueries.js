export function getSortedPlayers(room) {
  return [...room.playersBySocket.values()].sort((left, right) => {
    if (left.seatNumber === null && right.seatNumber === null) return 0;
    if (left.seatNumber === null) return 1;
    if (right.seatNumber === null) return -1;
    return left.seatNumber - right.seatNumber;
  });
}

export function getSeatedPlayers(room) {
  return getSortedPlayers(room).filter((player) => player.seatNumber !== null);
}

export function getPlayerBySeatNumber(room, seatNumber) {
  for (const player of room.playersBySocket.values()) {
    if (player.seatNumber === seatNumber) {
      return player;
    }
  }

  return null;
}

export function getActiveSeatNumbers(room) {
  return getSeatedPlayers(room)
    .map((player) => player.seatNumber)
    .filter((seatNumber) => !room.hand.foldedSeatNumbers.has(seatNumber));
}

export function getActionEligibleSeatNumbers(room) {
  return getSeatedPlayers(room)
    .filter(
      (player) =>
        !room.hand.foldedSeatNumbers.has(player.seatNumber) &&
        Number(player.stack ?? 0) > 0,
    )
    .map((player) => player.seatNumber);
}

export function getNextSeatInList(seatNumbers, currentSeatNumber) {
  if (seatNumbers.length === 0) return null;

  const currentIndex = seatNumbers.indexOf(currentSeatNumber);
  if (currentIndex === -1) {
    return seatNumbers[0];
  }

  const nextIndex = (currentIndex + 1) % seatNumbers.length;
  return seatNumbers[nextIndex];
}

export function getNextActiveSeatAfter(room, currentSeatNumber) {
  const activeSeatNumbers = getActiveSeatNumbers(room);
  return getNextSeatInList(activeSeatNumbers, currentSeatNumber);
}

export function getNextPendingTurnSeatNumber(room, currentSeatNumber) {
  const eligibleSeatNumbers = getActionEligibleSeatNumbers(room);
  if (eligibleSeatNumbers.length === 0) return null;

  const pendingSeatNumbers = room.hand.pendingSeatNumbers;
  const seatsNeedingAction = eligibleSeatNumbers.filter((seatNumber) =>
    pendingSeatNumbers.has(seatNumber),
  );

  if (seatsNeedingAction.length === 0) return null;

  const currentIndex = eligibleSeatNumbers.indexOf(currentSeatNumber);
  if (currentIndex === -1) {
    return seatsNeedingAction[0];
  }

  for (let step = 1; step <= eligibleSeatNumbers.length; step += 1) {
    const index = (currentIndex + step) % eligibleSeatNumbers.length;
    const seatNumber = eligibleSeatNumbers[index];
    if (pendingSeatNumbers.has(seatNumber)) {
      return seatNumber;
    }
  }

  return seatsNeedingAction[0];
}

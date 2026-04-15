export function buildPendingSeatsAfterAggressiveAction(activeSeatNumbers, aggressorSeatNumber) {
  return new Set(activeSeatNumbers.filter((seatNumber) => seatNumber !== aggressorSeatNumber));
}

export function buildRaiseClosedSeatNumbers(
  activeSeatNumbers,
  aggressorSeatNumber,
  pendingSeatNumbersBeforeAction,
) {
  return new Set(
    activeSeatNumbers.filter(
      (seatNumber) =>
        seatNumber !== aggressorSeatNumber &&
        !pendingSeatNumbersBeforeAction.has(seatNumber),
    ),
  );
}

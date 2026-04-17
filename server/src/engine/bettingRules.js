export function doesRaiseReopenAction(minRaiseTo, targetAmount) {
  if (minRaiseTo === null) return true;
  return targetAmount >= minRaiseTo;
}

export function computeNextMinRaiseTo({
  previousCurrentBet,
  previousMinRaiseTo,
  nextCurrentBet,
  raiseIncrement,
  reopensAction,
}) {
  const normalizedRaiseIncrement = Number(raiseIncrement);
  if (!Number.isFinite(normalizedRaiseIncrement) || normalizedRaiseIncrement <= 0) {
    return previousMinRaiseTo;
  }

  const previousBet = Number(previousCurrentBet);
  const previousThreshold = Number(previousMinRaiseTo);
  const previousFullRaiseSize =
    Number.isFinite(previousBet) && Number.isFinite(previousThreshold)
      ? previousThreshold - previousBet
      : normalizedRaiseIncrement;
  const normalizedPreviousFullRaiseSize =
    Number.isFinite(previousFullRaiseSize) && previousFullRaiseSize > 0
      ? previousFullRaiseSize
      : normalizedRaiseIncrement;

  const nextRaiseSize = reopensAction ? normalizedRaiseIncrement : normalizedPreviousFullRaiseSize;
  return Number(nextCurrentBet) + nextRaiseSize;
}

export function doesRaiseReopenAction(minRaiseTo, targetAmount) {
  if (minRaiseTo === null) return true;
  return targetAmount >= minRaiseTo;
}

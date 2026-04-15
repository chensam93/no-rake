export function validateBetAmount(amount, stack) {
  if (!Number.isInteger(amount) || amount <= 0) {
    return "bet requires a positive integer amount";
  }
  if (amount > stack) {
    return "insufficient stack for bet";
  }
  return null;
}

export function validateRaiseTarget({
  targetAmount,
  currentBet,
  currentCommittedThisStreet,
  currentStack,
  minRaiseTo,
}) {
  if (!Number.isInteger(targetAmount) || targetAmount <= currentBet) {
    return `raise_to must be an integer greater than ${currentBet}`;
  }

  const amountToCommit = targetAmount - currentCommittedThisStreet;
  if (amountToCommit <= 0) {
    return "raise_to amount must exceed your current committed amount";
  }

  if (targetAmount > currentCommittedThisStreet + currentStack) {
    return "insufficient stack for raise";
  }

  const isAllInTarget = targetAmount === currentCommittedThisStreet + currentStack;
  if (minRaiseTo !== null && targetAmount < minRaiseTo && !isAllInTarget) {
    return `raise_to must be at least ${minRaiseTo} unless all-in`;
  }

  return null;
}

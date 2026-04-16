/**
 * Heuristic preflop raise targets (not solver output; sensible online defaults).
 * - Unopened / blind level only: open to openBbMultiple × big blind.
 * - Facing a raise: rough 3× the current facing bet (total chips), clamped legal.
 */
export function getRecommendedPreflopRaiseTo({
  bigBlind,
  currentBet,
  raiseMinTarget,
  raiseMaxTarget,
  openBbMultiple,
}) {
  const bb = Math.max(1, Number(bigBlind) || 1);
  const facing = Math.max(0, Number(currentBet) || 0);
  const minTarget = Math.max(0, Number(raiseMinTarget) || 0);
  const maxTarget = Math.max(minTarget, Number(raiseMaxTarget) || minTarget);
  const openMult = Math.min(6, Math.max(1.5, Number(openBbMultiple) || 2.5));

  const unopened = facing <= bb;
  let raw;
  if (unopened) {
    raw = Math.round(bb * openMult);
  } else {
    raw = Math.round(Math.max(minTarget, facing * 3));
  }

  const clamped = Math.min(maxTarget, Math.max(minTarget, raw));
  return clamped;
}

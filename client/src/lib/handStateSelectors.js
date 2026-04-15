export function buildPotBreakdownPreview(players, foldedSeatNumbers) {
  if (!Array.isArray(players) || players.length === 0) return [];
  const foldedSet = new Set(Array.isArray(foldedSeatNumbers) ? foldedSeatNumbers : []);
  const contributors = players
    .map((player) => ({
      seatNumber: player.seatNumber,
      committed: Math.max(0, Number(player.committedThisHand ?? 0)),
      folded: foldedSet.has(player.seatNumber),
    }))
    .filter((player) => player.seatNumber !== null && player.committed > 0);

  if (contributors.length === 0) return [];

  const uniqueLevels = [...new Set(contributors.map((player) => player.committed))].sort(
    (left, right) => left - right,
  );

  const breakdown = [];
  let previousLevel = 0;
  for (const level of uniqueLevels) {
    const increment = level - previousLevel;
    if (increment <= 0) continue;
    const participants = contributors.filter((player) => player.committed >= level);
    if (participants.length === 0) continue;
    const amount = increment * participants.length;
    if (amount <= 0) continue;
    breakdown.push({
      amount,
      eligibleSeatNumbers: participants
        .filter((player) => !player.folded)
        .map((player) => player.seatNumber),
    });
    previousLevel = level;
  }

  return breakdown;
}

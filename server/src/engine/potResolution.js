export function buildPotsFromCommitments(contributors) {
  if (!Array.isArray(contributors) || contributors.length === 0) return [];

  const commitmentLevels = [...new Set(contributors.map((entry) => entry.committed))]
    .filter((value) => value > 0)
    .sort((left, right) => left - right);

  const pots = [];
  let previousLevel = 0;
  for (const level of commitmentLevels) {
    const contributingEntries = contributors.filter((entry) => entry.committed >= level);
    const layerAmount = (level - previousLevel) * contributingEntries.length;
    const eligibleSeatNumbers = contributingEntries
      .filter((entry) => !entry.folded)
      .map((entry) => entry.seatNumber)
      .sort((left, right) => left - right);
    previousLevel = level;
    if (layerAmount <= 0 || eligibleSeatNumbers.length === 0) continue;
    pots.push({
      amount: layerAmount,
      eligibleSeatNumbers,
    });
  }

  return pots;
}

export function resolvePots(pots, resultsBySeat, compareHandRanks) {
  const aggregatedPayouts = new Map();
  const potBreakdown = [];

  for (const pot of pots) {
    const eligibleResults = pot.eligibleSeatNumbers
      .map((seatNumber) => resultsBySeat.get(seatNumber))
      .filter(Boolean);
    if (eligibleResults.length === 0) continue;

    let bestResult = eligibleResults[0];
    for (const result of eligibleResults.slice(1)) {
      if (compareHandRanks(result.rank, bestResult.rank) > 0) {
        bestResult = result;
      }
    }

    const winnerSeatNumbers = eligibleResults
      .filter((result) => compareHandRanks(result.rank, bestResult.rank) === 0)
      .map((result) => result.seatNumber)
      .sort((left, right) => left - right);

    const splitAmount = Math.floor(pot.amount / winnerSeatNumbers.length);
    const remainder = pot.amount % winnerSeatNumbers.length;
    const potPayouts = [];

    for (let index = 0; index < winnerSeatNumbers.length; index += 1) {
      const seatNumber = winnerSeatNumbers[index];
      const amount = splitAmount + (index < remainder ? 1 : 0);
      aggregatedPayouts.set(seatNumber, (aggregatedPayouts.get(seatNumber) || 0) + amount);
      potPayouts.push({ seatNumber, amount });
    }

    potBreakdown.push({
      amount: pot.amount,
      eligibleSeatNumbers: pot.eligibleSeatNumbers,
      winnerSeatNumbers,
      payouts: potPayouts,
    });
  }

  const payouts = [...aggregatedPayouts.entries()]
    .map(([seatNumber, amount]) => ({ seatNumber, amount }))
    .sort((left, right) => left.seatNumber - right.seatNumber);

  const totalPaid = payouts.reduce((sum, payout) => sum + payout.amount, 0);
  return { payouts, potBreakdown, totalPaid };
}

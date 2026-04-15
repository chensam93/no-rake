const RANK_TO_VALUE = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const VALUE_TO_RANK = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "T",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

function parseCard(card) {
  if (!card || typeof card !== "string" || card.length < 2) return null;
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  const value = RANK_TO_VALUE[rank];
  if (!value || !["c", "d", "h", "s"].includes(suit)) return null;
  return { rank, suit, value, raw: card };
}

function getStraightHigh(values) {
  const uniqueValues = [...new Set(values)].sort((left, right) => right - left);
  if (uniqueValues.includes(14)) {
    uniqueValues.push(1);
  }

  let runLength = 1;
  let bestHigh = null;
  for (let index = 1; index < uniqueValues.length; index += 1) {
    const previousValue = uniqueValues[index - 1];
    const currentValue = uniqueValues[index];
    if (previousValue - 1 === currentValue) {
      runLength += 1;
      if (runLength >= 5) {
        bestHigh = uniqueValues[index - 4];
        break;
      }
    } else {
      runLength = 1;
    }
  }
  return bestHigh;
}

function evaluateFiveCards(rawCards) {
  const cards = rawCards.map(parseCard).filter(Boolean);
  if (cards.length !== 5) return null;

  const values = cards.map((card) => card.value);
  const suits = cards.map((card) => card.suit);
  const isFlush = suits.every((suit) => suit === suits[0]);
  const straightHigh = getStraightHigh(values);
  const isStraight = straightHigh !== null;

  const countsByValue = new Map();
  for (const value of values) {
    countsByValue.set(value, (countsByValue.get(value) || 0) + 1);
  }
  const valueCountEntries = [...countsByValue.entries()].sort((left, right) => {
    const countDelta = right[1] - left[1];
    if (countDelta !== 0) return countDelta;
    return right[0] - left[0];
  });

  if (isStraight && isFlush) {
    return { category: 8, categoryName: "straight_flush", tiebreakers: [straightHigh] };
  }
  if (valueCountEntries[0][1] === 4) {
    return {
      category: 7,
      categoryName: "four_of_a_kind",
      tiebreakers: [valueCountEntries[0][0], valueCountEntries[1][0]],
    };
  }
  if (valueCountEntries[0][1] === 3 && valueCountEntries[1][1] === 2) {
    return {
      category: 6,
      categoryName: "full_house",
      tiebreakers: [valueCountEntries[0][0], valueCountEntries[1][0]],
    };
  }
  if (isFlush) {
    return {
      category: 5,
      categoryName: "flush",
      tiebreakers: [...values].sort((left, right) => right - left),
    };
  }
  if (isStraight) {
    return { category: 4, categoryName: "straight", tiebreakers: [straightHigh] };
  }
  if (valueCountEntries[0][1] === 3) {
    const kickers = valueCountEntries
      .slice(1)
      .map(([value]) => value)
      .sort((left, right) => right - left);
    return {
      category: 3,
      categoryName: "three_of_a_kind",
      tiebreakers: [valueCountEntries[0][0], ...kickers],
    };
  }
  if (valueCountEntries[0][1] === 2 && valueCountEntries[1][1] === 2) {
    const pairValues = valueCountEntries
      .filter(([, count]) => count === 2)
      .map(([value]) => value)
      .sort((left, right) => right - left);
    const kicker = valueCountEntries.find(([, count]) => count === 1)[0];
    return { category: 2, categoryName: "two_pair", tiebreakers: [...pairValues, kicker] };
  }
  if (valueCountEntries[0][1] === 2) {
    const kickers = valueCountEntries
      .slice(1)
      .map(([value]) => value)
      .sort((left, right) => right - left);
    return {
      category: 1,
      categoryName: "one_pair",
      tiebreakers: [valueCountEntries[0][0], ...kickers],
    };
  }
  return {
    category: 0,
    categoryName: "high_card",
    tiebreakers: [...values].sort((left, right) => right - left),
  };
}

export function compareHandRanks(leftRank, rightRank) {
  if (leftRank.category !== rightRank.category) {
    return leftRank.category > rightRank.category ? 1 : -1;
  }
  const maxLength = Math.max(leftRank.tiebreakers.length, rightRank.tiebreakers.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftRank.tiebreakers[index] ?? -1;
    const rightValue = rightRank.tiebreakers[index] ?? -1;
    if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1;
  }
  return 0;
}

export function evaluateBestHand(sevenCards) {
  if (!Array.isArray(sevenCards) || sevenCards.length < 5) return null;
  let best = null;
  for (let i = 0; i < sevenCards.length - 4; i += 1) {
    for (let j = i + 1; j < sevenCards.length - 3; j += 1) {
      for (let k = j + 1; k < sevenCards.length - 2; k += 1) {
        for (let l = k + 1; l < sevenCards.length - 1; l += 1) {
          for (let m = l + 1; m < sevenCards.length; m += 1) {
            const handCards = [sevenCards[i], sevenCards[j], sevenCards[k], sevenCards[l], sevenCards[m]];
            const rank = evaluateFiveCards(handCards);
            if (!rank) continue;
            if (!best || compareHandRanks(rank, best.rank) > 0) {
              best = { rank, cards: handCards };
            }
          }
        }
      }
    }
  }
  return best;
}

function formatValue(value) {
  return VALUE_TO_RANK[value] ?? String(value);
}

export function formatRankLabel(rank) {
  if (!rank) return "unknown";
  const top = rank.tiebreakers.map(formatValue);
  if (rank.categoryName === "straight_flush") return `Straight flush (${formatValue(rank.tiebreakers[0])}-high)`;
  if (rank.categoryName === "four_of_a_kind") return `Four of a kind (${formatValue(rank.tiebreakers[0])})`;
  if (rank.categoryName === "full_house") return `Full house (${formatValue(rank.tiebreakers[0])} over ${formatValue(rank.tiebreakers[1])})`;
  if (rank.categoryName === "flush") return `Flush (${top.join("-")})`;
  if (rank.categoryName === "straight") return `Straight (${formatValue(rank.tiebreakers[0])}-high)`;
  if (rank.categoryName === "three_of_a_kind") return `Three of a kind (${formatValue(rank.tiebreakers[0])})`;
  if (rank.categoryName === "two_pair") return `Two pair (${formatValue(rank.tiebreakers[0])} and ${formatValue(rank.tiebreakers[1])})`;
  if (rank.categoryName === "one_pair") return `One pair (${formatValue(rank.tiebreakers[0])})`;
  return `High card (${formatValue(rank.tiebreakers[0])})`;
}

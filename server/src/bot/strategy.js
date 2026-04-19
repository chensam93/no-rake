import { weightedChoice } from "./rng.js";

const BOT_PROFILES = {
  nit: {
    preflopTightness: 0.3,
    aggression: 0.35,
    bluff: 0.2,
  },
  tag: {
    preflopTightness: 0.5,
    aggression: 0.55,
    bluff: 0.35,
  },
  lag: {
    preflopTightness: 0.68,
    aggression: 0.72,
    bluff: 0.52,
  },
  maniac: {
    preflopTightness: 0.82,
    aggression: 0.9,
    bluff: 0.7,
  },
};

const RANK_VALUE = {
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

function parseCard(card) {
  if (typeof card !== "string" || card.length < 2) return null;
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  const rankValue = RANK_VALUE[rank];
  if (!rankValue || !["c", "d", "h", "s"].includes(suit)) return null;
  return { rankValue, suit };
}

function getProfile(profileName) {
  return BOT_PROFILES[profileName] ?? BOT_PROFILES.tag;
}

function evaluatePreflopStrength(holeCards) {
  const parsed = (holeCards ?? []).map(parseCard).filter(Boolean);
  if (parsed.length < 2) return 0.1;
  const [leftCard, rightCard] = parsed;
  const high = Math.max(leftCard.rankValue, rightCard.rankValue);
  const low = Math.min(leftCard.rankValue, rightCard.rankValue);
  const isPair = high === low;
  const isSuited = leftCard.suit === rightCard.suit;
  const gap = Math.abs(high - low);

  let score = (high + low) / 28;
  if (isPair) score += 0.35;
  if (isSuited) score += 0.08;
  if (gap <= 2) score += 0.05;
  if (high >= 13) score += 0.08;
  return Math.max(0, Math.min(1, score));
}

function buildSuitCounts(cards) {
  const counts = new Map();
  for (const card of cards) {
    counts.set(card.suit, (counts.get(card.suit) || 0) + 1);
  }
  return counts;
}

function hasStraightDraw(values) {
  const uniqueValues = [...new Set(values)].sort((left, right) => right - left);
  if (uniqueValues.includes(14)) uniqueValues.push(1);
  let longestRun = 1;
  let run = 1;
  for (let index = 1; index < uniqueValues.length; index += 1) {
    if (uniqueValues[index - 1] - 1 === uniqueValues[index]) {
      run += 1;
      longestRun = Math.max(longestRun, run);
    } else {
      run = 1;
    }
  }
  return longestRun >= 4;
}

function evaluatePostflopStrength(holeCards, boardCards, bestRankCategory) {
  const parsedCards = [...(holeCards ?? []), ...(boardCards ?? [])].map(parseCard).filter(Boolean);
  const values = parsedCards.map((card) => card.rankValue);
  const suitCounts = buildSuitCounts(parsedCards);
  const bestSuitCount = Math.max(0, ...suitCounts.values());
  const hasFlushDraw = bestSuitCount === 4;
  const straightDraw = hasStraightDraw(values);

  if (bestRankCategory >= 6) return 0.98;
  if (bestRankCategory === 5) return 0.9;
  if (bestRankCategory === 4) return 0.85;
  if (bestRankCategory === 3) return 0.8;
  if (bestRankCategory === 2) return 0.74;
  if (bestRankCategory === 1) return 0.6;

  let score = 0.26;
  if (hasFlushDraw) score += 0.2;
  if (straightDraw) score += 0.18;
  return Math.min(0.62, score);
}

function getBetTargetRange(state) {
  const maxTarget = state.committedThisStreet + state.stack;
  if (maxTarget <= state.committedThisStreet) return null;
  if (state.currentBet > 0 && state.raiseClosedSeatNumbers.has(state.seatNumber)) return null;

  if (state.currentBet <= 0) {
    const minTarget = state.committedThisStreet + 1;
    if (maxTarget < minTarget) return null;
    return { actionType: "bet", minTarget, maxTarget };
  }

  const minTarget = Math.max(state.currentBet + 1, state.minRaiseTo ?? state.currentBet + 1);
  if (maxTarget < minTarget) return null;
  return { actionType: "raise_to", minTarget, maxTarget };
}

function chooseTargetByPotFraction(state, range, fraction) {
  const potValue = Math.max(1, Number(state.pot ?? 0));
  const rawIncrement = Math.max(1, Math.round(potValue * fraction));
  const baseTarget =
    range.actionType === "bet"
      ? state.committedThisStreet + rawIncrement
      : state.currentBet + rawIncrement;
  return Math.max(range.minTarget, Math.min(range.maxTarget, baseTarget));
}

function chooseAggressiveTarget(state, range, rng) {
  const sizingChoices = [
    { weight: 0.35, fraction: 0.33 },
    { weight: 0.34, fraction: 0.66 },
    { weight: 0.23, fraction: 1 },
    { weight: 0.08, fraction: 1.5 },
  ];
  const selected = weightedChoice(sizingChoices, rng) ?? sizingChoices[0];
  return chooseTargetByPotFraction(state, range, selected.fraction);
}

function getPostflopOrder(activeSeatNumbers, dealerSeatNumber) {
  if (!Array.isArray(activeSeatNumbers) || activeSeatNumbers.length === 0) return [];
  const sortedSeats = [...new Set(activeSeatNumbers)]
    .map((seat) => Number(seat))
    .filter((seat) => Number.isInteger(seat))
    .sort((left, right) => left - right);
  if (sortedSeats.length <= 1) return sortedSeats;
  if (!Number.isInteger(dealerSeatNumber)) return sortedSeats;

  const leftOfDealer = sortedSeats.find((seat) => seat > dealerSeatNumber) ?? sortedSeats[0];
  const startIndex = sortedSeats.indexOf(leftOfDealer);
  if (startIndex < 0) return sortedSeats;
  return [...sortedSeats.slice(startIndex), ...sortedSeats.slice(0, startIndex)];
}

function isOutOfPositionVsAggressor(state) {
  if (!state || !Number.isInteger(state.lastAggressorSeatNumber)) return false;
  if (!Array.isArray(state.activeSeatNumbers) || state.activeSeatNumbers.length < 2) return false;
  const order = getPostflopOrder(state.activeSeatNumbers, state.dealerSeatNumber);
  const botIndex = order.indexOf(state.seatNumber);
  const aggressorIndex = order.indexOf(state.lastAggressorSeatNumber);
  if (botIndex < 0 || aggressorIndex < 0) return false;
  return botIndex < aggressorIndex;
}

function choosePreflopReraiseTarget(state, range, profile) {
  const bigBlind = Math.max(1, Number(state.bigBlind ?? 20));
  const isFacingRaise =
    Number(state.currentBet ?? 0) > bigBlind && Number(state.currentBet ?? 0) > Number(state.committedThisStreet ?? 0);
  if (!isFacingRaise) return null;

  const isOutOfPosition = isOutOfPositionVsAggressor(state);
  const baseMultiplier = isOutOfPosition ? 4.3 : 3.5;
  const profileAdjustment = (Number(profile.aggression ?? 0.55) - 0.55) * 0.8;
  const targetMultiplier = Math.max(3.2, baseMultiplier + profileAdjustment);
  const rawTarget = Math.round(Number(state.currentBet ?? 0) * targetMultiplier);
  return Math.max(range.minTarget, Math.min(range.maxTarget, rawTarget));
}

export function chooseBaselineBotAction(state, rng) {
  if (!state || !state.inProgress || !state.isBotTurn) return null;

  const profile = getProfile(state.profileName);
  const toCall = Math.max(0, state.currentBet - state.committedThisStreet);
  const canCheck = toCall === 0;
  const canCall = toCall > 0 && state.stack > 0;
  const canFold = toCall > 0;
  const range = getBetTargetRange(state);
  const canAggress = Boolean(range);

  const preflopStrength = evaluatePreflopStrength(state.holeCards);
  const postflopStrength = evaluatePostflopStrength(
    state.holeCards,
    state.boardCards,
    state.bestRankCategory,
  );
  const strength = state.street === "preflop" ? preflopStrength : postflopStrength;
  const pressure = toCall / Math.max(1, state.pot + toCall);
  const aggressionEdge = profile.aggression * (0.35 + strength);

  const actions = [];
  if (canCheck) {
    const checkWeight = Math.max(0.08, (1 - aggressionEdge) * (0.8 - profile.bluff * 0.2));
    actions.push({ weight: checkWeight, actionType: "check" });
  }
  if (canCall) {
    const callWeight = Math.max(0.05, strength * 0.95 + (1 - pressure) * 0.25);
    actions.push({ weight: callWeight, actionType: "call" });
  }
  if (canFold) {
    const foldWeight = Math.max(0.01, (1 - strength) * (0.65 + pressure * 0.8) * (1 - profile.bluff));
    actions.push({ weight: foldWeight, actionType: "fold" });
  }
  if (canAggress) {
    const aggressionWeight = Math.max(
      0.02,
      aggressionEdge + profile.bluff * (1 - strength) * 0.25 + profile.preflopTightness * 0.1,
    );
    actions.push({ weight: aggressionWeight, actionType: range.actionType });
  }

  const chosen = weightedChoice(actions, rng);
  if (!chosen) return { actionType: canCheck ? "check" : canCall ? "call" : "fold" };

  if (chosen.actionType === "bet" || chosen.actionType === "raise_to") {
    if (state.street === "preflop" && chosen.actionType === "raise_to") {
      const preflopReraiseTarget = choosePreflopReraiseTarget(state, range, profile);
      if (preflopReraiseTarget !== null) {
        return { actionType: chosen.actionType, amount: preflopReraiseTarget };
      }
    }
    const target = chooseAggressiveTarget(state, range, rng);
    return { actionType: chosen.actionType, amount: target };
  }
  return { actionType: chosen.actionType };
}

export function getSupportedBotProfiles() {
  return Object.keys(BOT_PROFILES);
}

export function normalizeBotProfileName(profileName) {
  if (typeof profileName !== "string") return "tag";
  return BOT_PROFILES[profileName] ? profileName : "tag";
}

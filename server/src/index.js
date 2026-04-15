import websocket from "@fastify/websocket";
import Fastify from "fastify";
import {
  compareHandRanks as compareHandRanksFromModule,
  evaluateBestHand as evaluateBestHandFromModule,
  formatRankLabel as formatRankLabelFromModule,
} from "./engine/handEvaluator.js";
import {
  buildPotsFromCommitments as buildPotsFromCommitmentsFromModule,
  resolvePots as resolvePotsFromModule,
} from "./engine/potResolution.js";
import { doesRaiseReopenAction } from "./engine/bettingRules.js";
import { progressRoundWhenNoPending as progressRoundWhenNoPendingFromModule } from "./engine/roundProgression.js";
import {
  buildPendingSeatsAfterAggressiveAction,
  buildRaiseClosedSeatNumbers,
} from "./engine/actionState.js";
import { validateBetAmount, validateRaiseTarget } from "./engine/actionValidation.js";

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT) || 3000;
const OPEN = 1;
const MAX_SEATS = 9;
const STARTING_STACK = 1000;
const STREETS = ["preflop", "flop", "turn", "river"];
const PLAYER_ACTIONS = new Set(["fold", "check", "call", "bet", "raise_to"]);
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

const rooms = new Map();

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

function buildDeck() {
  const suits = ["c", "d", "h", "s"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

function shuffle(array) {
  const copy = [...array];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = temp;
  }
  return copy;
}

function drawCards(room, count) {
  if (!room.hand.deck || room.hand.deck.length < count) {
    return [];
  }

  return room.hand.deck.splice(0, count);
}

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
  if (cards.length !== 5) {
    return null;
  }

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
    return {
      category: 8,
      categoryName: "straight_flush",
      tiebreakers: [straightHigh],
    };
  }

  if (valueCountEntries[0][1] === 4) {
    const fourValue = valueCountEntries[0][0];
    const kicker = valueCountEntries[1][0];
    return {
      category: 7,
      categoryName: "four_of_a_kind",
      tiebreakers: [fourValue, kicker],
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
    const sortedValues = [...values].sort((left, right) => right - left);
    return {
      category: 5,
      categoryName: "flush",
      tiebreakers: sortedValues,
    };
  }

  if (isStraight) {
    return {
      category: 4,
      categoryName: "straight",
      tiebreakers: [straightHigh],
    };
  }

  if (valueCountEntries[0][1] === 3) {
    const tripsValue = valueCountEntries[0][0];
    const kickers = valueCountEntries
      .slice(1)
      .map(([value]) => value)
      .sort((left, right) => right - left);
    return {
      category: 3,
      categoryName: "three_of_a_kind",
      tiebreakers: [tripsValue, ...kickers],
    };
  }

  if (valueCountEntries[0][1] === 2 && valueCountEntries[1][1] === 2) {
    const pairValues = valueCountEntries
      .filter(([, count]) => count === 2)
      .map(([value]) => value)
      .sort((left, right) => right - left);
    const kicker = valueCountEntries.find(([, count]) => count === 1)[0];
    return {
      category: 2,
      categoryName: "two_pair",
      tiebreakers: [...pairValues, kicker],
    };
  }

  if (valueCountEntries[0][1] === 2) {
    const pairValue = valueCountEntries[0][0];
    const kickers = valueCountEntries
      .slice(1)
      .map(([value]) => value)
      .sort((left, right) => right - left);
    return {
      category: 1,
      categoryName: "one_pair",
      tiebreakers: [pairValue, ...kickers],
    };
  }

  const highCards = [...values].sort((left, right) => right - left);
  return {
    category: 0,
    categoryName: "high_card",
    tiebreakers: highCards,
  };
}

function compareHandRanks(leftRank, rightRank) {
  return compareHandRanksFromModule(leftRank, rightRank);
}

function evaluateBestHand(sevenCards) {
  return evaluateBestHandFromModule(sevenCards);
}

function formatValue(value) {
  return VALUE_TO_RANK[value] ?? String(value);
}

function formatRankLabel(rank) {
  return formatRankLabelFromModule(rank);
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      members: new Set(),
      playersBySocket: new Map(),
      hostSocket: null,
      autoStartTimer: null,
      table: {
        smallBlind: 10,
        bigBlind: 20,
        dealerSeatNumber: null,
        autoDealEnabled: true,
        autoDealDelayMs: 1800,
      },
      hand: {
        inProgress: false,
        street: null,
        board: [],
        deck: [],
        pot: 0,
        turnSeatNumber: null,
        dealerSeatNumber: null,
        smallBlindSeatNumber: null,
        bigBlindSeatNumber: null,
        foldedSeatNumbers: new Set(),
        pendingSeatNumbers: new Set(),
        raiseClosedSeatNumbers: new Set(),
        actionLog: [],
        currentBet: 0,
        minRaiseTo: null,
        lastEndReason: null,
        lastWinnerSeatNumber: null,
        lastWinnerSeatNumbers: [],
        lastPayouts: [],
        lastShowdown: null,
        lastPotBreakdown: [],
      },
    });
  }

  return rooms.get(roomId);
}

function getSortedPlayers(room) {
  return [...room.playersBySocket.values()].sort((left, right) => {
    if (left.seatNumber === null && right.seatNumber === null) return 0;
    if (left.seatNumber === null) return 1;
    if (right.seatNumber === null) return -1;
    return left.seatNumber - right.seatNumber;
  });
}

function getSeatedPlayers(room) {
  return getSortedPlayers(room).filter((player) => player.seatNumber !== null);
}

function getPlayerBySeatNumber(room, seatNumber) {
  for (const player of room.playersBySocket.values()) {
    if (player.seatNumber === seatNumber) {
      return player;
    }
  }

  return null;
}

function getActiveSeatNumbers(room) {
  return getSeatedPlayers(room)
    .map((player) => player.seatNumber)
    .filter((seatNumber) => !room.hand.foldedSeatNumbers.has(seatNumber));
}

function getActionEligibleSeatNumbers(room) {
  return getSeatedPlayers(room)
    .filter(
      (player) =>
        !room.hand.foldedSeatNumbers.has(player.seatNumber) &&
        Number(player.stack ?? 0) > 0,
    )
    .map((player) => player.seatNumber);
}

function getNextSeatInList(seatNumbers, currentSeatNumber) {
  if (seatNumbers.length === 0) return null;

  const currentIndex = seatNumbers.indexOf(currentSeatNumber);
  if (currentIndex === -1) {
    return seatNumbers[0];
  }

  const nextIndex = (currentIndex + 1) % seatNumbers.length;
  return seatNumbers[nextIndex];
}

function getNextActiveSeatAfter(room, currentSeatNumber) {
  const activeSeatNumbers = getActiveSeatNumbers(room);
  return getNextSeatInList(activeSeatNumbers, currentSeatNumber);
}

function getNextPendingTurnSeatNumber(room, currentSeatNumber) {
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

function applyPotPayout(room, winnerSeatNumbers) {
  if (!Array.isArray(winnerSeatNumbers) || winnerSeatNumbers.length === 0) {
    return [];
  }

  const uniqueWinners = [...new Set(winnerSeatNumbers)].sort((left, right) => left - right);
  if (room.hand.pot <= 0) {
    return uniqueWinners.map((seatNumber) => ({ seatNumber, amount: 0 }));
  }

  const splitAmount = Math.floor(room.hand.pot / uniqueWinners.length);
  const remainder = room.hand.pot % uniqueWinners.length;
  const payouts = [];

  for (let index = 0; index < uniqueWinners.length; index += 1) {
    const seatNumber = uniqueWinners[index];
    const amount = splitAmount + (index < remainder ? 1 : 0);
    const player = getPlayerBySeatNumber(room, seatNumber);
    if (player) {
      player.stack += amount;
    }
    payouts.push({ seatNumber, amount });
  }

  room.hand.pot = 0;
  return payouts;
}

function buildPotsFromCommitments(room) {
  const contributors = getSeatedPlayers(room)
    .filter((player) => (player.committedThisHand ?? 0) > 0)
    .map((player) => ({
      seatNumber: player.seatNumber,
      committed: player.committedThisHand ?? 0,
      folded: room.hand.foldedSeatNumbers.has(player.seatNumber),
    }));

  return buildPotsFromCommitmentsFromModule(contributors);
}

function distributePots(room, pots, resultsBySeat) {
  const { payouts, potBreakdown, totalPaid } = resolvePotsFromModule(
    pots,
    resultsBySeat,
    compareHandRanks,
  );

  for (const payout of payouts) {
    const player = getPlayerBySeatNumber(room, payout.seatNumber);
    if (player) {
      player.stack += payout.amount;
    }
  }

  room.hand.pot = Math.max(0, room.hand.pot - totalPaid);

  return { payouts, potBreakdown };
}

function endRound(room, reason, options = {}) {
  const normalizedOptions = options && typeof options === "object" ? options : {};
  const winnerSeatNumbers = normalizedOptions.winnerSeatNumbers ?? [];
  const winnerSeatNumber =
    normalizedOptions.winnerSeatNumber ??
    (winnerSeatNumbers.length > 0 ? winnerSeatNumbers[0] : null);

  room.hand.inProgress = false;
  room.hand.turnSeatNumber = null;
  room.hand.currentBet = 0;
  room.hand.minRaiseTo = null;
  room.hand.pendingSeatNumbers.clear();
  room.hand.raiseClosedSeatNumbers.clear();
  room.hand.lastEndReason = reason;
  room.hand.lastWinnerSeatNumber = winnerSeatNumber;
  room.hand.lastWinnerSeatNumbers = winnerSeatNumbers;
  room.hand.lastPayouts = normalizedOptions.payouts ?? [];
  room.hand.lastShowdown = normalizedOptions.showdown ?? null;
  room.hand.lastPotBreakdown = normalizedOptions.potBreakdown ?? [];
  maybeScheduleAutoStart(room, reason);

  return {
    reason,
    winnerSeatNumber,
    winnerSeatNumbers,
    payouts: room.hand.lastPayouts,
    showdown: room.hand.lastShowdown,
    potBreakdown: room.hand.lastPotBreakdown,
  };
}

function finishRoundWithWinners(room, reason, winnerSeatNumbers, showdown = null) {
  const payouts = applyPotPayout(room, winnerSeatNumbers);
  return endRound(room, reason, {
    winnerSeatNumbers,
    payouts,
    showdown,
    potBreakdown: [
      {
        amount: payouts.reduce((sum, payout) => sum + payout.amount, 0),
        winnerSeatNumbers: winnerSeatNumbers ?? [],
        payouts,
      },
    ],
  });
}

function resolveShowdown(room) {
  const activePlayers = getSeatedPlayers(room).filter(
    (player) => !room.hand.foldedSeatNumbers.has(player.seatNumber),
  );
  if (activePlayers.length === 0) {
    return endRound(room, "showdown_no_players");
  }

  const results = [];
  for (const player of activePlayers) {
    const allCards = [...(player.holeCards ?? []), ...room.hand.board];
    const best = evaluateBestHand(allCards);
    if (!best) continue;
    results.push({
      seatNumber: player.seatNumber,
      playerName: player.playerName,
      bestCards: best.cards,
      rank: best.rank,
      rankLabel: formatRankLabel(best.rank),
    });
  }

  if (results.length === 0) {
    return endRound(room, "showdown_invalid_cards");
  }

  const resultsBySeat = new Map(results.map((result) => [result.seatNumber, result]));

  let bestResult = results[0];
  for (const result of results.slice(1)) {
    if (compareHandRanks(result.rank, bestResult.rank) > 0) {
      bestResult = result;
    }
  }

  const winners = results
    .filter((result) => compareHandRanks(result.rank, bestResult.rank) === 0)
    .map((result) => result.seatNumber)
    .sort((left, right) => left - right);

  const showdown = {
    winningHandLabel: bestResult.rankLabel,
    winningCards: bestResult.bestCards,
    boardCards: [...room.hand.board],
    players: results.map((result) => ({
      seatNumber: result.seatNumber,
      playerName: result.playerName,
      bestCards: result.bestCards,
      rankLabel: result.rankLabel,
    })),
  };
  const pots = buildPotsFromCommitments(room);
  if (pots.length === 0) {
    return finishRoundWithWinners(room, "showdown", winners, showdown);
  }
  const potResolution = distributePots(room, pots, resultsBySeat);
  return endRound(room, "showdown", {
    winnerSeatNumbers: winners,
    payouts: potResolution.payouts,
    potBreakdown: potResolution.potBreakdown,
    showdown,
  });
}

function maybeResolveHandAfterMembershipChange(room) {
  if (!room.hand.inProgress) return;

  const activeSeatNumbers = getActiveSeatNumbers(room);
  for (const pendingSeatNumber of [...room.hand.pendingSeatNumbers]) {
    const player = getPlayerBySeatNumber(room, pendingSeatNumber);
    if (!activeSeatNumbers.includes(pendingSeatNumber) || Number(player?.stack ?? 0) <= 0) {
      room.hand.pendingSeatNumbers.delete(pendingSeatNumber);
    }
  }

  if (activeSeatNumbers.length <= 1) {
    if (activeSeatNumbers.length === 1) {
      finishRoundWithWinners(room, "fold_winner", [activeSeatNumbers[0]]);
    } else {
      endRound(room, "all_left_table");
    }
    return;
  }

  if (room.hand.pendingSeatNumbers.size === 0) {
    room.hand.turnSeatNumber = null;
    return;
  }

  if (
    room.hand.turnSeatNumber === null ||
    !activeSeatNumbers.includes(room.hand.turnSeatNumber) ||
    !room.hand.pendingSeatNumbers.has(room.hand.turnSeatNumber)
  ) {
    room.hand.turnSeatNumber = getNextPendingTurnSeatNumber(
      room,
      room.hand.turnSeatNumber ?? activeSeatNumbers[0],
    );
  }
}

function progressRoundWhenNoPending(room) {
  return progressRoundWhenNoPendingFromModule(room, {
    resolveShowdown,
    advanceStreet,
    endRound,
  });
}

function clearAutoStartTimer(room) {
  if (room.autoStartTimer) {
    clearTimeout(room.autoStartTimer);
    room.autoStartTimer = null;
  }
}

function getHostPlayerName(room) {
  if (!room.hostSocket) return null;
  const hostPlayer = room.playersBySocket.get(room.hostSocket);
  return hostPlayer?.playerName ?? null;
}

function maybeScheduleAutoStart(room, reason = null) {
  clearAutoStartTimer(room);

  const autoDealReasons = new Set(["fold_winner", "showdown"]);
  if (reason && !autoDealReasons.has(reason)) return;
  if (room.hand.inProgress) return;
  if (!room.table.autoDealEnabled) return;
  if (getSeatedPlayers(room).length < 2) return;

  const delayMs = room.table.autoDealDelayMs ?? 1800;
  room.autoStartTimer = setTimeout(() => {
    room.autoStartTimer = null;

    if (!rooms.has(room.id)) return;
    if (room.hand.inProgress) return;
    if (!room.table.autoDealEnabled) return;

    const result = startRound(room);
    if (!result.ok) return;

    for (const member of room.members) {
      if (member.readyState === OPEN) {
        sendJson(member, {
          type: "round_started",
          roomId: room.id,
          turnSeatNumber: result.turnSeatNumber,
          street: result.street,
          auto: true,
        });
      }
    }

    publishRoomState(room.id);
  }, delayMs);
}

function removeSocketFromRoom(roomId, socket) {
  const room = rooms.get(roomId);
  if (!room) return;

  const wasHost = room.hostSocket === socket;
  room.members.delete(socket);
  room.playersBySocket.delete(socket);

  if (wasHost) {
    room.hostSocket = room.members.values().next().value ?? null;
  }

  maybeResolveHandAfterMembershipChange(room);

  if (room.members.size === 0) {
    clearAutoStartTimer(room);
    rooms.delete(roomId);
  }
}

function publishRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const payload = {
    type: "room_state",
    roomId,
    table: {
      smallBlind: room.table.smallBlind,
      bigBlind: room.table.bigBlind,
      autoDealEnabled: room.table.autoDealEnabled,
      autoDealDelayMs: room.table.autoDealDelayMs,
      hostPlayerName: getHostPlayerName(room),
    },
    players: getSortedPlayers(room),
    round: {
      inProgress: room.hand.inProgress,
      street: room.hand.street,
      board: room.hand.board,
      pot: room.hand.pot,
      dealerSeatNumber: room.hand.dealerSeatNumber,
      smallBlindSeatNumber: room.hand.smallBlindSeatNumber,
      bigBlindSeatNumber: room.hand.bigBlindSeatNumber,
      smallBlind: room.table.smallBlind,
      bigBlind: room.table.bigBlind,
      turnSeatNumber: room.hand.turnSeatNumber,
      foldedSeatNumbers: [...room.hand.foldedSeatNumbers].sort((left, right) => left - right),
      pendingSeatNumbers: [...room.hand.pendingSeatNumbers].sort((left, right) => left - right),
      currentBet: room.hand.currentBet,
      minRaiseTo: room.hand.minRaiseTo,
      lastEndReason: room.hand.lastEndReason,
      lastWinnerSeatNumber: room.hand.lastWinnerSeatNumber,
      lastWinnerSeatNumbers: room.hand.lastWinnerSeatNumbers,
      lastPayouts: room.hand.lastPayouts,
      lastShowdown: room.hand.lastShowdown,
      lastPotBreakdown: room.hand.lastPotBreakdown,
      actionLog: room.hand.actionLog,
    },
  };

  for (const member of room.members) {
    if (member.readyState === OPEN) {
      sendJson(member, payload);
    }
  }
}

function postBlind(room, seatNumber, amount, blindType) {
  if (seatNumber === null) return;

  const player = getPlayerBySeatNumber(room, seatNumber);
  if (!player) return;

  const blindAmount = Math.min(amount, player.stack);

  player.stack -= blindAmount;
  player.committedThisStreet += blindAmount;
  player.committedThisHand += blindAmount;

  room.hand.pot += blindAmount;
  room.hand.currentBet = Math.max(room.hand.currentBet, player.committedThisStreet);

  room.hand.actionLog.push({
    seatNumber,
    playerName: player.playerName,
    actionType: blindType,
    amountCommitted: blindAmount,
    toCallBeforeAction: 0,
    street: room.hand.street,
  });
}

function startRound(room) {
  const seatedPlayers = getSeatedPlayers(room);
  if (seatedPlayers.length < 2) {
    return { ok: false, message: "need at least 2 seated players" };
  }

  clearAutoStartTimer(room);

  const seatedSeatNumbers = seatedPlayers.map((player) => player.seatNumber);

  let dealerSeatNumber;
  if (
    room.table.dealerSeatNumber === null ||
    !seatedSeatNumbers.includes(room.table.dealerSeatNumber)
  ) {
    dealerSeatNumber = seatedSeatNumbers[0];
  } else {
    dealerSeatNumber = getNextSeatInList(seatedSeatNumbers, room.table.dealerSeatNumber);
  }

  room.table.dealerSeatNumber = dealerSeatNumber;

  const smallBlindSeatNumber = getNextSeatInList(seatedSeatNumbers, dealerSeatNumber);
  const bigBlindSeatNumber = getNextSeatInList(seatedSeatNumbers, smallBlindSeatNumber);

  room.hand.inProgress = true;
  room.hand.street = "preflop";
  room.hand.board = [];
  room.hand.deck = shuffle(buildDeck());
  room.hand.pot = 0;
  room.hand.foldedSeatNumbers.clear();
  room.hand.pendingSeatNumbers = new Set(seatedSeatNumbers);
  room.hand.raiseClosedSeatNumbers.clear();
  room.hand.actionLog = [];
  room.hand.turnSeatNumber = null;
  room.hand.currentBet = 0;
  room.hand.minRaiseTo = null;
  room.hand.lastEndReason = null;
  room.hand.lastWinnerSeatNumber = null;
  room.hand.lastWinnerSeatNumbers = [];
  room.hand.lastPayouts = [];
  room.hand.lastShowdown = null;
  room.hand.lastPotBreakdown = [];
  room.hand.dealerSeatNumber = dealerSeatNumber;
  room.hand.smallBlindSeatNumber = smallBlindSeatNumber;
  room.hand.bigBlindSeatNumber = bigBlindSeatNumber;

  for (const player of room.playersBySocket.values()) {
    player.committedThisStreet = 0;
    player.committedThisHand = 0;
    player.holeCards = [];
  }

  // Dev-friendly: deal and reveal hole cards to simplify UI testing.
  for (const player of getSeatedPlayers(room)) {
    player.holeCards = drawCards(room, 2);
  }

  postBlind(room, smallBlindSeatNumber, room.table.smallBlind, "post_small_blind");
  postBlind(room, bigBlindSeatNumber, room.table.bigBlind, "post_big_blind");

  room.hand.minRaiseTo = room.hand.currentBet + room.table.bigBlind;
  room.hand.pendingSeatNumbers = new Set(getActionEligibleSeatNumbers(room));
  room.hand.turnSeatNumber = getNextPendingTurnSeatNumber(room, bigBlindSeatNumber);
  if (room.hand.turnSeatNumber === null) {
    room.hand.turnSeatNumber = getNextActiveSeatAfter(room, bigBlindSeatNumber);
  }

  return {
    ok: true,
    turnSeatNumber: room.hand.turnSeatNumber,
    street: room.hand.street,
  };
}

function getPlayerToCallAmount(room, player) {
  return Math.max(0, room.hand.currentBet - player.committedThisStreet);
}

function maybeEndRoundOnFold(room) {
  const activeSeatNumbers = getActiveSeatNumbers(room);
  if (activeSeatNumbers.length > 1) return null;
  if (activeSeatNumbers.length === 1) {
    return finishRoundWithWinners(room, "fold_winner", [activeSeatNumbers[0]]);
  }
  return endRound(room, "all_folded");
}

function advanceStreet(room) {
  const currentStreetIndex = STREETS.indexOf(room.hand.street);
  if (currentStreetIndex === -1 || currentStreetIndex >= STREETS.length - 1) {
    return null;
  }

  const nextStreet = STREETS[currentStreetIndex + 1];

  let drawnCards = [];
  if (nextStreet === "flop") {
    drawnCards = drawCards(room, 3);
  } else {
    drawnCards = drawCards(room, 1);
  }

  room.hand.street = nextStreet;
  room.hand.board.push(...drawnCards);
  room.hand.currentBet = 0;
  room.hand.minRaiseTo = null;

  const activeSeatNumbers = getActiveSeatNumbers(room);
  room.hand.pendingSeatNumbers = new Set(
    activeSeatNumbers.filter((seatNumber) => {
      const player = getPlayerBySeatNumber(room, seatNumber);
      return Number(player?.stack ?? 0) > 0;
    }),
  );
  room.hand.raiseClosedSeatNumbers.clear();

  for (const player of room.playersBySocket.values()) {
    player.committedThisStreet = 0;
  }

  room.hand.turnSeatNumber = getNextPendingTurnSeatNumber(
    room,
    room.hand.dealerSeatNumber,
  );

  return {
    street: nextStreet,
    boardCards: drawnCards,
    turnSeatNumber: room.hand.turnSeatNumber,
  };
}

function renderSmokePage() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>No Rake - WS smoke page</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
      pre { background: #f5f5f5; padding: 0.75rem; border-radius: 6px; min-height: 10rem; }
      button { padding: 0.4rem 0.75rem; }
      code { background: #f0f0f0; padding: 0.1rem 0.25rem; border-radius: 4px; }
      .row { margin-bottom: 0.5rem; }
      input { margin-right: 8px; }
    </style>
  </head>
  <body>
    <h1>No Rake</h1>
    <p>Step 11 smoke test for street progression skeleton.</p>
    <p>Socket URL: <code>ws://127.0.0.1:${PORT}/ws</code></p>

    <div class="row">
      <label>Room <input id="room" value="home" /></label>
      <label>Name <input id="name" value="player" /></label>
      <label>Seat <input id="seat" value="1" type="number" min="1" max="9" /></label>
      <label>Amount <input id="amount" value="40" type="number" min="1" /></label>
    </div>

    <div class="row">
      <button id="join">Join room</button>
      <button id="sit">Sit down</button>
      <button id="startRound">Start round</button>
      <button id="check">Check</button>
      <button id="call">Call</button>
      <button id="bet">Bet</button>
      <button id="raiseTo">Raise To</button>
      <button id="fold">Fold</button>
      <button id="send">Send ping</button>
    </div>

    <pre id="log">waiting...</pre>

    <script>
      const log = document.getElementById("log");
      const ws = new WebSocket("ws://127.0.0.1:${PORT}/ws");

      const line = (message) => {
        log.textContent = log.textContent === "waiting..." ? message : log.textContent + "\\n" + message;
      };

      const send = (payload, label) => {
        ws.send(JSON.stringify(payload));
        line("[out] " + label);
      };

      const amount = () => Number(document.getElementById("amount").value);

      ws.onopen = () => line("[open]");
      ws.onmessage = (event) => line("[in] " + event.data);
      ws.onclose = () => line("[close]");
      ws.onerror = () => line("[error]");

      document.getElementById("join").onclick = () => {
        send(
          {
            type: "join_room",
            roomId: document.getElementById("room").value.trim(),
            playerName: document.getElementById("name").value.trim(),
          },
          "join_room",
        );
      };

      document.getElementById("sit").onclick = () => {
        send(
          {
            type: "sit_down",
            seatNumber: Number(document.getElementById("seat").value),
          },
          "sit_down",
        );
      };

      document.getElementById("startRound").onclick = () => send({ type: "start_round" }, "start_round");
      document.getElementById("check").onclick = () => send({ type: "player_action", actionType: "check" }, "check");
      document.getElementById("call").onclick = () => send({ type: "player_action", actionType: "call" }, "call");
      document.getElementById("bet").onclick = () => send({ type: "player_action", actionType: "bet", amount: amount() }, "bet");
      document.getElementById("raiseTo").onclick = () => send({ type: "player_action", actionType: "raise_to", amount: amount() }, "raise_to");
      document.getElementById("fold").onclick = () => send({ type: "player_action", actionType: "fold" }, "fold");

      document.getElementById("send").onclick = () => {
        ws.send("ping-" + Date.now());
        line("[out] ping");
      };
    </script>
  </body>
</html>`;
}

await app.register(websocket);

app.get("/health", async () => ({ ok: true }));
app.get("/", async () => renderSmokePage());

app.get("/ws", { websocket: true }, (socket) => {
  const session = {
    roomId: null,
    playerName: null,
  };

  sendJson(socket, {
    type: "hello",
    message: "no-rake",
    supportedMessages: [
      "join_room",
      "sit_down",
      "start_round",
      "set_auto_deal",
      "player_action:check/call/fold/bet/raise_to",
      "ping-*",
    ],
  });

  socket.on("message", (raw) => {
    const text = typeof raw === "string" ? raw : raw.toString();

    if (text.startsWith("ping-")) {
      sendJson(socket, { type: "echo", body: text });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      sendJson(socket, { type: "error", message: "invalid JSON payload" });
      return;
    }

    if (parsed.type === "join_room") {
      const roomId = parsed.roomId?.trim();
      const playerName = parsed.playerName?.trim();

      if (!roomId || !playerName) {
        sendJson(socket, {
          type: "error",
          message: "join_room requires roomId and playerName",
        });
        return;
      }

      if (session.roomId) {
        removeSocketFromRoom(session.roomId, socket);
        publishRoomState(session.roomId);
      }

      session.roomId = roomId;
      session.playerName = playerName;

      const room = getOrCreateRoom(roomId);
      room.members.add(socket);
      if (!room.hostSocket) {
        room.hostSocket = socket;
      }
      room.playersBySocket.set(socket, {
        playerName,
        seatNumber: null,
        stack: STARTING_STACK,
        committedThisStreet: 0,
        committedThisHand: 0,
        holeCards: [],
      });

      sendJson(socket, {
        type: "joined_room",
        roomId,
        playerName,
      });

      publishRoomState(roomId);
      return;
    }

    if (parsed.type === "set_auto_deal") {
      if (!session.roomId) {
        sendJson(socket, { type: "error", message: "join_room before set_auto_deal" });
        return;
      }

      const room = rooms.get(session.roomId);
      if (!room) {
        sendJson(socket, { type: "error", message: "room not found" });
        return;
      }

      if (room.hostSocket !== socket) {
        sendJson(socket, { type: "error", message: "only host can change auto deal settings" });
        return;
      }

      room.table.autoDealEnabled = Boolean(parsed.enabled);

      const delayMs = Number(parsed.delayMs);
      if (Number.isInteger(delayMs) && delayMs >= 500 && delayMs <= 10000) {
        room.table.autoDealDelayMs = delayMs;
      }

      if (room.table.autoDealEnabled) {
        maybeScheduleAutoStart(room);
      } else {
        clearAutoStartTimer(room);
      }

      sendJson(socket, {
        type: "auto_deal_updated",
        roomId: session.roomId,
        enabled: room.table.autoDealEnabled,
        delayMs: room.table.autoDealDelayMs,
      });
      publishRoomState(session.roomId);
      return;
    }

    if (parsed.type === "sit_down") {
      if (!session.roomId || !session.playerName) {
        sendJson(socket, {
          type: "error",
          message: "join_room before sit_down",
        });
        return;
      }

      const seatNumber = Number(parsed.seatNumber);
      if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > MAX_SEATS) {
        sendJson(socket, {
          type: "error",
          message: `seatNumber must be an integer between 1 and ${MAX_SEATS}`,
        });
        return;
      }

      const room = rooms.get(session.roomId);
      if (!room) {
        sendJson(socket, { type: "error", message: "room not found" });
        return;
      }

      if (room.hand.inProgress) {
        sendJson(socket, {
          type: "error",
          message: "cannot change seats during active round",
        });
        return;
      }

      for (const [memberSocket, player] of room.playersBySocket.entries()) {
        if (memberSocket !== socket && player.seatNumber === seatNumber) {
          sendJson(socket, { type: "error", message: "seat already taken" });
          return;
        }
      }

      const currentPlayer = room.playersBySocket.get(socket);
      if (!currentPlayer) {
        sendJson(socket, { type: "error", message: "player not found in room" });
        return;
      }

      currentPlayer.seatNumber = seatNumber;

      sendJson(socket, {
        type: "sat_down",
        roomId: session.roomId,
        playerName: currentPlayer.playerName,
        seatNumber,
      });

      publishRoomState(session.roomId);
      return;
    }

    if (parsed.type === "start_round") {
      if (!session.roomId) {
        sendJson(socket, { type: "error", message: "join_room before start_round" });
        return;
      }

      const room = rooms.get(session.roomId);
      if (!room) {
        sendJson(socket, { type: "error", message: "room not found" });
        return;
      }

      if (room.hand.inProgress) {
        sendJson(socket, { type: "error", message: "round already in progress" });
        return;
      }

      const result = startRound(room);
      if (!result.ok) {
        sendJson(socket, { type: "error", message: result.message });
        return;
      }

      sendJson(socket, {
        type: "round_started",
        roomId: session.roomId,
        turnSeatNumber: result.turnSeatNumber,
        street: result.street,
      });

      publishRoomState(session.roomId);
      return;
    }

    if (parsed.type === "player_action") {
      if (!session.roomId || !session.playerName) {
        sendJson(socket, { type: "error", message: "join_room before player_action" });
        return;
      }

      const actionType = parsed.actionType;
      if (!PLAYER_ACTIONS.has(actionType)) {
        sendJson(socket, {
          type: "error",
          message: "actionType must be fold, check, call, bet, or raise_to",
        });
        return;
      }

      const room = rooms.get(session.roomId);
      if (!room) {
        sendJson(socket, { type: "error", message: "room not found" });
        return;
      }

      if (!room.hand.inProgress) {
        sendJson(socket, { type: "error", message: "no active round" });
        return;
      }

      const currentPlayer = room.playersBySocket.get(socket);
      if (!currentPlayer || currentPlayer.seatNumber === null) {
        sendJson(socket, { type: "error", message: "you are not seated" });
        return;
      }

      if (currentPlayer.seatNumber !== room.hand.turnSeatNumber) {
        sendJson(socket, {
          type: "error",
          message: `not your turn; turnSeatNumber is ${room.hand.turnSeatNumber}`,
        });
        return;
      }

      const toCall = getPlayerToCallAmount(room, currentPlayer);
      const pendingSeatNumbersBeforeAction = new Set(room.hand.pendingSeatNumbers);
      let amountCommitted = 0;
      let note = null;

      if (actionType === "check") {
        if (toCall > 0) {
          sendJson(socket, {
            type: "error",
            message: `cannot check; call amount is ${toCall}`,
          });
          return;
        }
        room.hand.pendingSeatNumbers.delete(currentPlayer.seatNumber);
      } else if (actionType === "call") {
        if (toCall <= 0) {
          sendJson(socket, {
            type: "error",
            message: "nothing to call; use check",
          });
          return;
        }

        const callAmount = Math.min(toCall, currentPlayer.stack);
        if (callAmount <= 0) {
          sendJson(socket, { type: "error", message: "insufficient stack for call" });
          return;
        }

        currentPlayer.stack -= callAmount;
        currentPlayer.committedThisStreet += callAmount;
        currentPlayer.committedThisHand += callAmount;
        room.hand.pot += callAmount;
        amountCommitted = callAmount;
        if (callAmount < toCall) {
          note = "all_in_call";
        }
        room.hand.pendingSeatNumbers.delete(currentPlayer.seatNumber);
      } else if (actionType === "bet") {
        if (room.hand.currentBet > 0) {
          sendJson(socket, {
            type: "error",
            message: "bet only allowed when currentBet is 0; use raise_to",
          });
          return;
        }

        const amount = Number(parsed.amount);
        const betValidationError = validateBetAmount(amount, currentPlayer.stack);
        if (betValidationError) {
          sendJson(socket, { type: "error", message: betValidationError });
          return;
        }

        currentPlayer.stack -= amount;
        currentPlayer.committedThisStreet += amount;
        currentPlayer.committedThisHand += amount;
        room.hand.pot += amount;

        room.hand.currentBet = currentPlayer.committedThisStreet;
        room.hand.minRaiseTo = room.hand.currentBet * 2;
        room.hand.raiseClosedSeatNumbers.clear();
        amountCommitted = amount;
        note = `currentBet=${room.hand.currentBet}`;

        const activeSeatNumbers = getActionEligibleSeatNumbers(room);
        room.hand.pendingSeatNumbers = buildPendingSeatsAfterAggressiveAction(
          activeSeatNumbers,
          currentPlayer.seatNumber,
        );
      } else if (actionType === "raise_to") {
        if (room.hand.raiseClosedSeatNumbers.has(currentPlayer.seatNumber)) {
          sendJson(socket, {
            type: "error",
            message: "raising is not reopened for your seat; call or fold",
          });
          return;
        }

        if (room.hand.currentBet <= 0) {
          sendJson(socket, {
            type: "error",
            message: "raise_to requires an existing currentBet; use bet first",
          });
          return;
        }

        const targetAmount = Number(parsed.amount);
        const raiseValidationError = validateRaiseTarget({
          targetAmount,
          currentBet: room.hand.currentBet,
          currentCommittedThisStreet: currentPlayer.committedThisStreet,
          currentStack: currentPlayer.stack,
          minRaiseTo: room.hand.minRaiseTo,
        });
        if (raiseValidationError) {
          sendJson(socket, {
            type: "error",
            message: raiseValidationError,
          });
          return;
        }

        const amountToCommit = targetAmount - currentPlayer.committedThisStreet;
        const isAllInTarget = targetAmount === currentPlayer.committedThisStreet + currentPlayer.stack;
        const reopensAction = doesRaiseReopenAction(room.hand.minRaiseTo, targetAmount);

        const previousCurrentBet = room.hand.currentBet;

        currentPlayer.stack -= amountToCommit;
        currentPlayer.committedThisStreet += amountToCommit;
        currentPlayer.committedThisHand += amountToCommit;
        room.hand.pot += amountToCommit;

        room.hand.currentBet = currentPlayer.committedThisStreet;

        const raiseIncrement = room.hand.currentBet - previousCurrentBet;
        if (raiseIncrement > 0 && reopensAction) {
          room.hand.minRaiseTo = room.hand.currentBet + raiseIncrement;
        }
        amountCommitted = amountToCommit;
        note = isAllInTarget
          ? reopensAction
            ? "all_in_raise"
            : "all_in_raise_no_reopen"
          : `currentBet=${room.hand.currentBet}`;

        const activeSeatNumbers = getActionEligibleSeatNumbers(room);
        room.hand.pendingSeatNumbers = buildPendingSeatsAfterAggressiveAction(
          activeSeatNumbers,
          currentPlayer.seatNumber,
        );

        if (reopensAction) {
          room.hand.raiseClosedSeatNumbers.clear();
        } else {
          room.hand.raiseClosedSeatNumbers = buildRaiseClosedSeatNumbers(
            activeSeatNumbers,
            currentPlayer.seatNumber,
            pendingSeatNumbersBeforeAction,
          );
        }
      } else if (actionType === "fold") {
        room.hand.foldedSeatNumbers.add(currentPlayer.seatNumber);
        room.hand.pendingSeatNumbers.delete(currentPlayer.seatNumber);
      }

      room.hand.actionLog.push({
        seatNumber: currentPlayer.seatNumber,
        playerName: currentPlayer.playerName,
        actionType,
        amountCommitted,
        toCallBeforeAction: toCall,
        street: room.hand.street,
      });

      const foldEndResult = maybeEndRoundOnFold(room);
      if (foldEndResult !== null) {
        sendJson(socket, {
          type: "round_ended",
          roomId: session.roomId,
          winnerSeatNumber: foldEndResult.winnerSeatNumber,
          winnerSeatNumbers: foldEndResult.winnerSeatNumbers,
          payouts: foldEndResult.payouts,
          potBreakdown: foldEndResult.potBreakdown,
          showdown: foldEndResult.showdown,
          reason: foldEndResult.reason,
        });

        publishRoomState(session.roomId);
        return;
      }

      if (room.hand.pendingSeatNumbers.size === 0) {
        const progression = progressRoundWhenNoPending(room);
        for (const transition of progression.streetEvents) {
          sendJson(socket, {
            type: "street_advanced",
            roomId: session.roomId,
            street: transition.street,
            boardCards: transition.boardCards,
            turnSeatNumber: transition.turnSeatNumber,
          });
        }

        if (progression.ended) {
          sendJson(socket, {
            type: "round_ended",
            roomId: session.roomId,
            winnerSeatNumber: progression.endResult.winnerSeatNumber,
            winnerSeatNumbers: progression.endResult.winnerSeatNumbers,
            payouts: progression.endResult.payouts,
            potBreakdown: progression.endResult.potBreakdown,
            showdown: progression.endResult.showdown,
            reason: progression.endResult.reason,
          });
          publishRoomState(session.roomId);
          return;
        }

        publishRoomState(session.roomId);
        return;
      }

      room.hand.turnSeatNumber = getNextPendingTurnSeatNumber(
        room,
        currentPlayer.seatNumber,
      );

      sendJson(socket, {
        type: "action_applied",
        roomId: session.roomId,
        actionType,
        amountCommitted,
        nextTurnSeatNumber: room.hand.turnSeatNumber,
        note,
      });

      publishRoomState(session.roomId);
      return;
    }

    sendJson(socket, { type: "error", message: "unsupported message type" });
  });

  socket.on("close", () => {
    if (!session.roomId) return;

    const roomId = session.roomId;
    removeSocketFromRoom(roomId, socket);
    publishRoomState(roomId);
  });
});

await app.listen({ port: PORT, host: "0.0.0.0" });

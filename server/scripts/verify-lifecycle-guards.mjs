import { createRoundLifecycle } from "../src/services/roundLifecycle.js";
import {
  getActionEligibleSeatNumbers,
  getActiveSeatNumbers,
  getChipEligibleSeatedPlayers,
  getNextActiveSeatAfter,
  getNextPendingTurnSeatNumber,
  getNextSeatInList,
  getPlayerBySeatNumber,
  getSeatedPlayers,
} from "../src/services/roomQueries.js";

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function buildRoom(playerOverrides = []) {
  const playersBySocket = new Map();
  playerOverrides.forEach((overrides, index) => {
    const socketKey = `socket-${index}`;
    playersBySocket.set(socketKey, {
      playerName: `p${index + 1}`,
      seatNumber: index + 1,
      stack: 1000,
      committedThisStreet: 0,
      committedThisHand: 0,
      holeCards: [],
      ...overrides,
    });
  });

  return {
    id: "test-room",
    table: {
      smallBlind: 10,
      bigBlind: 20,
      dealerSeatNumber: null,
      autoDealEnabled: false,
      autoDealDelayMs: 1800,
      manualStepMode: false,
    },
    hand: {
      inProgress: false,
      street: null,
      board: [],
      deck: [],
      pot: 0,
      foldedSeatNumbers: new Set(),
      pendingSeatNumbers: new Set(),
      raiseClosedSeatNumbers: new Set(),
      actionLog: [],
      turnSeatNumber: null,
      currentBet: 0,
      minRaiseTo: null,
      lastEndReason: null,
      lastWinnerSeatNumber: null,
      lastWinnerSeatNumbers: [],
      lastPayouts: [],
      lastShowdown: null,
      lastPotBreakdown: [],
      dealerSeatNumber: null,
      smallBlindSeatNumber: null,
      bigBlindSeatNumber: null,
    },
    playersBySocket,
    members: [],
    hostSocket: null,
    serverBot: null,
    autoStartTimer: null,
  };
}

const lifecycle = createRoundLifecycle({
  clearAutoStartTimer: () => {},
  endRound: () => ({}),
  finishRoundWithWinners: () => ({}),
  getActionEligibleSeatNumbers,
  getActiveSeatNumbers,
  getChipEligibleSeatedPlayers,
  getNextActiveSeatAfter,
  getNextPendingTurnSeatNumber,
  getNextSeatInList,
  getPlayerBySeatNumber,
  getSeatedPlayers,
  resolveShowdown: () => ({}),
});

const tooFewSeated = lifecycle.startRound(buildRoom([{ stack: 1000 }]));
assert(
  tooFewSeated.ok === false && /at least 2 seated/.test(tooFewSeated.message ?? ""),
  "startRound should reject with <2 seated players",
);

const bustedOpponent = lifecycle.startRound(
  buildRoom([{ stack: 1000 }, { stack: 0 }]),
);
assert(
  bustedOpponent.ok === false,
  "startRound should reject when an opponent has 0 chips",
);
assert(
  bustedOpponent.code === "insufficient_chips",
  "startRound should tag insufficient-chip failures with code=insufficient_chips",
);
assert(
  /chips/.test(bustedOpponent.message ?? ""),
  "insufficient-chips failure should explain the reason",
);

const bothBusted = lifecycle.startRound(
  buildRoom([{ stack: 0 }, { stack: 0 }]),
);
assert(
  bothBusted.ok === false && bothBusted.code === "insufficient_chips",
  "startRound should reject when no one has chips",
);

const healthyTable = lifecycle.startRound(
  buildRoom([{ stack: 1000 }, { stack: 1000 }]),
);
assert(
  healthyTable.ok === true,
  "startRound should succeed when both players have chips",
);

console.log("verify-lifecycle-guards: passed");

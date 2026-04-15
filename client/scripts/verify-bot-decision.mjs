import { computeBotDecision } from "../src/lib/botDecision.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const baseRound = {
  inProgress: true,
  street: "flop",
  turnSeatNumber: 2,
  currentBet: 120,
  actionLog: [{ actionType: "bet" }, { actionType: "call" }],
};

const players = [
  { seatNumber: 1, committedThisStreet: 120, stack: 900 },
  { seatNumber: 2, committedThisStreet: 120, stack: 700 },
];

const checkDecision = computeBotDecision({ round: baseRound, players }, 2, null);
assert(checkDecision?.actionType === "check", "expected check decision when toCall is 0");

const callDecision = computeBotDecision(
  {
    round: { ...baseRound, currentBet: 200 },
    players: [
      { seatNumber: 1, committedThisStreet: 200, stack: 900 },
      { seatNumber: 2, committedThisStreet: 120, stack: 700 },
    ],
  },
  2,
  null,
);
assert(callDecision?.actionType === "call", "expected call decision when toCall <= stack");

const foldDecision = computeBotDecision(
  {
    round: { ...baseRound, currentBet: 500 },
    players: [
      { seatNumber: 1, committedThisStreet: 500, stack: 900 },
      { seatNumber: 2, committedThisStreet: 120, stack: 100 },
    ],
  },
  2,
  null,
);
assert(foldDecision?.actionType === "fold", "expected fold decision when toCall > stack");

const duplicateDecision = computeBotDecision({ round: baseRound, players }, 2, checkDecision.actionKey);
assert(duplicateDecision === null, "expected null decision when action key already consumed");

console.log("verify-bot-decision: passed");

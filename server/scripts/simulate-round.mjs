import WebSocket from "ws";
import { buildPotsFromCommitments, resolvePots } from "../src/engine/potResolution.js";
import { compareHandRanks } from "../src/engine/handEvaluator.js";
import { doesRaiseReopenAction } from "../src/engine/bettingRules.js";

const WS_URL = process.env.WS_URL || "ws://127.0.0.1:3000/ws";
const ROOM_ID = `sim-room-${Date.now()}`;
const TIMEOUT_MS = 12000;

function createClient(tag) {
  const socket = new WebSocket(WS_URL);
  const parsedMessages = [];

  socket.on("message", (data) => {
    const text = data.toString();
    console.log(tag, text);
    try {
      parsedMessages.push(JSON.parse(text));
    } catch {
      // ignore non-json frames
    }
  });

  socket.on("error", (error) => {
    console.error(tag, "socket error", error.message);
  });

  return { socket, tag, parsedMessages };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function send(client, payload, label) {
  client.socket.send(JSON.stringify(payload));
  console.log(client.tag, "[out]", label);
}

async function waitFor(condition, timeoutMs = TIMEOUT_MS, pollMs = 25) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = condition();
    if (result) return result;
    await sleep(pollMs);
  }
  throw new Error("Timed out waiting for condition");
}

async function waitForOpen(client) {
  if (client.socket.readyState === WebSocket.OPEN) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${client.tag} open timeout`)), TIMEOUT_MS);
    client.socket.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function getLatestRoomState(client) {
  for (let index = client.parsedMessages.length - 1; index >= 0; index -= 1) {
    const message = client.parsedMessages[index];
    if (message.type === "room_state") return message;
  }
  return null;
}

async function waitForTurn(client, seatNumber, street) {
  await waitFor(() => {
    const state = getLatestRoomState(client);
    return (
      state &&
      state.round?.inProgress &&
      state.round?.street === street &&
      state.round?.turnSeatNumber === seatNumber
    );
  });
}

async function waitForRoundEnded(client, fromIndex = 0) {
  return waitFor(() => {
    for (let index = client.parsedMessages.length - 1; index >= fromIndex; index -= 1) {
      const message = client.parsedMessages[index];
      if (message.type === "round_ended") return message;
    }
    return null;
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function runDeterministicPotMathAssertions() {
  assert(doesRaiseReopenAction(200, 200) === true, "full raise should reopen action");
  assert(doesRaiseReopenAction(200, 240) === true, "larger raise should reopen action");
  assert(doesRaiseReopenAction(200, 150) === false, "short raise should not reopen action");

  const foldEligibilityPots = buildPotsFromCommitments([
    { seatNumber: 1, committed: 100, folded: false },
    { seatNumber: 2, committed: 300, folded: true },
    { seatNumber: 3, committed: 300, folded: false },
  ]);
  assert(foldEligibilityPots.length === 2, "folded-eligibility scenario should create 2 pots");
  assert(foldEligibilityPots[0].amount === 300, "folded-eligibility main pot should be 300");
  assert(
    JSON.stringify(foldEligibilityPots[0].eligibleSeatNumbers) === JSON.stringify([1, 3]),
    "folded player must be excluded from main-pot eligibility",
  );
  assert(foldEligibilityPots[1].amount === 400, "folded-eligibility side pot should be 400");
  assert(
    JSON.stringify(foldEligibilityPots[1].eligibleSeatNumbers) === JSON.stringify([3]),
    "folded player must be excluded from side-pot eligibility",
  );

  const splitOddChipPots = [{ amount: 101, eligibleSeatNumbers: [1, 2] }];
  const tiedRanks = new Map([
    [1, { seatNumber: 1, rank: { category: 1, tiebreakers: [14, 13, 12, 11] } }],
    [2, { seatNumber: 2, rank: { category: 1, tiebreakers: [14, 13, 12, 11] } }],
  ]);
  const splitOddChipResult = resolvePots(splitOddChipPots, tiedRanks, compareHandRanks);
  assert(splitOddChipResult.payouts.length === 2, "split odd-chip should produce two payouts");
  assert(splitOddChipResult.totalPaid === 101, "split odd-chip should pay full pot amount");
  assert(splitOddChipResult.payouts[0].seatNumber === 1, "odd-chip payout should be sorted by seat");
  assert(splitOddChipResult.payouts[0].amount === 51, "odd chip should be awarded to first sorted winner");
  assert(splitOddChipResult.payouts[1].seatNumber === 2, "second payout should be seat 2");
  assert(splitOddChipResult.payouts[1].amount === 50, "second winner should receive floor split");
}

async function run() {
  runDeterministicPotMathAssertions();

  const alice = createClient("alice>");
  const bob = createClient("bob>");
  const carol = createClient("carol>");

  await Promise.all([waitForOpen(alice), waitForOpen(bob), waitForOpen(carol)]);

  send(alice, { type: "join_room", roomId: ROOM_ID, playerName: "alice" }, "join_room alice");
  send(bob, { type: "join_room", roomId: ROOM_ID, playerName: "bob" }, "join_room bob");
  send(carol, { type: "join_room", roomId: ROOM_ID, playerName: "carol" }, "join_room carol");
  await sleep(150);
  send(alice, { type: "sit_down", seatNumber: 1 }, "sit_down 1");
  send(bob, { type: "sit_down", seatNumber: 2 }, "sit_down 2");
  send(carol, { type: "sit_down", seatNumber: 3 }, "sit_down 3");
  await sleep(150);

  // Host sets deterministic simulation behavior.
  send(alice, { type: "set_auto_deal", enabled: false, delayMs: 1800 }, "set_auto_deal off");
  await sleep(120);

  // Hand 1: force uneven stacks by making seat 1 fold after heavy commit.
  const hand1StartIndex = alice.parsedMessages.length;
  send(alice, { type: "start_round" }, "start_round hand1");
  await waitForTurn(alice, 1, "preflop");
  send(alice, { type: "player_action", actionType: "raise_to", amount: 600 }, "h1 p1 raise_to 600");
  await waitForTurn(alice, 2, "preflop");
  send(bob, { type: "player_action", actionType: "fold" }, "h1 p2 fold");
  await waitForTurn(alice, 3, "preflop");
  send(carol, { type: "player_action", actionType: "call" }, "h1 p3 call");
  await waitForTurn(alice, 3, "flop");
  send(carol, { type: "player_action", actionType: "bet", amount: 100 }, "h1 p3 bet 100");
  await waitForTurn(alice, 1, "flop");
  send(alice, { type: "player_action", actionType: "fold" }, "h1 p1 fold");
  const hand1Ended = await waitForRoundEnded(alice, hand1StartIndex);
  assert(hand1Ended.reason === "fold_winner", "hand1 should end by fold_winner");

  // Hand 2: side-pot setup with seat 1 short stack all-in.
  const hand2StartIndex = alice.parsedMessages.length;
  send(alice, { type: "start_round" }, "start_round hand2");
  await waitForTurn(alice, 2, "preflop");
  send(bob, { type: "player_action", actionType: "raise_to", amount: 500 }, "h2 p2 raise_to 500");
  await waitForTurn(alice, 3, "preflop");
  send(carol, { type: "player_action", actionType: "call" }, "h2 p3 call");
  await waitForTurn(alice, 1, "preflop");
  send(alice, { type: "player_action", actionType: "call" }, "h2 p1 all_in_call");

  // No more betting: check down with action-eligible players.
  await waitForTurn(alice, 3, "flop");
  send(carol, { type: "player_action", actionType: "check" }, "h2 p3 check flop");
  await waitForTurn(alice, 2, "flop");
  send(bob, { type: "player_action", actionType: "check" }, "h2 p2 check flop");
  await waitForTurn(alice, 3, "turn");
  send(carol, { type: "player_action", actionType: "check" }, "h2 p3 check turn");
  await waitForTurn(alice, 2, "turn");
  send(bob, { type: "player_action", actionType: "check" }, "h2 p2 check turn");
  await waitForTurn(alice, 3, "river");
  send(carol, { type: "player_action", actionType: "check" }, "h2 p3 check river");
  await waitForTurn(alice, 2, "river");
  send(bob, { type: "player_action", actionType: "check" }, "h2 p2 check river");

  const hand2Ended = await waitForRoundEnded(bob, hand2StartIndex);
  const potBreakdown = hand2Ended.potBreakdown ?? [];
  assert(potBreakdown.length >= 2, "hand2 should include side-pot breakdown");
  assert(potBreakdown[0].amount === 1200, "main pot should be 1200");
  assert(potBreakdown[1].amount === 200, "first side pot should be 200");
  assert(
    JSON.stringify(potBreakdown[0].eligibleSeatNumbers) === JSON.stringify([1, 2, 3]),
    "main pot eligible seats should be [1,2,3]",
  );
  assert(
    JSON.stringify(potBreakdown[1].eligibleSeatNumbers) === JSON.stringify([2, 3]),
    "side pot eligible seats should be [2,3]",
  );
  const totalPayout = (hand2Ended.payouts ?? []).reduce((sum, payout) => sum + (payout.amount ?? 0), 0);
  assert(totalPayout === 1400, "total payout should equal 1400");

  console.log("simulate-round: all assertions passed");

  alice.socket.close();
  bob.socket.close();
  carol.socket.close();
}

run().catch((error) => {
  console.error("simulate-round failed:", error.message);
  process.exitCode = 1;
});

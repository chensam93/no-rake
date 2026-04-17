import WebSocket from "ws";
import { buildPotsFromCommitments, resolvePots } from "../src/engine/potResolution.js";
import { compareHandRanks } from "../src/engine/handEvaluator.js";
import { doesRaiseReopenAction, computeNextMinRaiseTo } from "../src/engine/bettingRules.js";
import { validateRaiseTarget } from "../src/engine/actionValidation.js";

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

function getPlayerStateBySeatNumber(roomState, seatNumber) {
  return (roomState?.players ?? []).find((player) => player.seatNumber === seatNumber) ?? null;
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

async function waitForActionAppliedMessage(client, fromIndex = 0, expectedActionType = null) {
  return waitFor(() => {
    for (let index = client.parsedMessages.length - 1; index >= fromIndex; index -= 1) {
      const message = client.parsedMessages[index];
      if (message.type !== "action_applied") continue;
      if (!expectedActionType || message.actionType === expectedActionType) {
        return message;
      }
    }
    return null;
  });
}

async function waitForErrorMessage(client, fromIndex = 0, expectedText = null) {
  return waitFor(() => {
    for (let index = client.parsedMessages.length - 1; index >= fromIndex; index -= 1) {
      const message = client.parsedMessages[index];
      if (message.type !== "error" || typeof message.message !== "string") continue;
      if (!expectedText || message.message.includes(expectedText)) {
        return message;
      }
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

  const shortAllInNextMinRaiseTo = computeNextMinRaiseTo({
    previousCurrentBet: 100,
    previousMinRaiseTo: 200,
    nextCurrentBet: 150,
    raiseIncrement: 50,
    reopensAction: false,
  });
  assert(
    shortAllInNextMinRaiseTo === 250,
    "short all-in should keep full raise size and set minRaiseTo to 250",
  );
  const shortRaiseValidationError = validateRaiseTarget({
    targetAmount: 200,
    currentBet: 150,
    currentCommittedThisStreet: 150,
    currentStack: 1000,
    minRaiseTo: shortAllInNextMinRaiseTo,
  });
  assert(
    shortRaiseValidationError === "raise_to must be at least 250 unless all-in",
    "re-raise to 200 must be rejected after short all-in",
  );

  const fullRaiseNextMinRaiseTo = computeNextMinRaiseTo({
    previousCurrentBet: 100,
    previousMinRaiseTo: 200,
    nextCurrentBet: 250,
    raiseIncrement: 150,
    reopensAction: true,
  });
  assert(
    fullRaiseNextMinRaiseTo === 400,
    "full raise should move minRaiseTo to currentBet plus raise size",
  );

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
  const clientsBySeatNumber = new Map([
    [1, alice],
    [2, bob],
    [3, carol],
  ]);

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

  // Hand 3: regression scenario for short all-in raise not reopening action.
  const hand3StartIndex = alice.parsedMessages.length;
  send(alice, { type: "start_round" }, "start_round hand3");
  await waitForTurn(alice, 3, "preflop");

  const hand3PreRaiseState = getLatestRoomState(alice);
  const seat3StatePreRaise = getPlayerStateBySeatNumber(hand3PreRaiseState, 3);
  const seat1StatePreRaise = getPlayerStateBySeatNumber(hand3PreRaiseState, 1);
  const seat2StatePreRaise = getPlayerStateBySeatNumber(hand3PreRaiseState, 2);
  const currentBetPreRaise = Number(hand3PreRaiseState?.round?.currentBet ?? 0);
  const minRaiseToPreRaise = Number(hand3PreRaiseState?.round?.minRaiseTo ?? 0);
  const seat3MaxTarget = Number(seat3StatePreRaise?.committedThisStreet ?? 0) + Number(seat3StatePreRaise?.stack ?? 0);
  const seat1AllInTargetPreRaise =
    Number(seat1StatePreRaise?.committedThisStreet ?? 0) + Number(seat1StatePreRaise?.stack ?? 0);
  const seat2AllInTargetPreRaise =
    Number(seat2StatePreRaise?.committedThisStreet ?? 0) + Number(seat2StatePreRaise?.stack ?? 0);
  const maxOpponentAllInTargetPreRaise = Math.max(seat1AllInTargetPreRaise, seat2AllInTargetPreRaise);

  const requiredOpenRaiseTarget = Math.floor((maxOpponentAllInTargetPreRaise + currentBetPreRaise) / 2) + 1;
  const openRaiseTarget = Math.max(minRaiseToPreRaise, requiredOpenRaiseTarget);
  assert(
    openRaiseTarget < seat3MaxTarget,
    "hand3 setup requires seat 3 to have enough stack for reopening raise setup",
  );

  send(
    carol,
    { type: "player_action", actionType: "raise_to", amount: openRaiseTarget },
    `h3 p3 raise_to ${openRaiseTarget}`,
  );
  const hand3PostOpenRaiseState = await waitFor(() => {
    const state = getLatestRoomState(alice);
    if (!state?.round?.inProgress || state.round.street !== "preflop") return null;
    const turnSeatNumber = Number(state.round.turnSeatNumber ?? 0);
    if (!turnSeatNumber || turnSeatNumber === 3) return null;
    return state;
  });
  const hand3MinRaiseToAfterOpen = Number(hand3PostOpenRaiseState?.round?.minRaiseTo ?? 0);
  const getShortAllInTarget = (roomState, seatNumber) => {
    const seatState = getPlayerStateBySeatNumber(roomState, seatNumber);
    if (!seatState) return null;
    const currentBet = Number(roomState?.round?.currentBet ?? 0);
    const allInTarget = Number(seatState.committedThisStreet ?? 0) + Number(seatState.stack ?? 0);
    if (allInTarget <= currentBet) return null;
    if (allInTarget >= hand3MinRaiseToAfterOpen) return null;
    return allInTarget;
  };

  let shortAllInTurnState = hand3PostOpenRaiseState;
  let shortAllInSeatNumber = Number(shortAllInTurnState.round.turnSeatNumber);
  let shortAllInTarget = getShortAllInTarget(shortAllInTurnState, shortAllInSeatNumber);
  if (shortAllInTarget === null) {
    const foldingActorClient = clientsBySeatNumber.get(shortAllInSeatNumber);
    assert(foldingActorClient, "hand3 expected fold client before short all-in");
    send(
      foldingActorClient,
      { type: "player_action", actionType: "fold" },
      `h3 p${shortAllInSeatNumber} fold (cannot short all-in)`,
    );
    shortAllInTurnState = await waitFor(() => {
      const state = getLatestRoomState(alice);
      if (!state?.round?.inProgress || state.round.street !== "preflop") return null;
      const turnSeat = Number(state.round.turnSeatNumber ?? 0);
      if (!turnSeat || turnSeat === shortAllInSeatNumber) return null;
      return state;
    });
    shortAllInSeatNumber = Number(shortAllInTurnState.round.turnSeatNumber);
    shortAllInTarget = getShortAllInTarget(shortAllInTurnState, shortAllInSeatNumber);
  }
  assert(
    shortAllInTarget !== null,
    "hand3 requires an acting seat with a valid short all-in target",
  );
  const shortAllInActorClient = clientsBySeatNumber.get(shortAllInSeatNumber);
  assert(shortAllInActorClient, "hand3 expected short all-in actor client");
  const shortAllInActionStartIndex = shortAllInActorClient.parsedMessages.length;
  send(
    shortAllInActorClient,
    { type: "player_action", actionType: "raise_to", amount: shortAllInTarget },
    `h3 p${shortAllInSeatNumber} short-all-in raise_to ${shortAllInTarget}`,
  );
  const shortAllInAppliedMessage = await waitForActionAppliedMessage(
    shortAllInActorClient,
    shortAllInActionStartIndex,
    "raise_to",
  );
  assert(
    shortAllInAppliedMessage.note === "all_in_raise_no_reopen",
    "short all-in raise should emit all_in_raise_no_reopen action note",
  );
  const hand3PostShortAllInState = await waitFor(() => {
    const state = getLatestRoomState(alice);
    if (!state?.round?.inProgress || state.round.street !== "preflop") return null;
    const turnSeatNumber = Number(state.round.turnSeatNumber ?? 0);
    if (!turnSeatNumber || turnSeatNumber === shortAllInSeatNumber) return null;
    return state;
  });
  const hand3CurrentBetAfterShortAllIn = Number(hand3PostShortAllInState?.round?.currentBet ?? 0);
  const hand3MinRaiseToAfterShortAllIn = Number(hand3PostShortAllInState?.round?.minRaiseTo ?? 0);
  const expectedShortAllInMinRaiseTo =
    hand3CurrentBetAfterShortAllIn + (openRaiseTarget - currentBetPreRaise);
  assert(
    hand3MinRaiseToAfterShortAllIn === expectedShortAllInMinRaiseTo,
    "hand3 minRaiseTo should carry prior full raise size after short all-in",
  );

  // Cleanly end hand 3 after regression assertion.
  while (true) {
    const latestHand3State = getLatestRoomState(alice);
    if (!latestHand3State?.round?.inProgress) break;
    const pendingSeatNumbers = Array.isArray(latestHand3State.round.pendingSeatNumbers)
      ? latestHand3State.round.pendingSeatNumbers
      : [];
    if (pendingSeatNumbers.length === 0) break;
    const nextTurnSeatNumber = Number(latestHand3State.round.turnSeatNumber ?? 0);
    if (!nextTurnSeatNumber) break;
    const nextTurnClient = clientsBySeatNumber.get(nextTurnSeatNumber);
    assert(nextTurnClient, "hand3 expected next actor client during cleanup");
    send(nextTurnClient, { type: "player_action", actionType: "fold" }, `h3 p${nextTurnSeatNumber} fold`);
    await sleep(40);
  }
  const hand3ResolvedRoundState = await waitFor(() => {
    const state = getLatestRoomState(alice);
    if (!state?.round) return null;
    if (state.round.inProgress) return null;
    if (!state.round.lastEndReason) return null;
    return state.round;
  });
  assert(
    hand3ResolvedRoundState.lastEndReason === "fold_winner" ||
      hand3ResolvedRoundState.lastEndReason === "showdown",
    "hand3 should end after cleanup actions",
  );

  // Hand 4: seeded server-bot scenario for deterministic bot control coverage.
  send(
    alice,
    { type: "set_server_bot", enabled: true, seatNumber: 4, profile: "lag" },
    "set_server_bot seat4",
  );
  send(alice, { type: "set_server_bot_seed", seed: 90210 }, "set_server_bot_seed");
  send(alice, { type: "set_server_bot_delay", delayMs: 0 }, "set_server_bot_delay");
  await sleep(120);
  const hand4StartIndex = alice.parsedMessages.length;
  send(alice, { type: "start_round" }, "start_round hand4");

  await waitFor(() => {
    const state = getLatestRoomState(alice);
    return state?.round?.inProgress && state.round.street === "preflop";
  });

  let observedBotPlayerAction = false;
  for (let steps = 0; steps < 10; steps += 1) {
    const state = getLatestRoomState(alice);
    if (!state?.round?.inProgress) break;
    const actionLog = Array.isArray(state.round?.actionLog) ? state.round.actionLog : [];
    observedBotPlayerAction = actionLog.some(
      (action) =>
        action.seatNumber === 4 &&
        ["fold", "check", "call", "bet", "raise_to"].includes(action.actionType),
    );
    if (observedBotPlayerAction) break;
    const turnSeat = Number(state.round?.turnSeatNumber ?? 0);
    if (!turnSeat) {
      await sleep(40);
      continue;
    }
    if (turnSeat === 4) {
      await waitFor(() => {
        const nextState = getLatestRoomState(alice);
        const nextActionLog = Array.isArray(nextState?.round?.actionLog) ? nextState.round.actionLog : [];
        return nextActionLog.length > actionLog.length || nextState?.round?.turnSeatNumber !== 4;
      });
      continue;
    }
    const actorClient = clientsBySeatNumber.get(turnSeat);
    if (!actorClient) {
      await sleep(40);
      continue;
    }
    const actingPlayer = getPlayerStateBySeatNumber(state, turnSeat);
    const actingToCall = Math.max(
      0,
      Number(state.round?.currentBet ?? 0) - Number(actingPlayer?.committedThisStreet ?? 0),
    );
    if (actingToCall <= 0) {
      send(actorClient, { type: "player_action", actionType: "check" }, `h4 p${turnSeat} check`);
    } else {
      send(actorClient, { type: "player_action", actionType: "call" }, `h4 p${turnSeat} call`);
    }
    await sleep(40);
  }

  assert(observedBotPlayerAction, "hand4 should include at least one server-bot player action");
  while (true) {
    const latestHand4State = getLatestRoomState(alice);
    if (!latestHand4State?.round?.inProgress) break;
    const turnSeatNumber = Number(latestHand4State.round.turnSeatNumber ?? 0);
    if (!turnSeatNumber) {
      await sleep(40);
      continue;
    }
    if (turnSeatNumber === 4) {
      await sleep(40);
      continue;
    }
    const turnClient = clientsBySeatNumber.get(turnSeatNumber);
    if (!turnClient) {
      await sleep(40);
      continue;
    }
    send(turnClient, { type: "player_action", actionType: "fold" }, `h4 cleanup p${turnSeatNumber} fold`);
    await sleep(40);
  }
  const hand4ResolvedRoundState = await waitFor(() => {
    const state = getLatestRoomState(alice);
    if (!state?.round || state.round.inProgress) return null;
    if (!state.round.lastEndReason) return null;
    return state.round;
  });
  assert(
    hand4ResolvedRoundState.lastEndReason === "fold_winner" ||
      hand4ResolvedRoundState.lastEndReason === "showdown",
    "hand4 should resolve after bot-action scenario",
  );
  send(alice, { type: "set_server_bot", enabled: false, seatNumber: 4 }, "clear_server_bot seat4");
  await sleep(120);

  console.log("simulate-round: all assertions passed");

  alice.socket.close();
  bob.socket.close();
  carol.socket.close();
}

run().catch((error) => {
  console.error("simulate-round failed:", error.message);
  process.exitCode = 1;
});

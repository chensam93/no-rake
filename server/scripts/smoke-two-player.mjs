import WebSocket from "ws";

const WS_URL = process.env.WS_URL || "ws://127.0.0.1:3000/ws";
const ROOM_ID = `smoke-two-${Date.now()}`;
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
  return { socket, parsedMessages, tag };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function send(client, payload, label) {
  client.socket.send(JSON.stringify(payload));
  console.log(client.tag, "[out]", label);
}

async function waitFor(condition) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < TIMEOUT_MS) {
    const result = condition();
    if (result) return result;
    await sleep(25);
  }
  throw new Error("Timed out waiting for condition");
}

function latestState(client) {
  for (let index = client.parsedMessages.length - 1; index >= 0; index -= 1) {
    const message = client.parsedMessages[index];
    if (message.type === "room_state") return message;
  }
  return null;
}

async function waitForTurn(client, seatNumber) {
  await waitFor(() => {
    const state = latestState(client);
    return state?.round?.inProgress && state.round.turnSeatNumber === seatNumber;
  });
}

async function waitForRoundEnded(client) {
  return waitFor(() => {
    for (let index = client.parsedMessages.length - 1; index >= 0; index -= 1) {
      const message = client.parsedMessages[index];
      if (message.type === "round_ended") return message;
    }
    return null;
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function run() {
  const alice = createClient("alice>");
  const bob = createClient("bob>");
  await Promise.all([waitForOpen(alice), waitForOpen(bob)]);

  send(alice, { type: "join_room", roomId: ROOM_ID, playerName: "alice" }, "join_room");
  send(bob, { type: "join_room", roomId: ROOM_ID, playerName: "bob" }, "join_room");
  await sleep(120);
  send(alice, { type: "sit_down", seatNumber: 1 }, "sit_down 1");
  send(bob, { type: "sit_down", seatNumber: 2 }, "sit_down 2");
  await sleep(120);
  send(alice, { type: "set_auto_deal", enabled: false, delayMs: 1800 }, "set_auto_deal off");
  await sleep(120);
  const preRoundState = await waitFor(() => {
    const state = latestState(alice);
    if (!state) return null;
    if (state.round?.inProgress) return null;
    if (!Array.isArray(state.players) || state.players.length !== 2) return null;
    return state;
  });
  const startingStack = preRoundState.players[0]?.stack ?? 1000;
  send(alice, { type: "start_round" }, "start_round");

  const roundStartedState = await waitFor(() => {
    const state = latestState(alice);
    if (!state?.round?.inProgress) return null;
    return state;
  });
  assert(roundStartedState.round.dealerSeatNumber === 1, "heads-up dealer should be seat 1");
  assert(roundStartedState.round.smallBlindSeatNumber === 1, "heads-up dealer should post small blind");
  assert(roundStartedState.round.bigBlindSeatNumber === 2, "heads-up non-dealer should post big blind");
  assert(roundStartedState.round.turnSeatNumber === 1, "heads-up preflop action should start with small blind");

  await waitForTurn(alice, 1);
  send(alice, { type: "player_action", actionType: "call" }, "call");
  await waitForTurn(alice, 2);
  send(bob, { type: "player_action", actionType: "check" }, "check");
  await waitForTurn(alice, 2);
  send(bob, { type: "player_action", actionType: "check" }, "check");
  await waitForTurn(alice, 1);
  send(alice, { type: "player_action", actionType: "check" }, "check");
  await waitForTurn(alice, 2);
  send(bob, { type: "player_action", actionType: "check" }, "check");
  await waitForTurn(alice, 1);
  send(alice, { type: "player_action", actionType: "check" }, "check");
  await waitForTurn(alice, 2);
  send(bob, { type: "player_action", actionType: "check" }, "check");

  await waitForTurn(alice, 1);
  send(alice, { type: "player_action", actionType: "check" }, "check");

  const ended = await waitForRoundEnded(alice);
  if (!ended.winnerSeatNumber || !Array.isArray(ended.payouts)) {
    throw new Error("invalid round_ended payload");
  }

  send(alice, { type: "end_game" }, "end_game");
  const resetState = await waitFor(() => {
    const state = latestState(alice);
    if (!state) return null;
    if (state.round?.inProgress) return null;
    if (state.round?.street !== null) return null;
    if ((state.round?.pot ?? 0) !== 0) return null;
    if (state.round?.dealerSeatNumber !== null) return null;
    return state;
  });
  const resetPlayers = Array.isArray(resetState.players) ? resetState.players : [];
  assert(resetPlayers.length === 2, "expected two seated players after reset");
  for (const player of resetPlayers) {
    assert(player.stack === startingStack, "end_game should restore starting stack");
    assert((player.committedThisStreet ?? 0) === 0, "end_game should clear street commitment");
    assert((player.committedThisHand ?? 0) === 0, "end_game should clear hand commitment");
    assert((player.holeCards ?? []).length === 0, "end_game should clear hole cards");
  }

  console.log("smoke-two-player: passed");
  alice.socket.close();
  bob.socket.close();
}

run().catch((error) => {
  console.error("smoke-two-player failed:", error.message);
  process.exitCode = 1;
});

import WebSocket from "ws";

const WS_URL = process.env.WS_URL || "ws://127.0.0.1:3000/ws";

function createClient(tag) {
  const socket = new WebSocket(WS_URL);

  socket.on("message", (data) => {
    console.log(tag, data.toString());
  });

  socket.on("error", (error) => {
    console.error(tag, "socket error", error.message);
  });

  return socket;
}

const alice = createClient("alice>");
const bob = createClient("bob>");

alice.on("open", () => {
  alice.send(JSON.stringify({ type: "join_room", roomId: "home", playerName: "alice" }));
  setTimeout(() => alice.send(JSON.stringify({ type: "sit_down", seatNumber: 1 })), 120);
});

bob.on("open", () => {
  bob.send(JSON.stringify({ type: "join_room", roomId: "home", playerName: "bob" }));
  setTimeout(() => bob.send(JSON.stringify({ type: "sit_down", seatNumber: 2 })), 150);
  setTimeout(() => bob.send(JSON.stringify({ type: "start_round" })), 220);
});

setTimeout(() => {
  alice.send(JSON.stringify({ type: "player_action", actionType: "bet", amount: 40 }));
}, 350);

setTimeout(() => {
  bob.send(JSON.stringify({ type: "player_action", actionType: "raise_to", amount: 100 }));
}, 480);

setTimeout(() => {
  alice.send(JSON.stringify({ type: "player_action", actionType: "call" }));
}, 620);

setTimeout(() => {
  bob.send(JSON.stringify({ type: "player_action", actionType: "fold" }));
}, 760);

setTimeout(() => {
  alice.close();
  bob.close();
}, 1100);

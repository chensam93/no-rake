import websocket from "@fastify/websocket";
import Fastify from "fastify";
import {
  compareHandRanks as compareHandRanksFromModule,
  evaluateBestHand as evaluateBestHandFromModule,
  formatRankLabel as formatRankLabelFromModule,
} from "./engine/handEvaluator.js";
import { clearAutoStartTimer, maybeScheduleAutoStart } from "./services/autoDealScheduler.js";
import { rooms, getOrCreateRoom, getRoom, removeSocketFromRoom } from "./services/roomRegistry.js";
import {
  getActionEligibleSeatNumbers,
  getActiveSeatNumbers,
  getNextActiveSeatAfter,
  getNextPendingTurnSeatNumber,
  getNextSeatInList,
  getPlayerBySeatNumber,
  getSeatedPlayers,
  getSortedPlayers,
} from "./services/roomQueries.js";
import { createRoundLifecycle } from "./services/roundLifecycle.js";
import { createServerBotService } from "./services/serverBotService.js";
import { createShowdownService } from "./services/showdownService.js";
import { publishRoomState as publishRoomStateFromModule } from "./serializers/publishRoomState.js";
import { createMessageRouter } from "./ws/messageRouter.js";

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT) || 3000;
const STARTING_STACK = 1000;
const MAX_SEATS = 9;

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

const publishRoomState = (roomId) =>
  publishRoomStateFromModule(roomId, rooms, sendJson, getSortedPlayers);

let startRoundRef = null;
let runInternalPlayerActionRef = null;
const maybeScheduleWithContext = (room, reason = null) =>
  maybeScheduleAutoStart(room, reason, {
    rooms,
    getSeatedPlayers,
    startRound: (targetRoom) => startRoundRef(targetRoom),
    maybeScheduleServerBotAction: (targetRoom) => serverBotService.maybeScheduleBotAction(targetRoom),
    sendJson,
    publishRoomState,
  });

const showdownService = createShowdownService({
  compareHandRanks: compareHandRanksFromModule,
  evaluateBestHand: evaluateBestHandFromModule,
  formatRankLabel: formatRankLabelFromModule,
  getPlayerBySeatNumber,
  getSeatedPlayers,
  maybeScheduleAutoStart: maybeScheduleWithContext,
});

const roundLifecycle = createRoundLifecycle({
  clearAutoStartTimer,
  endRound: showdownService.endRound,
  finishRoundWithWinners: showdownService.finishRoundWithWinners,
  getActionEligibleSeatNumbers,
  getActiveSeatNumbers,
  getNextActiveSeatAfter,
  getNextPendingTurnSeatNumber,
  getNextSeatInList,
  getPlayerBySeatNumber,
  getSeatedPlayers,
  resolveShowdown: showdownService.resolveShowdown,
});
startRoundRef = roundLifecycle.startRound;

const serverBotService = createServerBotService({
  MAX_SEATS,
  STARTING_STACK,
  rooms,
  evaluateBestHand: evaluateBestHandFromModule,
  getPlayerBySeatNumber,
  maybeResolveHandAfterMembershipChange: roundLifecycle.maybeResolveHandAfterMembershipChange,
  runInternalPlayerAction: (socket, session, parsed) => {
    if (typeof runInternalPlayerActionRef === "function") {
      runInternalPlayerActionRef(socket, session, parsed);
    }
  },
});

const router = createMessageRouter({
  MAX_SEATS,
  STARTING_STACK,
  clearAutoStartTimer,
  getActionEligibleSeatNumbers,
  getOrCreateRoom,
  getNextPendingTurnSeatNumber,
  getPlayerToCallAmount: roundLifecycle.getPlayerToCallAmount,
  getRoom,
  maybeEndRoundOnFold: roundLifecycle.maybeEndRoundOnFold,
  maybeResolveHandAfterMembershipChange: roundLifecycle.maybeResolveHandAfterMembershipChange,
  maybeScheduleAutoStart: maybeScheduleWithContext,
  maybeScheduleServerBotAction: serverBotService.maybeScheduleBotAction,
  progressRoundWhenNoPending: roundLifecycle.progressRoundWhenNoPending,
  publishRoomState,
  runServerBotStep: serverBotService.runBotStep,
  setServerBotSeat: serverBotService.setBotSeat,
  clearServerBotSeat: serverBotService.clearBotSeat,
  setServerBotProfile: serverBotService.setBotProfile,
  setServerBotSeed: serverBotService.setBotSeed,
  setServerBotDelay: serverBotService.setBotDelay,
  removeSocketFromRoom: (roomId, socket) =>
    removeSocketFromRoom(roomId, socket, {
      maybeResolveHandAfterMembershipChange: roundLifecycle.maybeResolveHandAfterMembershipChange,
      clearAutoStartTimer,
      clearServerBotTimer: serverBotService.clearBotTimer,
    }),
  sendJson,
  startRound: roundLifecycle.startRound,
});
runInternalPlayerActionRef = router.runInternalPlayerAction;

function renderSmokePage() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>No Rake - WS smoke page</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
      pre { background: #f5f5f5; padding: 0.75rem; border-radius: 6px; min-height: 10rem; }
    </style>
  </head>
  <body>
    <h1>No Rake smoke page</h1>
    <p>Socket URL: <code>ws://127.0.0.1:${PORT}/ws</code></p>
    <pre>Use the client app or scripts for full workflow checks.</pre>
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

  router.sendHello(socket);

  socket.on("message", (raw) => {
    router.handleMessage(socket, session, raw);
  });

  socket.on("close", () => {
    router.handleClose(socket, session);
  });
});

await app.listen({ port: PORT, host: "0.0.0.0" });

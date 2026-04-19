import { createHostAdminHandlers } from "./handlers/hostAdminHandlers.js";
import { createPlayerActionHandlers } from "./handlers/playerActionHandlers.js";
import { createSessionHandlers } from "./handlers/sessionHandlers.js";
import { createTableControlHandlers } from "./handlers/tableControlHandlers.js";

export function createMessageRouter(context) {
  const sessionHandlers = createSessionHandlers(context);
  const tableControlHandlers = createTableControlHandlers(context);
  const hostAdminHandlers = createHostAdminHandlers(context);
  const playerActionHandlers = createPlayerActionHandlers(context);

  function sendHello(socket) {
    context.sendJson(socket, {
      type: "hello",
      message: "no-rake",
      supportedMessages: [
        "join_room",
        "sit_down",
        "start_round",
        "end_game",
        "set_auto_deal",
        "set_server_bot",
        "set_server_bot_profile",
        "set_server_bot_seed",
        "set_server_bot_delay",
        "host_adjust_stack",
        "host_move_player",
        "host_kick_player",
        "player_action:check/call/fold/bet/raise_to",
        "ping-*",
      ],
    });
  }

  function handleMessage(socket, session, raw) {
    const text = typeof raw === "string" ? raw : raw.toString();

    if (text.startsWith("ping-")) {
      context.sendJson(socket, { type: "echo", body: text });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      context.sendJson(socket, { type: "error", message: "invalid JSON payload" });
      return;
    }

    if (parsed.type === "join_room") {
      sessionHandlers.handleJoinRoom(socket, session, parsed);
      return;
    }

    if (parsed.type === "set_auto_deal") {
      tableControlHandlers.handleSetAutoDeal(socket, session, parsed);
      return;
    }

    if (parsed.type === "set_manual_step_mode") {
      tableControlHandlers.handleSetManualStepMode(socket, session, parsed);
      return;
    }

    if (parsed.type === "set_server_bot") {
      tableControlHandlers.handleSetServerBot(socket, session, parsed);
      return;
    }

    if (parsed.type === "set_server_bot_profile") {
      tableControlHandlers.handleSetServerBotProfile(socket, session, parsed);
      return;
    }

    if (parsed.type === "set_server_bot_seed") {
      tableControlHandlers.handleSetServerBotSeed(socket, session, parsed);
      return;
    }

    if (parsed.type === "set_server_bot_delay") {
      tableControlHandlers.handleSetServerBotDelay(socket, session, parsed);
      return;
    }

    if (parsed.type === "step_progress") {
      tableControlHandlers.handleStepProgress(socket, session, parsed);
      return;
    }

    if (parsed.type === "sit_down") {
      sessionHandlers.handleSitDown(socket, session, parsed);
      return;
    }

    if (parsed.type === "start_round") {
      tableControlHandlers.handleStartRound(socket, session, parsed);
      return;
    }

    if (parsed.type === "end_game") {
      tableControlHandlers.handleEndGame(socket, session, parsed);
      return;
    }

    if (parsed.type === "host_adjust_stack") {
      hostAdminHandlers.handleAdjustStack(socket, session, parsed);
      return;
    }

    if (parsed.type === "host_move_player") {
      hostAdminHandlers.handleMovePlayer(socket, session, parsed);
      return;
    }

    if (parsed.type === "host_kick_player") {
      hostAdminHandlers.handleKickPlayer(socket, session, parsed);
      return;
    }

    if (parsed.type === "player_action") {
      playerActionHandlers.handlePlayerAction(socket, session, parsed);
      return;
    }

    context.sendJson(socket, { type: "error", message: "unsupported message type" });
  }

  function handleClose(socket, session) {
    if (!session.roomId) return;
    const roomId = session.roomId;
    context.removeSocketFromRoom(roomId, socket);
    context.publishRoomState(roomId);
  }

  return {
    sendHello,
    handleMessage,
    handleClose,
    runInternalPlayerAction: playerActionHandlers.handlePlayerAction,
  };
}

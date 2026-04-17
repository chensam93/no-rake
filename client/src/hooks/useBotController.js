import { useRef, useState } from "react";
import { computeBotDecision } from "../lib/botDecision.js";

export function useBotController({ wsUrl, sendBotJson, sendJson, appendEvent, roomState, playerName }) {
  const botWsRef = useRef(null);
  const botLastActionKeyRef = useRef(null);
  const botSeatRef = useRef(null);
  const botAutoActionTimeoutRef = useRef(null);
  const botPendingActionKeyRef = useRef(null);
  const botActionModeRef = useRef("auto");

  const [botState, setBotState] = useState("off");
  const [botSeatNumber, setBotSeatNumber] = useState(null);
  const [botActionMode, setBotActionMode] = useState("auto");
  const [botLastActionKey, setBotLastActionKey] = useState(null);

  const clearPendingBotAutoAction = () => {
    if (botAutoActionTimeoutRef.current !== null) {
      clearTimeout(botAutoActionTimeoutRef.current);
      botAutoActionTimeoutRef.current = null;
    }
    botPendingActionKeyRef.current = null;
  };

  const stopBot = () => {
    const ws = botWsRef.current;
    clearPendingBotAutoAction();
    if (ws) {
      ws.close();
      botWsRef.current = null;
    }
    botLastActionKeyRef.current = null;
    setBotLastActionKey(null);
    botSeatRef.current = null;
    setBotSeatNumber(null);
    setBotState("off");
  };

  const getBotDecision = (roomStatePayload) => {
    return computeBotDecision(
      roomStatePayload,
      botSeatRef.current,
      botLastActionKeyRef.current,
    );
  };

  const runBotDecision = (decision, delayMs = 0) => {
    if (!decision) return false;
    if (botLastActionKeyRef.current === decision.actionKey) return false;
    if (botPendingActionKeyRef.current === decision.actionKey) return false;

    const sendAction = () => {
      if (!botWsRef.current || botWsRef.current.readyState !== WebSocket.OPEN) return;
      botLastActionKeyRef.current = decision.actionKey;
      setBotLastActionKey(decision.actionKey);
      sendBotJson({ type: "player_action", actionType: decision.actionType }, decision.label);
    };

    if (delayMs <= 0) {
      sendAction();
      return true;
    }

    clearPendingBotAutoAction();
    botPendingActionKeyRef.current = decision.actionKey;
    botAutoActionTimeoutRef.current = setTimeout(() => {
      if (botPendingActionKeyRef.current !== decision.actionKey) return;
      if (botActionModeRef.current !== "auto") return;
      sendAction();
      botAutoActionTimeoutRef.current = null;
      botPendingActionKeyRef.current = null;
    }, delayMs);
    return true;
  };

  const maybeRunBotAction = (roomStatePayload) => {
    if (botActionMode !== "auto") return;
    const decision = getBotDecision(roomStatePayload);
    runBotDecision(decision, 350);
  };

  const runBotStep = () => {
    if (botActionMode !== "step") {
      appendEvent("[bot] step ignored: switch bot mode to step first");
      return;
    }
    clearPendingBotAutoAction();
    const roundState = roomState?.round;
    const pendingSeatNumbers = Array.isArray(roundState?.pendingSeatNumbers)
      ? roundState.pendingSeatNumbers
      : [];
    const turnSeat = roundState?.turnSeatNumber;
    const localSeatFromRoom =
      (roomState?.players ?? []).find(
        (candidate) => candidate.seatNumber !== null && candidate.playerName === playerName,
      )?.seatNumber ?? null;
    if (roundState?.inProgress && pendingSeatNumbers.length === 0) {
      if (localSeatFromRoom !== null && turnSeat === localSeatFromRoom) {
        appendEvent("[bot] step blocked: your action first — use Check / Call / Raise");
        return;
      }
      sendJson({ type: "step_progress" }, "step_progress");
      appendEvent("[bot] step mode: progression advanced");
      return;
    }
    const decision = getBotDecision(roomState);
    if (decision) {
      runBotDecision(decision, 0);
      appendEvent(`[bot] step mode action: ${decision.actionType} (toCall=${decision.toCall})`);
      return;
    }
    if (roundState?.inProgress && pendingSeatNumbers.length > 0) {
      appendEvent(`[bot] step blocked: awaiting seat ${roundState.turnSeatNumber ?? "?"} action`);
      return;
    }
    sendJson({ type: "step_progress" }, "step_progress");
    appendEvent("[bot] step mode: progression advanced");
  };

  const handleBotActionModeChange = (nextMode, isSocketOpen) => {
    clearPendingBotAutoAction();
    setBotActionMode(nextMode);
    botActionModeRef.current = nextMode;
    appendEvent(`[bot] action mode: ${nextMode}`);
    if (isSocketOpen && roomState?.roomId) {
      sendJson(
        { type: "set_manual_step_mode", enabled: nextMode === "step" },
        "set_manual_step_mode",
      );
    }
    if (nextMode === "auto" && roomState) {
      maybeRunBotAction(roomState);
    }
  };

  const startBot = (targetSeatNumber, targetRoomId) => {
    if (!Number.isInteger(targetSeatNumber) || targetSeatNumber < 1 || targetSeatNumber > 9) {
      appendEvent("[bot] invalid seat for bot");
      return;
    }
    if (botWsRef.current && botWsRef.current.readyState === WebSocket.OPEN) return;

    const botWs = new WebSocket(wsUrl);
    botWsRef.current = botWs;
    botSeatRef.current = targetSeatNumber;
    setBotSeatNumber(targetSeatNumber);
    setBotState("connecting");

    botWs.onopen = () => {
      setBotState("open");
      appendEvent("[bot] websocket open");
      const botName = `bot-s${targetSeatNumber}`;
      sendBotJson(
        { type: "join_room", roomId: targetRoomId, playerName: botName },
        `join_room (${botName})`,
      );
      sendBotJson({ type: "sit_down", seatNumber: targetSeatNumber }, `sit_down (${targetSeatNumber})`);
    };

    botWs.onclose = () => {
      if (botWsRef.current === botWs) {
        botWsRef.current = null;
        botLastActionKeyRef.current = null;
        setBotState("off");
      }
      appendEvent("[bot] websocket closed");
    };

    botWs.onerror = () => {
      if (botWsRef.current === botWs) {
        setBotState("error");
      }
      appendEvent("[bot] websocket error");
    };

    botWs.onmessage = (event) => {
      appendEvent(`[bot in] ${event.data}`);
      let parsed;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      if (parsed.type === "room_state") {
        maybeRunBotAction(parsed);
      }
    };
  };

  return {
    botWsRef,
    botState,
    botSeatNumber,
    botActionMode,
    botLastActionKey,
    setBotActionMode,
    clearPendingBotAutoAction,
    stopBot,
    getBotDecision,
    maybeRunBotAction,
    runBotStep,
    handleBotActionModeChange,
    startBot,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import HandStatusPanel from "./components/HandStatusPanel.jsx";
import HandContextPanel from "./components/HandContextPanel.jsx";
import ActionControlsPanel from "./components/ActionControlsPanel.jsx";
import TableCenterBoard from "./components/TableCenterBoard.jsx";
import SeatNodesLayer from "./components/SeatNodesLayer.jsx";
import { useTableHotkeys } from "./hooks/useTableHotkeys.js";
import { useSocketSenders } from "./hooks/useSocketSenders.js";
import { getRecommendedPreflopRaiseTo } from "./lib/preflopSizing.js";
import { buildPlayersBySeat, deriveLocalPlayer } from "./lib/tableSelectors.js";

const DEFAULT_WS_URL = "ws://127.0.0.1:3000/ws";
const WS_URL = import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;
const DEFAULT_QUICK_MODE = true;
const DEFAULT_BET_PRESET_TEXT = "33,50,66,100";
const PREFLOP_OPEN_BB_KEY = "no-rake-preflop-open-bb-mult";
const SFX_ENABLED_KEY = "no-rake-sfx-enabled";

function readStoredPreflopOpenBbMultiple() {
  try {
    if (typeof localStorage === "undefined") return 2.5;
    const raw = localStorage.getItem(PREFLOP_OPEN_BB_KEY);
    if (raw === null) return 2.5;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 2.5;
    return Math.min(6, Math.max(1.5, Math.round(parsed * 20) / 20));
  } catch {
    return 2.5;
  }
}

function readStoredSfxEnabled() {
  try {
    if (typeof localStorage === "undefined") return true;
    const raw = localStorage.getItem(SFX_ENABLED_KEY);
    if (raw === null) return true;
    return raw !== "0";
  } catch {
    return true;
  }
}
/* Percent positions on felt; edge seats nudged inward so spacing to oval rim is more even */
const SEAT_LAYOUT = {
  1: { top: "88%", left: "50%" },
  2: { top: "79%", left: "74%" },
  3: { top: "58%", left: "86%" },
  4: { top: "34%", left: "82%" },
  5: { top: "16%", left: "62%" },
  6: { top: "16%", left: "38%" },
  7: { top: "34%", left: "18%" },
  8: { top: "58%", left: "14%" },
  9: { top: "79%", left: "26%" },
};
const BET_MARKER_SEAT_TWEAKS = {
  1: { top: -1.8, left: 2.7 },
  2: { top: -3.2, left: -1.7 },
  3: { top: -1.5, left: -0.8 },
  8: { top: -0.8, left: 0.8 },
  9: { top: -1.5, left: 1.1 },
};
function getBetMarkerPosition(seatNumber) {
  const seatLayout = SEAT_LAYOUT[seatNumber];
  if (!seatLayout) return { top: "50%", left: "50%" };
  const seatTop = Number.parseFloat(seatLayout.top);
  const seatLeft = Number.parseFloat(seatLayout.left);
  // Keep committed bet markers in front of each player (closer to hole cards than board center).
  const towardCenter = 0.34;
  const baseTop = seatTop + (50 - seatTop) * towardCenter;
  const baseLeft = seatLeft + (50 - seatLeft) * towardCenter;
  const tweak = BET_MARKER_SEAT_TWEAKS[seatNumber] ?? { top: 0, left: 0 };
  const top = baseTop + tweak.top;
  const left = baseLeft + tweak.left;
  return { top: `${top.toFixed(2)}%`, left: `${left.toFixed(2)}%` };
}

function timestamp() {
  return new Date().toLocaleTimeString();
}

function cardLabel(card) {
  if (!card || typeof card !== "string" || card.length < 2) return "??";
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  const suitMap = { c: "♣", d: "♦", h: "♥", s: "♠" };
  return `${rank}${suitMap[suit] ?? suit}`;
}

function cardSuitClass(card) {
  const suit = card?.slice(-1);
  if (suit === "d" || suit === "h") return "card-red";
  return "card-black";
}

function parseBetPresetPercentages(rawText) {
  if (!rawText || typeof rawText !== "string") return [];

  const seen = new Set();
  const values = [];
  for (const token of rawText.split(",")) {
    const percent = Number(token.trim());
    if (!Number.isFinite(percent)) continue;
    if (percent <= 0 || percent > 500) continue;
    const normalized = Math.round(percent * 10) / 10;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(normalized);
    if (values.length >= 8) break;
  }
  return values;
}

function formatChipCount(value) {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Number(value) || 0));
}

function formatActionType(actionType) {
  if (actionType === "small_blind") return "post sb";
  if (actionType === "big_blind") return "post bb";
  if (actionType === "sb") return "post sb";
  if (actionType === "bb") return "post bb";
  if (actionType === "raise_to") return "raise";
  return String(actionType || "action");
}

function formatActionSummary(action) {
  if (!action) return "No action yet";
  const actor = action.playerName || `Seat ${action.seatNumber ?? "-"}`;
  const actionType = formatActionType(action.actionType);
  const amount = Math.max(0, Number(action.amountCommitted ?? 0));
  if (amount > 0) {
    return `${actor} ${actionType} ${formatChipCount(amount)}`;
  }
  return `${actor} ${actionType}`;
}

/** Heuristic labels for server `{ type: "error" }` messages (no server contract change). */
function classifyServerErrorMessage(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("invalid json") || text.includes("unsupported message")) {
    return "system";
  }
  if (
    text.includes("join_room before") ||
    text.includes("room not found") ||
    text.includes("only host") ||
    text.includes("player not found") ||
    text.includes("manual step mode") ||
    text.includes("step progression")
  ) {
    return "session";
  }
  return "action";
}

function serverErrorCategoryLabel(category) {
  if (category === "session") return "Room / session";
  if (category === "system") return "Server or protocol";
  return "Action";
}

const RAISE_SLIDER_EXPONENT = 2.2;

function getRaiseAmountFromSliderPosition(position, minTarget, maxTarget, step) {
  const safeMin = Number(minTarget);
  const safeMax = Number(maxTarget);
  if (!Number.isFinite(safeMin) || !Number.isFinite(safeMax) || safeMax <= safeMin) {
    return Math.round(safeMin || safeMax || 0);
  }
  const safeStep = Math.max(1, Math.round(Number(step) || 1));
  const normalized = Math.max(0, Math.min(1, Number(position) / 100));
  const biased = normalized ** RAISE_SLIDER_EXPONENT;
  const rawAmount = safeMin + biased * (safeMax - safeMin);
  const snapped = safeMin + Math.round((rawAmount - safeMin) / safeStep) * safeStep;
  return Math.max(safeMin, Math.min(safeMax, Math.round(snapped)));
}

function getRaiseSliderPositionFromAmount(amount, minTarget, maxTarget) {
  const safeMin = Number(minTarget);
  const safeMax = Number(maxTarget);
  if (!Number.isFinite(safeMin) || !Number.isFinite(safeMax) || safeMax <= safeMin) {
    return 0;
  }
  const safeAmount = Math.max(safeMin, Math.min(safeMax, Number(amount) || safeMin));
  const normalized = (safeAmount - safeMin) / (safeMax - safeMin);
  const slider = normalized ** (1 / RAISE_SLIDER_EXPONENT);
  return Math.round(slider * 100);
}

function App() {
  const wsRef = useRef(null);
  const botWsRef = useRef(null);
  const audioContextRef = useRef(null);
  const eventsRef = useRef([]);
  const previousTurnSeatRef = useRef(null);
  const previousConnectionStateRef = useRef(null);
  const previousLastEndReasonRef = useRef(null);
  const soundEnabledRef = useRef(readStoredSfxEnabled());
  const [connectionState, setConnectionState] = useState("connecting");
  const [botState, setBotState] = useState("off");
  const [botSeatNumber, setBotSeatNumber] = useState(null);
  const [botProfile, setBotProfile] = useState("tag");
  const [openSeatMenuSeat, setOpenSeatMenuSeat] = useState(null);
  const [roomId, setRoomId] = useState("home");
  const [playerName, setPlayerName] = useState("player");
  const [seatNumber, setSeatNumber] = useState(1);
  const [amount, setAmount] = useState(40);
  const [showRaiseSlider, setShowRaiseSlider] = useState(false);
  const [betPresetText, setBetPresetText] = useState(DEFAULT_BET_PRESET_TEXT);
  const quickMode = DEFAULT_QUICK_MODE;
  const [botActionMode, setBotActionMode] = useState("auto");
  const [uiMotionPaused, setUiMotionPaused] = useState(false);
  const [uiDensity, setUiDensity] = useState("compact");
  const [showBbStacks, setShowBbStacks] = useState(true);
  const [showAdvancedHandInfo, setShowAdvancedHandInfo] = useState(false);
  const [showHandLog, setShowHandLog] = useState(false);
  const [showPresetButtons, setShowPresetButtons] = useState(false);
  const [showTopGameMenu, setShowTopGameMenu] = useState(false);
  const [preflopOpenBbMultiple] = useState(readStoredPreflopOpenBbMultiple);
  const [showDevTools, setShowDevTools] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(readStoredSfxEnabled);
  const [roomState, setRoomState] = useState(null);
  const [lastServerError, setLastServerError] = useState(null);
  const [sendBlockedNotice, setSendBlockedNotice] = useState(null);
  const [mainSocketEpoch, setMainSocketEpoch] = useState(0);
  const isSocketOpen = connectionState === "open";
  const isBotOpen = botState === "open";
  const connectionStatusLabel =
    connectionState === "open"
      ? "Connected"
      : connectionState === "connecting"
        ? "Connecting…"
        : connectionState === "error"
          ? "Error"
          : "Disconnected";

  const appendEvent = (line) => {
    const stamped = `[${timestamp()}] ${line}`;
    eventsRef.current = [...eventsRef.current.slice(-79), stamped];
  };
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    try {
      localStorage.setItem(SFX_ENABLED_KEY, soundEnabled ? "1" : "0");
    } catch {
      // ignore storage failures
    }
  }, [soundEnabled]);

  const playUiCue = useCallback((cueType) => {
    if (!soundEnabledRef.current) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }
    const context = audioContextRef.current;
    if (!context) return;
    if (context.state === "suspended") {
      void context.resume().catch(() => {});
    }

    const playTone = ({ frequency, durationMs, gain, type = "sine", offsetMs = 0 }) => {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      const startAt = context.currentTime + offsetMs / 1000;
      const endAt = startAt + durationMs / 1000;

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), startAt + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt);

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(endAt);
    };

    try {
      if (cueType === "action") {
        playTone({ frequency: 740, durationMs: 65, gain: 0.028, type: "triangle" });
        return;
      }
      if (cueType === "turn") {
        playTone({ frequency: 660, durationMs: 70, gain: 0.024, type: "triangle" });
        playTone({ frequency: 988, durationMs: 80, gain: 0.022, type: "triangle", offsetMs: 90 });
        return;
      }
      if (cueType === "round_end") {
        playTone({ frequency: 523, durationMs: 90, gain: 0.026, type: "sine" });
        playTone({ frequency: 659, durationMs: 120, gain: 0.022, type: "sine", offsetMs: 110 });
        return;
      }
      if (cueType === "error") {
        playTone({ frequency: 210, durationMs: 130, gain: 0.03, type: "sawtooth" });
        playTone({ frequency: 160, durationMs: 120, gain: 0.018, type: "sawtooth", offsetMs: 110 });
        return;
      }
      if (cueType === "connect") {
        playTone({ frequency: 440, durationMs: 60, gain: 0.02, type: "sine" });
        playTone({ frequency: 660, durationMs: 70, gain: 0.018, type: "sine", offsetMs: 70 });
      }
    } catch {
      // If sound generation fails, silently continue.
    }
  }, []);

  const onMainSendBlocked = useCallback(() => {
    setSendBlockedNotice("Not connected — your action was not sent.");
    playUiCue("error");
  }, [playUiCue]);
  const { sendJson } = useSocketSenders(wsRef, botWsRef, appendEvent, onMainSendBlocked);

  const stopBot = () => {
    if (!isSocketOpen) {
      appendEvent("[bot] stop ignored: websocket not open");
      return;
    }
    if (!botSeatNumber) {
      appendEvent("[bot] no active bot seat");
      return;
    }
    sendJson({ type: "set_server_bot", enabled: false, seatNumber: botSeatNumber }, "set_server_bot:disable");
  };

  const runBotStep = () => {
    if (botActionMode !== "step") {
      appendEvent("[bot] step ignored: switch bot mode to step first");
      return;
    }
    sendJson({ type: "step_progress" }, "step_progress");
    appendEvent("[bot] step mode: progress requested");
  };

  const handleBotActionModeChange = (nextMode) => {
    setBotActionMode(nextMode);
    appendEvent(`[bot] action mode: ${nextMode}`);
    if (isSocketOpen && roomState?.roomId) {
      sendJson(
        { type: "set_manual_step_mode", enabled: nextMode === "step" },
        "set_manual_step_mode",
      );
    }
  };

  const startBot = (targetSeatNumber) => {
    if (!Number.isInteger(targetSeatNumber) || targetSeatNumber < 1 || targetSeatNumber > 9) {
      appendEvent("[bot] invalid seat for bot");
      return;
    }
    if (!isSocketOpen) {
      appendEvent("[bot] cannot start bot while offline");
      return;
    }
    sendJson(
      {
        type: "set_server_bot",
        enabled: true,
        seatNumber: targetSeatNumber,
      },
      "set_server_bot:enable",
    );
  };

  const quickJoin = (player, seat) => {
    const fixedRoomId = "home";
    setRoomId(fixedRoomId);
    setPlayerName(player);
    setSeatNumber(seat);
    sendJson(
      { type: "join_room", roomId: fixedRoomId, playerName: player },
      `join_room (${player})`,
    );
    sendJson({ type: "sit_down", seatNumber: seat }, `sit_down (${seat})`);
  };

  const joinLocalSeat = (targetSeatNumber) => {
    const targetRoomId = quickMode ? "home" : roomId.trim() || "home";
    const targetName =
      quickMode && targetSeatNumber === 1
        ? "p1"
        : quickMode && targetSeatNumber === 2
          ? "p2"
          : playerName.trim() || "player";
    setRoomId(targetRoomId);
    setPlayerName(targetName);
    setSeatNumber(targetSeatNumber);
    sendJson(
      { type: "join_room", roomId: targetRoomId, playerName: targetName },
      `join_room (${targetName})`,
    );
    sendJson({ type: "sit_down", seatNumber: targetSeatNumber }, `sit_down (${targetSeatNumber})`);
  };

  const reconnectMainSocket = useCallback(() => {
    setLastServerError(null);
    setSendBlockedNotice(null);
    setMainSocketEpoch((epoch) => epoch + 1);
  }, []);

  // Main table WebSocket: remount when `mainSocketEpoch` changes (Reconnect button).
  useEffect(() => {
    setConnectionState("connecting");
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState("open");
      setSendBlockedNotice(null);
      appendEvent("[local] websocket open");
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        setConnectionState("closed");
        wsRef.current = null;
      }
      appendEvent("[local] websocket closed");
    };

    ws.onerror = () => {
      if (wsRef.current === ws) {
        setConnectionState("error");
      }
      appendEvent("[local] websocket error");
    };

    ws.onmessage = (event) => {
      appendEvent(`[in] ${event.data}`);

      let parsed;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      if (parsed.type === "room_state") {
        setRoomState(parsed);
        const serverBot = parsed.table?.serverBot ?? {};
        setBotState(serverBot.isActive ? "open" : "off");
        setBotSeatNumber(Number.isInteger(serverBot.seatNumber) ? serverBot.seatNumber : null);
        setBotProfile(typeof serverBot.profile === "string" ? serverBot.profile : "tag");
      }

      if (parsed.type === "error" && typeof parsed.message === "string") {
        setLastServerError({
          message: parsed.message,
          category: classifyServerErrorMessage(parsed.message),
        });
        playUiCue("error");
      }
    };

    return () => {
      ws.close();
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stopBot/appendEvent omitted to avoid reconnect churn
  }, [mainSocketEpoch]);

  useEffect(() => {
    const previousConnectionState = previousConnectionStateRef.current;
    if (previousConnectionState && previousConnectionState !== connectionState) {
      if (connectionState === "open") {
        playUiCue("connect");
      } else if (
        previousConnectionState === "open" &&
        (connectionState === "closed" || connectionState === "error")
      ) {
        playUiCue("error");
      }
    }
    previousConnectionStateRef.current = connectionState;
  }, [connectionState, playUiCue]);

  const seats = Array.from({ length: 9 }, (_, index) => index + 1);
  const playersBySeat = buildPlayersBySeat(roomState);
  const table = roomState?.table ?? {};
  const serverBot = table.serverBot ?? {};
  const supportedBotProfiles = Array.isArray(serverBot.supportedProfiles)
    ? serverBot.supportedProfiles
    : ["nit", "tag", "lag", "maniac"];
  const round = roomState?.round ?? {};
  const blindUnitValue = Math.max(1, Number(round.bigBlind ?? table.bigBlind ?? 20));
  const boardCards = Array.isArray(round.board) ? round.board : [];
  const foldedSeatNumbers = Array.isArray(round.foldedSeatNumbers)
    ? round.foldedSeatNumbers
    : [];
  const lastWinnerSeatNumbers = Array.isArray(round.lastWinnerSeatNumbers)
    ? round.lastWinnerSeatNumbers
    : [];
  const lastPayouts = Array.isArray(round.lastPayouts) ? round.lastPayouts : [];
  const lastShowdown = round.lastShowdown ?? null;
  const boardSlots = Array.from({ length: 5 }, (_, index) => boardCards[index] ?? null);
  const hasRound = Boolean(roomState?.round?.inProgress);
  const actionLog = Array.isArray(round.actionLog) ? round.actionLog : [];
  const localPlayer = deriveLocalPlayer(roomState, playersBySeat, playerName, seatNumber);
  const localSeatNumber = localPlayer?.seatNumber ?? null;
  const localToCall = localPlayer
    ? Math.max(0, (round.currentBet ?? 0) - (localPlayer.committedThisStreet ?? 0))
    : 0;
  const localCommittedThisStreet = localPlayer?.committedThisStreet ?? 0;
  const localStackBehind = Math.max(0, Number(localPlayer?.stack ?? 0));
  const isLocalTurn =
    hasRound &&
    Boolean(localPlayer?.seatNumber) &&
    localPlayer.seatNumber === round.turnSeatNumber &&
    !foldedSeatNumbers.includes(localPlayer.seatNumber);
  const canActNow = isSocketOpen && isLocalTurn;
  const canCheckAction = canActNow && localToCall === 0;
  const canCallAction = canActNow && localToCall > 0;
  const canBetAction = canActNow && (round.currentBet ?? 0) === 0;
  const canFoldAction = canActNow && localToCall > 0;
  const raiseMinTarget = Math.max(
    (round.currentBet ?? 0) + 1,
    round.minRaiseTo ?? (round.currentBet ?? 0) + 1,
    localCommittedThisStreet + 1,
  );
  const raiseMaxTarget = localPlayer
    ? localCommittedThisStreet + Math.max(0, localPlayer.stack ?? 0)
    : raiseMinTarget;
  const raiseStep = Math.max(1, Math.round(blindUnitValue / 2));
  const canRaiseAction =
    canActNow && (round.currentBet ?? 0) > 0 && raiseMaxTarget >= raiseMinTarget;
  const isPreflopStreet = round.street === "preflop";
  const preflopRaiseTarget =
    isPreflopStreet && canRaiseAction
      ? getRecommendedPreflopRaiseTo({
          bigBlind: blindUnitValue,
          currentBet: round.currentBet ?? 0,
          raiseMinTarget,
          raiseMaxTarget,
          openBbMultiple: preflopOpenBbMultiple,
        })
      : null;
  const preflopRaiseUi = Boolean(isPreflopStreet && canRaiseAction);
  const preflopSizingHint =
    (round.currentBet ?? 0) <= blindUnitValue
      ? `${preflopOpenBbMultiple}×BB`
      : "3× facing";
  const showAmountControls = canBetAction || canRaiseAction;
  const isHost = Boolean(playerName && table.hostPlayerName === playerName);
  const autoDealEnabled = table.autoDealEnabled !== false;
  const autoDealDelayMs = Number(table.autoDealDelayMs) || 1800;
  const betPresetPercentages = parseBetPresetPercentages(betPresetText);
  const turnPlayer = playersBySeat.get(round.turnSeatNumber);
  const potChipCount =
    (round.pot ?? 0) > 0
      ? Math.max(1, Math.min(10, Math.ceil((round.pot ?? 0) / blindUnitValue)))
      : 0;
  const hasLastHandResult = !hasRound && Boolean(round.lastEndReason);
  const winnerNames = lastWinnerSeatNumbers
    .map((seat) => playersBySeat.get(seat)?.playerName || `Seat ${seat}`)
    .join(", ");
  const payoutBySeat = new Map(
    lastPayouts.map((payout) => [payout.seatNumber, payout.amount]),
  );
  const showdownPlayers = Array.isArray(lastShowdown?.players) ? lastShowdown.players : [];
  const winnerSummary =
    hasLastHandResult
      ? round.lastEndReason === "showdown"
        ? `${winnerNames || "No winner"} wins at showdown`
        : round.lastEndReason === "fold_winner"
          ? `${winnerNames || "No winner"} wins on fold`
          : `Hand ended: ${round.lastEndReason}`
      : null;
  const currentStreetActions = actionLog.filter((action) => action.street === round.street);
  const recentActionSummaries = [...actionLog]
    .slice(-6)
    .reverse()
    .map((action) => formatActionSummary(action));
  const raiseSliderPosition = getRaiseSliderPositionFromAmount(
    amount,
    raiseMinTarget,
    raiseMaxTarget,
  );
  const raiseQuarterAmount = getRaiseAmountFromSliderPosition(
    25,
    raiseMinTarget,
    raiseMaxTarget,
    raiseStep,
  );
  const raiseMiddleAmount = getRaiseAmountFromSliderPosition(
    50,
    raiseMinTarget,
    raiseMaxTarget,
    raiseStep,
  );
  const raiseThreeQuarterAmount = getRaiseAmountFromSliderPosition(
    75,
    raiseMinTarget,
    raiseMaxTarget,
    raiseStep,
  );
  const heroLastAction =
    localSeatNumber !== null
      ? [...currentStreetActions].reverse().find((action) => action.seatNumber === localSeatNumber) ?? null
      : null;
  const turnActorLabel = turnPlayer?.playerName || `Seat ${round.turnSeatNumber}`;
  const actionStatusLabel = hasRound
    ? isLocalTurn
      ? "Your turn"
      : round.turnSeatNumber
        ? `${turnActorLabel}'s turn`
        : "Runout"
    : null;
  const localCanActSummary = !hasRound
    ? "No active hand"
    : isLocalTurn
      ? "Your action"
      : localPlayer
        ? "Waiting for turn"
        : "You are not seated";
  const hasLocalActiveHand =
    hasRound &&
    Boolean(localPlayer?.seatNumber) &&
    !foldedSeatNumbers.includes(localPlayer.seatNumber);
  const shouldShowActionDock = hasLocalActiveHand || hasLastHandResult;
  const localPotOddsPercent =
    localToCall > 0
      ? Math.round((localToCall / Math.max(1, (round.pot ?? 0) + localToCall)) * 100)
      : 0;
  const isBotTurn =
    isBotOpen && Number.isInteger(botSeatNumber) && round.turnSeatNumber === botSeatNumber;
  const botToCall =
    isBotTurn && botSeatNumber !== null
      ? Math.max(
          0,
          Number(round.currentBet ?? 0) -
            Number(playersBySeat.get(botSeatNumber)?.committedThisStreet ?? 0),
        )
      : 0;
  const botStepDecision = isBotTurn ? { actionType: "bot_turn", toCall: botToCall } : null;
  const isBotStepReady = Boolean(botStepDecision);
  const stepPendingSeatNumbers = Array.isArray(round.pendingSeatNumbers) ? round.pendingSeatNumbers : [];
  const isStepBlockedByHumanAction =
    botActionMode === "step" &&
    hasRound &&
    !isBotStepReady &&
    stepPendingSeatNumbers.length > 0 &&
    round.turnSeatNumber !== botSeatNumber;
  // Do not treat "no pending seats" as step-ready while it's still the human's turn — the server
  // can briefly expose empty pending; advancing then would be wrong and the button must not glow.
  const canAdvanceByStepProgress =
    hasRound && stepPendingSeatNumbers.length === 0 && !isLocalTurn;
  const isBotStepPossible =
    isBotOpen &&
    botActionMode === "step" &&
    !isStepBlockedByHumanAction &&
    (isBotStepReady || canAdvanceByStepProgress);
  const botStepGoLabel =
    !isBotOpen || botActionMode !== "step"
      ? "Go next (Space)"
      : isBotStepPossible
        ? "▶ Next (Space)"
        : "Not ready — wait";
  useEffect(() => {
    if (!hasRound) {
      previousTurnSeatRef.current = null;
      return;
    }
    const previousTurnSeat = previousTurnSeatRef.current;
    const nextTurnSeat = round.turnSeatNumber ?? null;
    if (previousTurnSeat !== null && previousTurnSeat !== nextTurnSeat && isLocalTurn) {
      playUiCue("turn");
    }
    previousTurnSeatRef.current = nextTurnSeat;
  }, [hasRound, isLocalTurn, playUiCue, round.turnSeatNumber]);

  useEffect(() => {
    const previousLastEndReason = previousLastEndReasonRef.current;
    const currentLastEndReason = round.lastEndReason ?? null;
    if (!hasRound && currentLastEndReason && currentLastEndReason !== previousLastEndReason) {
      playUiCue("round_end");
    }
    previousLastEndReasonRef.current = currentLastEndReason;
  }, [hasRound, playUiCue, round.lastEndReason]);

  const applyBetPreset = (percent) => {
    const pot = Math.max(1, Number(round.pot ?? 0));
    const currentBet = Number(round.currentBet ?? 0);
    let nextAmount = Math.max(1, Math.round((pot * percent) / 100));
    if (currentBet > 0 && nextAmount <= currentBet) {
      nextAmount = currentBet + Math.max(1, Math.round(blindUnitValue / 2));
    }
    if (currentBet > 0 && localPlayer) {
      nextAmount = Math.min(raiseMaxTarget, Math.max(raiseMinTarget, nextAmount));
      setShowRaiseSlider(true);
    }
    setAmount(nextAmount);
    if (canBetAction) {
      sendJson(
        { type: "player_action", actionType: "bet", amount: nextAmount },
        "player_action:bet",
      );
      playUiCue("action");
      setShowPresetButtons(false);
    }
  };

  const handleRaiseClick = () => {
    if (!canRaiseAction) return;
    if (preflopRaiseUi && preflopRaiseTarget !== null) {
      if (showRaiseSlider) {
        const clampedAmount = Math.max(raiseMinTarget, Math.min(raiseMaxTarget, Math.round(amount)));
        sendJson(
          { type: "player_action", actionType: "raise_to", amount: clampedAmount },
          "player_action:raise_to",
        );
        playUiCue("action");
        setShowRaiseSlider(false);
        setShowPresetButtons(false);
        return;
      }
      sendJson(
        { type: "player_action", actionType: "raise_to", amount: preflopRaiseTarget },
        "player_action:raise_to",
      );
      playUiCue("action");
      return;
    }
    const clampedAmount = Math.max(raiseMinTarget, Math.min(raiseMaxTarget, Math.round(amount)));
    if (showRaiseSlider) {
      sendJson(
        { type: "player_action", actionType: "raise_to", amount: clampedAmount },
        "player_action:raise_to",
      );
      playUiCue("action");
      setShowRaiseSlider(false);
      setShowPresetButtons(false);
      return;
    }
    if (clampedAmount !== amount) {
      setAmount(clampedAmount);
    }
    setShowRaiseSlider(true);
  };

  const handleRaiseSliderChange = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const nextAmount = getRaiseAmountFromSliderPosition(
      parsed,
      raiseMinTarget,
      raiseMaxTarget,
      raiseStep,
    );
    setAmount(nextAmount);
  };
  const handleRaiseNudge = (stepCount) => {
    if (!canRaiseAction) return;
    setAmount((previous) => {
      const baseValue = Number(previous);
      const safeCurrent = Number.isFinite(baseValue) ? baseValue : raiseMinTarget;
      const nextValue = safeCurrent + stepCount * raiseStep;
      return Math.max(raiseMinTarget, Math.min(raiseMaxTarget, Math.round(nextValue)));
    });
  };
  const handleHalfPotRaise = () =>
    setAmount(
      Math.min(raiseMaxTarget, Math.max(raiseMinTarget, Math.round((round.pot ?? 0) / 2))),
    );
  const handlePotRaise = () =>
    setAmount(Math.min(raiseMaxTarget, Math.max(raiseMinTarget, Math.round(round.pot ?? 0))));
  const handleSetMinRaise = () => setAmount(raiseMinTarget);
  const handleSetAllInRaise = () => setAmount(raiseMaxTarget);
  const closeActionPanels = () => {
    setShowRaiseSlider(false);
    setShowPresetButtons(false);
  };
  const submitCheck = () => {
    closeActionPanels();
    sendJson({ type: "player_action", actionType: "check" }, "player_action:check");
    playUiCue("action");
  };
  const submitCall = () => {
    closeActionPanels();
    sendJson({ type: "player_action", actionType: "call" }, "player_action:call");
    playUiCue("action");
  };
  const submitFold = () => {
    closeActionPanels();
    sendJson({ type: "player_action", actionType: "fold" }, "player_action:fold");
    playUiCue("action");
  };
  const submitBet = () => {
    closeActionPanels();
    sendJson(
      { type: "player_action", actionType: "bet", amount },
      "player_action:bet",
    );
    playUiCue("action");
  };
  const handleAmountInputKeyDown = (event) => {
    if (event.key !== "Enter") return;
    if (!canActNow) return;
    event.preventDefault();
    if (canBetAction) {
      submitBet();
      return;
    }
    if (!canRaiseAction) return;
    if (preflopRaiseUi && preflopRaiseTarget !== null && !showRaiseSlider) {
      handleRaiseClick();
      return;
    }
    if (!showRaiseSlider) {
      setShowRaiseSlider(true);
      return;
    }
    handleRaiseClick();
  };
  const editBetPresetAtIndex = (index) => {
    const currentPresets = parseBetPresetPercentages(betPresetText);
    if (index < 0 || index >= currentPresets.length) return;

    const currentValue = currentPresets[index];
    const rawInput = window.prompt("Edit preset % (1-500)", String(currentValue));
    if (rawInput === null) return;

    const nextValue = Number(rawInput.trim());
    if (!Number.isFinite(nextValue) || nextValue <= 0 || nextValue > 500) {
      appendEvent("[local] preset edit ignored: value must be 1-500");
      return;
    }

    const normalized = Math.round(nextValue * 10) / 10;
    currentPresets[index] = normalized;
    setBetPresetText(currentPresets.join(","));
  };
  const getBotDecision = () =>
    botActionMode === "step" && isBotTurn
      ? { actionType: "bot_turn", toCall: botToCall }
      : null;

  useTableHotkeys({
    botActionMode,
    roomState,
    getBotDecision,
    runBotStep,
    isLocalTurn,
    canCheckAction,
    canCallAction,
    canFoldAction,
    canRaiseAction,
    canBetAction,
    submitCheck,
    submitCall,
    submitFold,
    handleRaiseClick,
    setShowPresetButtons,
  });

  return (
    <main className={`table-page ${uiDensity === "comfort" ? "density-comfort" : "density-compact"}`}>
      {connectionState !== "open" || lastServerError || sendBlockedNotice ? (
        <div
          className={`connection-banner ${
            connectionState !== "open" ? "connection-banner--offline" : "connection-banner--warn"
          }`}
          role="status"
          aria-live="polite"
        >
          {connectionState !== "open" ? (
            <div className="connection-banner-row connection-banner-row--main">
              <p className="connection-banner-main">
                {connectionState === "connecting"
                  ? "Connecting to the table…"
                  : connectionState === "error"
                    ? "Connection error — check that the game server is running, then reconnect."
                    : "Disconnected from the table — reconnect to keep playing."}
              </p>
              <div className="connection-banner-actions">
                <button
                  type="button"
                  className="connection-reconnect-button"
                  onClick={reconnectMainSocket}
                  disabled={connectionState === "connecting"}
                >
                  {connectionState === "connecting" ? "Connecting…" : "Reconnect"}
                </button>
              </div>
            </div>
          ) : null}
          {connectionState !== "open" ? (
            <p className="connection-banner-hint" title={WS_URL}>
              Endpoint <span className="connection-banner-mono">{WS_URL}</span>
            </p>
          ) : null}
          {connectionState === "open" && sendBlockedNotice ? (
            <div className="connection-banner-row connection-banner-row--notice">
              <p className="connection-banner-client-notice">{sendBlockedNotice}</p>
              <button
                type="button"
                className="connection-dismiss-button"
                onClick={() => setSendBlockedNotice(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {lastServerError ? (
            <div
              className={`connection-banner-row connection-banner-error connection-banner-error--${lastServerError.category}`}
            >
              <p className="connection-banner-error-text">
                <span className="connection-banner-error-label">
                  {serverErrorCategoryLabel(lastServerError.category)}:
                </span>{" "}
                {lastServerError.message}
              </p>
              <button
                type="button"
                className="connection-dismiss-button"
                onClick={() => setLastServerError(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <section className={`table-stage ${uiMotionPaused ? "motion-paused" : ""}`}>
        <header className="top-bar top-bar-overlay">
          <div className="top-branding">
            <h1>No Rake</h1>
          </div>
          <div className="top-status">
            <div className="top-status-badges">
              <span className={`status-badge status-${connectionState}`} title="WebSocket to game server">
                {connectionStatusLabel}
              </span>
              <span className={`role-badge ${isHost ? "role-host" : "role-player"}`}>
                {isHost ? "Role: Host" : "Role: Player"}
              </span>
              <span className={`bot-badge bot-${botState}`}>
                Bot: {botState}
                {isBotOpen ? ` (${botProfile})` : ""}
              </span>
            </div>
            <div className="top-game-menu">
              <button
                type="button"
                className="top-start-button top-game-menu-toggle"
                aria-expanded={showTopGameMenu}
                aria-controls="top-game-menu-panel"
                onClick={() => setShowTopGameMenu((previous) => !previous)}
              >
                Menu {showTopGameMenu ? "▲" : "▼"}
              </button>
              {showTopGameMenu ? (
                <div id="top-game-menu-panel" className="top-game-menu-panel" role="region" aria-label="Game controls">
                  <button
                    className="top-start-button"
                    disabled={!isSocketOpen || hasRound}
                    onClick={() => {
                      sendJson({ type: "start_round" }, "start_round");
                      setShowTopGameMenu(false);
                    }}
                  >
                    Start game
                  </button>
                  <button
                    className="top-density-button"
                    title="Toggle lightweight sound cues for actions, turns, and warnings"
                    onClick={() => setSoundEnabled((previous) => !previous)}
                  >
                    SFX: {soundEnabled ? "On" : "Off"}
                  </button>
                  <button
                    className="top-density-button"
                    title="Switch stack display between big blinds (BB) and table chips"
                    onClick={() => setShowBbStacks((previous) => !previous)}
                  >
                    Stacks: {showBbStacks ? "BB" : "Chips"}
                  </button>
                  <button
                    className="top-density-button"
                    onClick={() =>
                      setUiDensity((previous) =>
                        previous === "compact" ? "comfort" : "compact",
                      )
                    }
                  >
                    Density: {uiDensity === "compact" ? "Compact" : "Comfort"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <div className="table-pov-shell">
          <div className="table-felt" onClick={() => setOpenSeatMenuSeat(null)}>
            <div className="table-felt-content">
            <TableCenterBoard
              potValue={round.pot ?? 0}
              potChipCount={potChipCount}
              boardSlots={boardSlots}
              cardLabel={cardLabel}
              cardSuitClass={cardSuitClass}
            />

            <SeatNodesLayer
              seats={seats}
              seatLayoutMap={SEAT_LAYOUT}
              playersBySeat={playersBySeat}
              round={round}
              foldedSeatNumbers={foldedSeatNumbers}
              localSeatNumber={localSeatNumber}
              hasRound={hasRound}
              blindUnitValue={blindUnitValue}
              showBbStacks={showBbStacks}
              openSeatMenuSeat={openSeatMenuSeat}
              setOpenSeatMenuSeat={setOpenSeatMenuSeat}
              joinLocalSeat={joinLocalSeat}
              isBotOpen={isBotOpen}
              appendEvent={appendEvent}
              quickMode={quickMode}
              roomId={roomId}
              startBot={startBot}
              cardSuitClass={cardSuitClass}
              cardLabel={cardLabel}
              formatChipCount={formatChipCount}
              getBetMarkerPosition={getBetMarkerPosition}
            />
            </div>
          </div>
        </div>

        <div className={`table-hud-row ${shouldShowActionDock ? "" : "table-hud-row-dev-only"}`}>
          {shouldShowActionDock ? (
          <aside className="table-action-corner">
            <div className="table-action-dock" role="region" aria-label="Table actions">
            <HandStatusPanel
              statusLabel={actionStatusLabel}
              showResultLine={!hasRound && Boolean(winnerSummary || lastShowdown?.winningHandLabel)}
              winnerSummary={winnerSummary}
              winningHandLabel={lastShowdown?.winningHandLabel}
            />
            <HandContextPanel
              showAdvancedHandInfo={showAdvancedHandInfo}
              localCanActSummary={localCanActSummary}
              localPlayer={localPlayer}
              localToCall={localToCall}
              stackBehindDisplay={formatChipCount(localStackBehind)}
              canRaiseAction={canRaiseAction}
              raiseMinTarget={raiseMinTarget}
              currentBetDisplay={formatChipCount(round.currentBet ?? 0)}
              currentStreetActionsCount={currentStreetActions.length}
              hasRound={hasRound}
              committedThisStreetDisplay={formatChipCount(localCommittedThisStreet)}
              localPotOddsPercent={localPotOddsPercent}
              heroLastActionLabel={heroLastAction ? formatActionType(heroLastAction.actionType) : "-"}
            />
            <ActionControlsPanel
              canActNow={canActNow}
              hasRound={hasRound}
              canCheckAction={canCheckAction}
              canCallAction={canCallAction}
              canFoldAction={canFoldAction}
              canBetAction={canBetAction}
              canRaiseAction={canRaiseAction}
              showAmountControls={showAmountControls}
              amount={amount}
              localToCall={localToCall}
              raiseMinTarget={raiseMinTarget}
              raiseMaxTarget={raiseMaxTarget}
              localCommittedThisStreet={localCommittedThisStreet}
              showPresetButtons={showPresetButtons}
              betPresetPercentages={betPresetPercentages}
              showRaiseSlider={showRaiseSlider && canRaiseAction}
              preflopRaiseUi={preflopRaiseUi}
              preflopRaiseTarget={preflopRaiseTarget ?? raiseMinTarget}
              preflopSizingHint={preflopSizingHint}
              onAmountChange={setAmount}
              onAmountInputKeyDown={handleAmountInputKeyDown}
              onCheck={submitCheck}
              onCall={submitCall}
              onFold={submitFold}
              onRaiseClick={handleRaiseClick}
              onTogglePresets={() => setShowPresetButtons((previous) => !previous)}
              onApplyPreset={applyBetPreset}
              onEditPreset={editBetPresetAtIndex}
              onRaiseNudge={handleRaiseNudge}
              onSetHalfPotRaise={handleHalfPotRaise}
              onSetPotRaise={handlePotRaise}
              onSetMinRaise={handleSetMinRaise}
              onSetAllIn={handleSetAllInRaise}
              raiseSliderPosition={raiseSliderPosition}
              raiseQuarterAmount={raiseQuarterAmount}
              raiseMiddleAmount={raiseMiddleAmount}
              raiseThreeQuarterAmount={raiseThreeQuarterAmount}
              onRaiseSliderChange={handleRaiseSliderChange}
              onCloseRaiseSlider={() => setShowRaiseSlider(false)}
            />
            </div>
          </aside>
          ) : null}

          <aside className="table-dev-corner">
            <div className="table-hand-log-corner">
            <button
              className={`table-hand-log-toggle ${showHandLog ? "table-preview-toggle-active" : ""}`}
              onClick={() => setShowHandLog((previous) => !previous)}
            >
              Hand log
            </button>
            {showHandLog ? (
              <div className="table-hand-log-panel">
                <div className="table-hand-log-title">Recent actions</div>
                <ul className="table-hand-log-list">
                  {recentActionSummaries.length > 0 ? (
                    recentActionSummaries.map((summary, index) => (
                      <li key={`${summary}-${index}`}>{summary}</li>
                    ))
                  ) : (
                    <li>No actions yet.</li>
                  )}
                </ul>
              </div>
            ) : null}
            </div>
            <button
            className={`table-dev-toggle ${showDevTools ? "table-preview-toggle-active" : ""}`}
            onClick={() => setShowDevTools((previous) => !previous)}
            >
            Dev tools
            </button>
            {showDevTools ? (
            <div className="table-dev-dock">
              <div className="table-dev-title">Dev tools</div>
              <div className="table-dev-row">
              <button disabled={!isSocketOpen} onClick={() => quickJoin("p1", 1)}>
                Join P1
              </button>
              <button disabled={!isSocketOpen} onClick={() => quickJoin("p2", 2)}>
                Join P2
              </button>
            </div>
            <div className="table-dev-row">
              <button disabled={!isBotOpen} onClick={stopBot}>
                {isBotOpen ? `Stop bot (seat ${botSeatNumber})` : "Stop bot"}
              </button>
              <button
                className={`bot-mode-button ${isBotOpen && botActionMode === "auto" ? "bot-mode-button-active" : ""}`}
                disabled={!isBotOpen}
                onClick={() => handleBotActionModeChange("auto")}
              >
                Bot auto
              </button>
              <button
                className={`bot-mode-button ${isBotOpen && botActionMode === "step" ? "bot-mode-button-active" : ""}`}
                disabled={!isBotOpen}
                onClick={() => handleBotActionModeChange("step")}
              >
                Bot step
              </button>
              <button
                type="button"
                className={`bot-step-button ${
                  isBotOpen && botActionMode === "step"
                    ? isBotStepPossible
                      ? "bot-step-button-ready"
                      : "bot-step-button-idle"
                    : ""
                }`}
                disabled={!isBotOpen || botActionMode !== "step"}
                onClick={runBotStep}
              >
                {botStepGoLabel}
              </button>
            </div>
            <div className="table-dev-row">
              <span
                className={`table-dev-note ${
                  isBotOpen && botActionMode === "step"
                    ? isBotStepPossible
                      ? "table-dev-note-step-ready"
                      : "table-dev-note-step-wait"
                    : ""
                }`}
              >
                {!isBotOpen
                  ? "No bot connected. Click an open seat and choose Sit as bot."
                  : botActionMode === "auto"
                    ? `Bot mode: auto-play on turn (${botProfile})`
                    : isBotStepReady
                        ? `Step ready: bot turn (${botStepDecision.toCall} toCall) — press Go next action`
                        : isStepBlockedByHumanAction
                          ? `Step blocked: seat ${round.turnSeatNumber} must act first`
                          : "Step mode: no bot action pending. Press Go next action to advance street/hand."}
              </span>
            </div>
            <div className="table-dev-row">
              {supportedBotProfiles.map((profile) => (
                <button
                  key={`bot-profile-${profile}`}
                  className={`bot-mode-button ${botProfile === profile ? "bot-mode-button-active" : ""}`}
                  disabled={!isBotOpen}
                  onClick={() =>
                    sendJson(
                      {
                        type: "set_server_bot_profile",
                        profile,
                      },
                      "set_server_bot_profile",
                    )
                  }
                >
                  {profile.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="table-dev-row">
              <button
                className={`dev-toggle-button ${uiMotionPaused ? "dev-toggle-button-on" : "dev-toggle-button-off"}`}
                onClick={() => setUiMotionPaused((previous) => !previous)}
              >
                UI motion: {uiMotionPaused ? "PAUSED" : "LIVE"}
              </button>
              <button
                className={`dev-toggle-button ${showAdvancedHandInfo ? "dev-toggle-button-on" : "dev-toggle-button-off"}`}
                onClick={() => setShowAdvancedHandInfo((previous) => !previous)}
              >
                Advanced hand info: {showAdvancedHandInfo ? "ON" : "OFF"}
              </button>
            </div>
            <div className="table-dev-row">
              <button
                className={`dev-toggle-button ${autoDealEnabled ? "dev-toggle-button-on" : "dev-toggle-button-off"}`}
                disabled={!isSocketOpen || !isHost}
                onClick={() =>
                  sendJson(
                    {
                      type: "set_auto_deal",
                      enabled: !autoDealEnabled,
                      delayMs: autoDealDelayMs,
                    },
                    "set_auto_deal",
                  )
                }
              >
                Auto next hand: {autoDealEnabled ? "ON" : "OFF"}
              </button>
            </div>
            <div className="table-dev-row">
              <span className="table-dev-note">
                {isHost
                  ? `Host controls auto-deal (${autoDealDelayMs}ms delay)`
                  : `Host: ${table.hostPlayerName || "unknown"}`}
              </span>
            </div>
            <div className="table-dev-row">
              <button
                disabled={!isSocketOpen}
                onClick={() => {
                  const ws = wsRef.current;
                  if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send("ping-" + Date.now());
                    appendEvent("[out] ping-*");
                  }
                }}
              >
                Ping
              </button>
              </div>
            </div>
            ) : null}
          </aside>
        </div>
      </section>


      {hasLastHandResult ? (
        <section className="card hand-result-card">
          <h2>Last hand result</h2>
          <p className="hand-result-summary">
            {winnerSummary}
            {lastPayouts.length ? (
              <>
                {" "}
                - payout:{" "}
                {lastPayouts
                  .map((payout) => {
                    const playerName = playersBySeat.get(payout.seatNumber)?.playerName;
                    return `${playerName || `Seat ${payout.seatNumber}`} +${payout.amount}`;
                  })
                  .join(", ")}
              </>
            ) : null}
          </p>

          {showdownPlayers.length ? (
            <div className="hand-result-rows">
              {showdownPlayers.map((showdownPlayer) => (
                <article key={`showdown-${showdownPlayer.seatNumber}`} className="hand-result-row">
                  <div className="hand-result-header">
                    <span className="hand-result-name">
                      {showdownPlayer.playerName || `Seat ${showdownPlayer.seatNumber}`}
                    </span>
                    <span className="hand-result-rank">{showdownPlayer.rankLabel}</span>
                    <span className="hand-result-payout">
                      payout: +{payoutBySeat.get(showdownPlayer.seatNumber) ?? 0}
                    </span>
                  </div>
                  <div className="card-row">
                    {Array.isArray(showdownPlayer.bestCards) && showdownPlayer.bestCards.length ? (
                      showdownPlayer.bestCards.map((card, index) => (
                        <span
                          key={`${showdownPlayer.seatNumber}-${card}-${index}`}
                          className={`poker-card mini-card ${cardSuitClass(card)}`}
                        >
                          {cardLabel(card)}
                        </span>
                      ))
                    ) : (
                      <span className="placeholder-text">No best-hand cards</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

    </main>
  );
}

export default App;


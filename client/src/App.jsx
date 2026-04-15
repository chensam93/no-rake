import { useEffect, useRef, useState } from "react";
import "./App.css";
import HandStatusPanel from "./components/HandStatusPanel.jsx";
import PotClarityPanel from "./components/PotClarityPanel.jsx";
import HandContextPanel from "./components/HandContextPanel.jsx";
import ActionControlsPanel from "./components/ActionControlsPanel.jsx";
import TableCenterBoard from "./components/TableCenterBoard.jsx";
import SeatNodesLayer from "./components/SeatNodesLayer.jsx";
import { buildPotBreakdownPreview } from "./lib/handStateSelectors.js";
import { useSocketSenders } from "./hooks/useSocketSenders.js";
import { computeBotDecision } from "./lib/botDecision.js";

const DEFAULT_WS_URL = "ws://127.0.0.1:3000/ws";
const WS_URL = import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;
const DEFAULT_QUICK_MODE = true;
const DEFAULT_BET_PRESET_TEXT = "33,50,66,100";
const SEAT_LAYOUT = {
  1: { top: "90%", left: "50%" },
  2: { top: "83%", left: "72%" },
  3: { top: "66%", left: "89%" },
  4: { top: "39%", left: "90%" },
  5: { top: "18%", left: "71%" },
  6: { top: "9%", left: "50%" },
  7: { top: "18%", left: "29%" },
  8: { top: "39%", left: "10%" },
  9: { top: "66%", left: "11%" },
};
const BET_MARKER_LAYOUT = {
  1: { top: "71%", left: "50%" },
  2: { top: "64%", left: "61%" },
  3: { top: "55%", left: "71%" },
  4: { top: "45%", left: "72%" },
  5: { top: "33%", left: "61%" },
  6: { top: "26%", left: "50%" },
  7: { top: "33%", left: "39%" },
  8: { top: "45%", left: "28%" },
  9: { top: "55%", left: "29%" },
};

function getBetMarkerPosition(seatNumber) {
  const markerLayout = BET_MARKER_LAYOUT[seatNumber];
  if (markerLayout) {
    return { top: markerLayout.top, left: markerLayout.left };
  }
  const seatLayout = SEAT_LAYOUT[seatNumber];
  if (!seatLayout) return { top: "50%", left: "50%" };
  const seatTop = Number.parseFloat(seatLayout.top);
  const seatLeft = Number.parseFloat(seatLayout.left);
  const towardCenter = 0.4;
  const top = seatTop + (50 - seatTop) * towardCenter;
  const left = seatLeft + (50 - seatLeft) * towardCenter;
  return { top: `${top}%`, left: `${left}%` };
}

function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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

function App() {
  const wsRef = useRef(null);
  const botWsRef = useRef(null);
  const botLastActionKeyRef = useRef(null);
  const botSeatRef = useRef(null);
  const [connectionState, setConnectionState] = useState("connecting");
  const [botState, setBotState] = useState("off");
  const [botSeatNumber, setBotSeatNumber] = useState(null);
  const [openSeatMenuSeat, setOpenSeatMenuSeat] = useState(null);
  const [events, setEvents] = useState([]);
  const [roomId, setRoomId] = useState("home");
  const [playerName, setPlayerName] = useState("player");
  const [seatNumber, setSeatNumber] = useState(1);
  const [amount, setAmount] = useState(40);
  const [showRaiseSlider, setShowRaiseSlider] = useState(false);
  const [betPresetText, setBetPresetText] = useState(DEFAULT_BET_PRESET_TEXT);
  const [quickMode, setQuickMode] = useState(DEFAULT_QUICK_MODE);
  const [botActionMode, setBotActionMode] = useState("auto");
  const [uiMotionPaused, setUiMotionPaused] = useState(false);
  const [uiDensity, setUiDensity] = useState("compact");
  const [showBbStacks, setShowBbStacks] = useState(true);
  const [showAdvancedHandInfo, setShowAdvancedHandInfo] = useState(false);
  const [showPresetButtons, setShowPresetButtons] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [roomState, setRoomState] = useState(null);
  const [lastError, setLastError] = useState(null);
  const isSocketOpen = connectionState === "open";
  const isBotOpen = botState === "open";

  const appendEvent = (line) => {
    const stamped = `[${timestamp()}] ${line}`;
    setEvents((prev) => [...prev.slice(-79), stamped]);
  };
  const { sendJson, sendBotJson } = useSocketSenders(wsRef, botWsRef, appendEvent);

  const stopBot = () => {
    const ws = botWsRef.current;
    if (ws) {
      ws.close();
      botWsRef.current = null;
    }
    botLastActionKeyRef.current = null;
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
    botLastActionKeyRef.current = decision.actionKey;

    const sendAction = () => {
      if (!botWsRef.current || botWsRef.current.readyState !== WebSocket.OPEN) return;
      sendBotJson({ type: "player_action", actionType: decision.actionType }, decision.label);
    };

    if (delayMs <= 0) {
      sendAction();
      return true;
    }

    setTimeout(() => {
      sendAction();
    }, delayMs);
    return true;
  };

  const maybeRunBotAction = (roomStatePayload) => {
    if (botActionMode !== "auto") return;
    const decision = getBotDecision(roomStatePayload);
    runBotDecision(decision, 350);
  };

  const runBotStep = () => {
    const decision = getBotDecision(roomState);
    if (!decision) {
      appendEvent("[bot] step mode: no action available");
      return;
    }
    runBotDecision(decision, 0);
    appendEvent(`[bot] step mode action: ${decision.actionType} (toCall=${decision.toCall})`);
  };

  const handleBotActionModeChange = (nextMode) => {
    setBotActionMode(nextMode);
    appendEvent(`[bot] action mode: ${nextMode}`);
    if (nextMode === "auto" && roomState) {
      maybeRunBotAction(roomState);
    }
  };

  const startBot = (targetSeatNumber, targetRoomId = roomId) => {
    if (!Number.isInteger(targetSeatNumber) || targetSeatNumber < 1 || targetSeatNumber > 9) {
      appendEvent("[bot] invalid seat for bot");
      return;
    }
    if (botWsRef.current && botWsRef.current.readyState === WebSocket.OPEN) return;

    const botWs = new WebSocket(WS_URL);
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

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState("open");
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
      }

      if (parsed.type === "error") {
        setLastError(parsed.message);
      }
    };

    return () => {
      ws.close();
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      stopBot();
    };
  }, []);

  const seats = Array.from({ length: 9 }, (_, index) => index + 1);
  const playersBySeat = new Map();
  if (roomState?.players) {
    for (const player of roomState.players) {
      if (player.seatNumber !== null) {
        playersBySeat.set(player.seatNumber, player);
      }
    }
  }
  const seatedPlayers = [...playersBySeat.values()];
  const table = roomState?.table ?? {};
  const round = roomState?.round ?? {};
  const blindUnitValue = Math.max(1, Number(round.bigBlind ?? table.bigBlind ?? 20));
  const boardCards = Array.isArray(round.board) ? round.board : [];
  const pendingSeatNumbers = Array.isArray(round.pendingSeatNumbers)
    ? round.pendingSeatNumbers
    : [];
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
  const localPlayer =
    roomState?.players?.find(
      (candidate) => candidate.seatNumber !== null && candidate.playerName === playerName,
    ) ?? playersBySeat.get(seatNumber) ?? null;
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
  const lastAction = actionLog.length > 0 ? actionLog[actionLog.length - 1] : null;
  const heroLastAction =
    localSeatNumber !== null
      ? [...currentStreetActions].reverse().find((action) => action.seatNumber === localSeatNumber) ?? null
      : null;
  const turnToCall = turnPlayer
    ? Math.max(0, (round.currentBet ?? 0) - (turnPlayer.committedThisStreet ?? 0))
    : 0;
  const nextActionSummary = hasRound
    ? round.turnSeatNumber
      ? `${turnPlayer?.playerName || `Seat ${round.turnSeatNumber}`} to act${
          turnToCall > 0 ? ` (call ${formatChipCount(turnToCall)})` : " (can check)"
        }`
      : "All remaining players are all-in - running board"
    : "No active hand";
  const actionStatusLabel = hasRound
    ? isLocalTurn
      ? "Your turn"
      : round.turnSeatNumber
        ? `Acting: ${turnPlayer?.playerName || `Seat ${round.turnSeatNumber}`}`
        : "Board running out (all-in)"
    : "No active hand";
  const localCanActSummary = !hasRound
    ? "No active hand"
    : isLocalTurn
      ? "Your action"
      : localPlayer
        ? "Waiting for turn"
        : "You are not seated";
  const localPotOddsPercent =
    localToCall > 0
      ? Math.round((localToCall / Math.max(1, (round.pot ?? 0) + localToCall)) * 100)
      : 0;
  const botStepDecision = botActionMode === "step" ? getBotDecision(roomState) : null;
  const isBotStepReady = Boolean(botStepDecision);
  const livePotBreakdown = hasRound
    ? buildPotBreakdownPreview(players, foldedSeatNumbers)
    : [];
  const settledPotBreakdown =
    !hasRound && Array.isArray(round.lastPotBreakdown) ? round.lastPotBreakdown : [];
  const visiblePotBreakdown = hasRound ? livePotBreakdown : settledPotBreakdown;
  const compactPotSummary = visiblePotBreakdown.length
    ? visiblePotBreakdown
        .map((pot, index) =>
          `${index === 0 ? "Main" : `Side ${index}`}: ${formatChipCount(pot.amount ?? 0)}`,
        )
        .join(" | ")
    : "Main: 0";
  const potDetailLines = visiblePotBreakdown.map((pot, index) => {
    const winnerLabel =
      !hasRound && Array.isArray(pot.winnerSeatNumbers) && pot.winnerSeatNumbers.length > 0
        ? ` -> winner ${pot.winnerSeatNumbers.join(", ")}`
        : "";
    return `${index === 0 ? "Main" : `Side ${index}`} ${formatChipCount(pot.amount ?? 0)} (${
      Array.isArray(pot.eligibleSeatNumbers) ? pot.eligibleSeatNumbers.join(", ") : "-"
    })${winnerLabel}`;
  });

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
  };

  const handleRaiseClick = () => {
    if (!canRaiseAction) return;
    setShowRaiseSlider((previous) => {
      if (!previous) {
        if (amount < raiseMinTarget || amount > raiseMaxTarget) {
          setAmount(raiseMinTarget);
        }
      }
      return !previous;
    });
  };

  const handleRaiseSliderChange = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(raiseMinTarget, Math.min(raiseMaxTarget, Math.round(parsed)));
    setAmount(clamped);
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
  const submitCheck = () =>
    sendJson({ type: "player_action", actionType: "check" }, "player_action:check");
  const submitCall = () =>
    sendJson({ type: "player_action", actionType: "call" }, "player_action:call");
  const submitFold = () =>
    sendJson({ type: "player_action", actionType: "fold" }, "player_action:fold");
  const submitBet = () =>
    sendJson(
      { type: "player_action", actionType: "bet", amount },
      "player_action:bet",
    );
  const submitRaise = () =>
    sendJson(
      { type: "player_action", actionType: "raise_to", amount },
      "player_action:raise_to",
    );

  useEffect(() => {
    if (!canRaiseAction) {
      setShowRaiseSlider(false);
    }
  }, [canRaiseAction]);

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

  return (
    <main className={`table-page ${uiDensity === "comfort" ? "density-comfort" : "density-compact"}`}>
      <header className="top-bar">
        <div>
          <h1>No Rake</h1>
          <p className="sub">Ready-to-test table UI</p>
        </div>
        <div className="top-status">
          <button
            className="top-start-button"
            disabled={!isSocketOpen || hasRound}
            onClick={() => sendJson({ type: "start_round" }, "start_round")}
          >
            Start game
          </button>
          <span className={`status-badge status-${connectionState}`}>{connectionState}</span>
          <span className={`bot-badge bot-${botState}`}>Bot: {botState}</span>
          <button className="top-density-button" onClick={() => setShowBbStacks((previous) => !previous)}>
            Stacks: {showBbStacks ? "chips+bb" : "chips"}
          </button>
          <button className="top-density-button" onClick={() => setUiDensity((previous) => (previous === "compact" ? "comfort" : "compact"))}>
            Density: {uiDensity === "compact" ? "Compact" : "Comfort"}
          </button>
        </div>
      </header>

      <section className={`table-stage ${uiMotionPaused ? "motion-paused" : ""}`}>
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

        <aside className="table-action-corner">
          <div className="table-action-dock">
            <HandStatusPanel
              statusLabel={actionStatusLabel}
              lastActionSummary={formatActionSummary(lastAction)}
              nextActionSummary={nextActionSummary}
              showResultLine={!hasRound && Boolean(winnerSummary || lastShowdown?.winningHandLabel)}
              winnerSummary={winnerSummary}
              winningHandLabel={lastShowdown?.winningHandLabel}
            />
            <PotClarityPanel
              hasRound={hasRound}
              localPlayer={localPlayer}
              localStackBehind={localStackBehind}
              localToCall={localToCall}
              localToCallDisplay={formatChipCount(localToCall)}
              compactPotSummary={compactPotSummary}
              showAdvancedHandInfo={showAdvancedHandInfo}
              potDetailLines={potDetailLines}
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
              raiseStep={raiseStep}
              localCommittedThisStreet={localCommittedThisStreet}
              showPresetButtons={showPresetButtons}
              betPresetPercentages={betPresetPercentages}
              showRaiseSlider={showRaiseSlider}
              onAmountChange={setAmount}
              onCheck={submitCheck}
              onCall={submitCall}
              onFold={submitFold}
              onBet={submitBet}
              onRaiseClick={handleRaiseClick}
              onTogglePresets={() => setShowPresetButtons((previous) => !previous)}
              onApplyPreset={applyBetPreset}
              onEditPreset={editBetPresetAtIndex}
              onRaiseNudge={handleRaiseNudge}
              onSetHalfPotRaise={handleHalfPotRaise}
              onSetPotRaise={handlePotRaise}
              onSetMinRaise={handleSetMinRaise}
              onSetAllIn={handleSetAllInRaise}
              onRaiseSliderChange={handleRaiseSliderChange}
              onSubmitRaise={submitRaise}
              onCloseRaiseSlider={() => setShowRaiseSlider(false)}
            />
          </div>
        </aside>

        <aside className="table-dev-corner">
          <button className="table-dev-toggle" onClick={() => setShowDevTools((previous) => !previous)}>
            {showDevTools ? "Hide dev tools" : "Show dev tools"}
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
              {isBotOpen ? (
                <>
                  <button onClick={stopBot}>Stop bot (seat {botSeatNumber})</button>
                  <button
                    className={`bot-mode-button ${botActionMode === "auto" ? "bot-mode-button-active" : ""}`}
                    onClick={() => handleBotActionModeChange("auto")}
                  >
                    Bot auto
                  </button>
                  <button
                    className={`bot-mode-button ${botActionMode === "step" ? "bot-mode-button-active" : ""}`}
                    onClick={() => handleBotActionModeChange("step")}
                  >
                    Bot step
                  </button>
                  {botActionMode === "step" ? (
                    <button className="bot-step-button" disabled={!isBotStepReady} onClick={runBotStep}>
                      Run bot action
                    </button>
                  ) : null}
                </>
              ) : (
                <span className="table-dev-note">Click an open seat to add bot</span>
              )}
            </div>
            {isBotOpen ? (
              <div className="table-dev-row">
                <span className="table-dev-note">
                  {botActionMode === "auto"
                    ? "Bot mode: auto-play on turn"
                    : isBotStepReady
                      ? `Bot step ready: ${botStepDecision.actionType} (toCall ${botStepDecision.toCall})`
                      : "Bot step mode: waiting for a legal action"}
                </span>
              </div>
            ) : null}
            <div className="table-dev-row">
              <button onClick={() => setUiMotionPaused((previous) => !previous)}>
                UI motion: {uiMotionPaused ? "PAUSED" : "LIVE"}
              </button>
              <button onClick={() => setShowAdvancedHandInfo((previous) => !previous)}>
                Advanced hand info: {showAdvancedHandInfo ? "ON" : "OFF"}
              </button>
            </div>
            <div className="table-dev-row">
              <button
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
      </section>

      <section className="card controls-card">
        <h2>Table Controls</h2>
        <p className="table-note">
          WebSocket: <code>{WS_URL}</code>
        </p>

        <div className="row quick-header">
          <span className="quick-badge">Quick test mode: room `home`, seats 1-2</span>
          <label className="quick-toggle">
            <input
              type="checkbox"
              checked={quickMode}
              onChange={(event) => setQuickMode(event.target.checked)}
            />
            Use quick mode
          </label>
        </div>

        {quickMode ? (
          <div className="row buttons">
            <button disabled={!isSocketOpen} onClick={() => quickJoin("p1", 1)}>
              Join as P1 (Seat 1)
            </button>
            <button disabled={!isSocketOpen} onClick={() => quickJoin("p2", 2)}>
              Join as P2 (Seat 2)
            </button>
            <span className="table-dev-note">Click an open seat for bot options</span>
            <span className={`bot-badge bot-${botState}`}>Bot: {botState}</span>
          </div>
        ) : null}

        {!quickMode ? (
        <div className="row">
          <label>
            Room
            <input value={roomId} onChange={(event) => setRoomId(event.target.value)} />
          </label>
          <label>
            Name
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
            />
          </label>
          <label>
            Seat
            <input
              type="number"
              min={1}
              max={9}
              value={seatNumber}
              onChange={(event) => setSeatNumber(Number(event.target.value || 1))}
            />
          </label>
          <label>
            Amount
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(event) => setAmount(Number(event.target.value || 1))}
            />
          </label>
        </div>
        ) : null}

        <div className="row buttons action-buttons">
          {!quickMode ? (
            <>
              <button
                disabled={!isSocketOpen}
                onClick={() => sendJson({ type: "join_room", roomId, playerName }, "join_room")}
              >
                Join room
              </button>
              <button
                disabled={!isSocketOpen}
                onClick={() => sendJson({ type: "sit_down", seatNumber }, "sit_down")}
              >
                Sit down
              </button>
            </>
          ) : null}
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
            Ping (text)
          </button>
        </div>

        {lastError ? <p className="error">Last server error: {lastError}</p> : null}
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

      <details className="card debug-card">
        <summary>Debug panels</summary>
        <section className="state-grid">
          <div>
            <h2>Round</h2>
            {roomState?.round ? (
              <ul>
                <li>inProgress: {String(round.inProgress)}</li>
                <li>street: {String(round.street)}</li>
                <li>board: {boardCards.join(" ") || "none"}</li>
                <li>pot: {round.pot ?? "-"}</li>
                <li>dealerSeatNumber: {String(round.dealerSeatNumber)}</li>
                <li>smallBlindSeatNumber: {String(round.smallBlindSeatNumber)}</li>
                <li>bigBlindSeatNumber: {String(round.bigBlindSeatNumber)}</li>
                <li>blinds: {round.smallBlind ?? "-"}/{round.bigBlind ?? "-"}</li>
                <li>turnSeatNumber: {String(round.turnSeatNumber)}</li>
                <li>pendingSeatNumbers: {pendingSeatNumbers.join(", ") || "none"}</li>
                <li>currentBet: {round.currentBet ?? "-"}</li>
                <li>minRaiseTo: {String(round.minRaiseTo)}</li>
                <li>lastEndReason: {String(round.lastEndReason)}</li>
                <li>lastWinnerSeatNumbers: {lastWinnerSeatNumbers.join(", ") || "none"}</li>
                <li>
                  lastPayouts:
                  {lastPayouts.length
                    ? ` ${lastPayouts.map((payout) => `${payout.seatNumber}:${payout.amount}`).join(", ")}`
                    : " none"}
                </li>
                <li>folded: {foldedSeatNumbers.join(", ") || "none"}</li>
              </ul>
            ) : (
              <p>No round state yet.</p>
            )}
          </div>
          <div>
            <h2>Raw room_state</h2>
            <pre>{roomState ? prettyJson(roomState) : "waiting for room_state..."}</pre>
          </div>
        </section>
        <section className="card debug-inner-card">
          <h2>Event Log</h2>
          <pre>{events.length > 0 ? events.join("\n") : "waiting..."}</pre>
        </section>
      </details>
    </main>
  );
}

export default App;


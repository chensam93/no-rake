import { useRef, useState } from "react";
import { isDebugLogsEnabled } from "../debugLogs.js";

/** Nudge dealer button from seat anchor toward table center (board) — reads like a live dealer puck. */
const DEALER_BUTTON_SEAT_TWEAKS = {
  // Keep seat-level micro-adjustments conservative so puck stays anchored to owner seat.
  1: { x: -8, y: -4 },
};

function getDealerNudgeStyle(seatLayout, seatNumber) {
  if (!seatLayout?.left || !seatLayout?.top) return undefined;
  const left = Number.parseFloat(seatLayout.left) / 100;
  const top = Number.parseFloat(seatLayout.top) / 100;
  const centerX = 0.5;
  const centerY = 0.5;
  const dx = centerX - left;
  const dy = centerY - top;
  const len = Math.hypot(dx, dy);
  if (len < 0.0001) return undefined;
  const scalePx = 14;
  const nx = (dx / len) * scalePx;
  const ny = (dy / len) * scalePx;
  const tweak = DEALER_BUTTON_SEAT_TWEAKS[seatNumber] ?? { x: 0, y: 0 };
  return {
    transform: `translate(${(nx + tweak.x).toFixed(1)}px, ${(ny + tweak.y).toFixed(1)}px)`,
  };
}

const CHIP_ADJACENT_DELTAS = [100, -100];
const CHIP_COARSE_DELTAS = [-500, 500, 1000];
/** Fine nudges: first button is drawn above the second (closest to stack). */
const BB_ADJACENT_DELTAS = [1, -1];
const BB_COARSE_DELTAS = [-5, 5, 10];

function formatDeltaLabel(amount) {
  return amount > 0 ? `+${amount}` : String(amount);
}

function formatStackForInput(stackChips, showBbStacks, blindUnit) {
  if (!showBbStacks) return String(Math.max(0, Math.trunc(stackChips)));
  const bb = Math.max(0, stackChips) / blindUnit;
  const rounded = bb >= 100 ? Math.round(bb) : Math.round(bb * 10) / 10;
  return rounded === 0 ? "0" : String(rounded);
}

function HostSeatAdminMenu({
  seat,
  player,
  blindUnitValue,
  showBbStacks,
  onAdjustStack,
  onKickPlayer,
  onClose,
}) {
  const currentStack = Math.max(0, Number(player?.stack ?? 0));
  const blindUnit = Math.max(1, Number(blindUnitValue) || 1);
  const [editDraft, setEditDraft] = useState(null);
  const displayValue =
    editDraft !== null ? editDraft : formatStackForInput(currentStack, showBbStacks, blindUnit);

  const applyDelta = (rawDelta) => {
    const chipDelta = showBbStacks
      ? Math.round(rawDelta * blindUnit)
      : Math.trunc(rawDelta);
    if (!chipDelta) return;
    setEditDraft(null);
    onAdjustStack({ seatNumber: seat, mode: "delta", amount: chipDelta });
  };

  const commitSet = () => {
    if (editDraft === null) return;
    const parsed = Number(editDraft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setEditDraft(null);
      return;
    }
    const chipValue = showBbStacks
      ? Math.max(0, Math.round(parsed * blindUnit))
      : Math.max(0, Math.trunc(parsed));
    setEditDraft(null);
    if (chipValue === currentStack) return;
    onAdjustStack({ seatNumber: seat, mode: "set", amount: chipValue });
  };

  const adjacentDeltas = showBbStacks ? BB_ADJACENT_DELTAS : CHIP_ADJACENT_DELTAS;
  const coarseDeltas = showBbStacks ? BB_COARSE_DELTAS : CHIP_COARSE_DELTAS;
  const unitLabel = showBbStacks ? "BB" : "chips";

  return (
    <div
      className="seat-admin-menu"
      draggable={false}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-label={`Host controls for seat ${seat}`}
    >
      <div className="seat-admin-header">
        <span className="seat-admin-title">
          {player?.playerName || `Seat ${seat}`}
        </span>
        <button
          type="button"
          className="seat-admin-close"
          onClick={() => onClose(seat)}
          aria-label="Close host menu"
        >
          ×
        </button>
      </div>
      <div className="seat-admin-stack-editor">
        <div className="seat-admin-stack-line">
          <div className="seat-admin-stack-value">
            <input
              id={`seat-admin-stack-${seat}`}
              type="number"
              min={0}
              step={showBbStacks ? 0.5 : 1}
              inputMode="decimal"
              value={displayValue}
              size={Math.min(10, Math.max(2, String(displayValue).length + 1))}
              onChange={(event) => setEditDraft(event.target.value)}
              onBlur={commitSet}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitSet();
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setEditDraft(null);
                  event.currentTarget.blur();
                }
              }}
              aria-label={`Stack in ${unitLabel}`}
            />
            <span className="seat-admin-unit-tag">{unitLabel}</span>
          </div>
          <div className="seat-admin-delta-layout">
            <div className="seat-admin-delta-fine" aria-label="Nudge stack">
              {adjacentDeltas.map((delta) => (
                <button
                  key={`delta-adj-${delta}`}
                  type="button"
                  className="seat-admin-delta-fine-btn"
                  onClick={() => applyDelta(delta)}
                  aria-label={`${delta > 0 ? "Increase" : "Decrease"} stack by ${Math.abs(delta)} ${unitLabel}`}
                >
                  {delta > 0 ? "+" : "-"}
                </button>
              ))}
            </div>
            <div className="seat-admin-delta-coarse" aria-label="Larger stack changes">
              {coarseDeltas.map((delta) => (
                <button
                  key={`delta-coarse-${delta}`}
                  type="button"
                  className="seat-admin-delta-coarse-btn"
                  onClick={() => applyDelta(delta)}
                >
                  {formatDeltaLabel(delta)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="seat-admin-section seat-admin-section--kick">
        <button
          type="button"
          className="seat-admin-kick"
          onClick={() => onKickPlayer({ seatNumber: seat, playerName: player?.playerName })}
        >
          Kick {player?.playerName || `seat ${seat}`}
        </button>
      </div>
    </div>
  );
}

export default function SeatNodesLayer({
  seats,
  seatLayoutMap,
  playersBySeat,
  round,
  foldedSeatNumbers,
  localSeatNumber,
  hasRound,
  blindUnitValue,
  showBbStacks,
  openSeatMenuSeat,
  setOpenSeatMenuSeat,
  joinLocalSeat,
  isBotOpen,
  appendEvent,
  quickMode,
  roomId,
  startBot,
  cardSuitClass,
  cardLabel,
  formatChipCount,
  getBetMarkerPosition,
  isHost = false,
  hostAdminEnabled = false,
  onHostAdjustStack = () => {},
  onHostMovePlayer = () => {},
  onHostKickPlayer = () => {},
}) {
  const seatedPlayerCount = playersBySeat.size;
  const isHeadsUp = seatedPlayerCount === 2;
  const [dragSourceSeat, setDragSourceSeat] = useState(null);
  const [dragOverSeat, setDragOverSeat] = useState(null);
  const dragSourceSeatRef = useRef(null);

  const beginSeatDrag = (event, fromSeat) => {
    if (!hostAdminEnabled) return;
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("application/x-norake-seat", String(fromSeat));
      event.dataTransfer.setData("text/plain", `seat:${fromSeat}`);
    } catch {
      // some browsers restrict dataTransfer outside drag
    }
    dragSourceSeatRef.current = fromSeat;
    setDragSourceSeat(fromSeat);
    setOpenSeatMenuSeat(null);
    if (isDebugLogsEnabled()) appendEvent(`[drag] start source=${fromSeat}`);
  };

  const endSeatDrag = () => {
    if (isDebugLogsEnabled()) {
      appendEvent(`[drag] end source=${dragSourceSeatRef.current}`);
    }
    dragSourceSeatRef.current = null;
    setDragSourceSeat(null);
    setDragOverSeat(null);
  };

  const allowSeatDrop = (event, targetSeat) => {
    if (!hostAdminEnabled) return;
    const sourceSeat = dragSourceSeatRef.current;
    if (sourceSeat === null || sourceSeat === targetSeat) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverSeat !== targetSeat) {
      setDragOverSeat(targetSeat);
    }
  };

  const handleSeatDragLeave = (targetSeat) => {
    if (dragOverSeat === targetSeat) {
      setDragOverSeat(null);
    }
  };

  const handleSeatDrop = (event, targetSeat) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceSeat = dragSourceSeatRef.current;
    if (isDebugLogsEnabled()) {
      appendEvent(
        `[drag] drop target=${targetSeat} source=${sourceSeat} hostAdminEnabled=${hostAdminEnabled}`,
      );
    }
    dragSourceSeatRef.current = null;
    setDragSourceSeat(null);
    setDragOverSeat(null);
    if (!hostAdminEnabled) return;
    if (sourceSeat === null || sourceSeat === targetSeat) return;
    onHostMovePlayer({ fromSeatNumber: sourceSeat, toSeatNumber: targetSeat });
  };

  return (
    <>
      {seats.map((seat) => {
        const player = playersBySeat.get(seat);
        const seatLayout = seatLayoutMap[seat];
        const isTurn = round.turnSeatNumber === seat;
        const isDealer = round.dealerSeatNumber === seat;
        const isSmallBlind = round.smallBlindSeatNumber === seat;
        const isBigBlind = round.bigBlindSeatNumber === seat;
        const isFolded = foldedSeatNumbers.includes(seat);
        const isOpenSeat = !player;
        const isHeroSeat = localSeatNumber !== null && seat === localSeatNumber;
        const committedThisStreet = player?.committedThisStreet ?? 0;
        const stackValue = Math.max(0, Number(player?.stack ?? 0));
        const isAllIn = hasRound && !isFolded && player && stackValue <= 0;
        const blindRoleLabel = isHeadsUp
          ? isBigBlind
            ? "BB"
            : null
          : isSmallBlind
            ? "SB"
            : isBigBlind
              ? "BB"
              : null;
        const stackInBb = stackValue / blindUnitValue;
        const stackBbLabel =
          stackInBb >= 100 ? Math.round(stackInBb) : Math.round(stackInBb * 10) / 10;
        const committedBbLabel = Math.round((committedThisStreet / blindUnitValue) * 100) / 100;

        const isDragSource = dragSourceSeat === seat;
        const isDragTarget = dragOverSeat === seat && dragSourceSeat !== null && dragSourceSeat !== seat;
        const seatDragHandlers = hostAdminEnabled
          ? {
              onDragOver: (event) => allowSeatDrop(event, seat),
              onDragEnter: (event) => allowSeatDrop(event, seat),
              onDragLeave: () => handleSeatDragLeave(seat),
              onDrop: (event) => handleSeatDrop(event, seat),
            }
          : {};
        const filledSeatDraggable = !isOpenSeat && hostAdminEnabled;
        const seatClassName = isOpenSeat
          ? `seat-open-node ${isDragTarget ? "seat-drop-target" : ""}`
          : `seat-node seat-filled ${isTurn ? "seat-turn" : ""} ${isFolded ? "seat-folded" : ""} ${isHeroSeat ? "seat-hero" : ""} ${isAllIn ? "seat-all-in" : ""} ${filledSeatDraggable ? "seat-draggable" : ""} ${isDragSource ? "seat-drag-source" : ""} ${isDragTarget ? "seat-drop-target" : ""}`;

        return (
          <div key={seat}>
            <div
              className={seatClassName}
              style={{ top: seatLayout.top, left: seatLayout.left }}
              draggable={filledSeatDraggable}
              onDragStart={filledSeatDraggable ? (event) => beginSeatDrag(event, seat) : undefined}
              onDragEnd={filledSeatDraggable ? endSeatDrag : undefined}
              {...seatDragHandlers}
            >
              {isOpenSeat ? (
                <div
                  className={`seat-open-dot ${openSeatMenuSeat === seat ? "seat-open-dot-active" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenSeatMenuSeat((previous) => (previous === seat ? null : seat));
                  }}
                >
                  <span className="seat-open-label">OPEN</span>
                  <span className="seat-open-number">Seat {seat} - click</span>
                  {openSeatMenuSeat === seat ? (
                    <div className="seat-open-menu" onClick={(event) => event.stopPropagation()}>
                      <button onClick={() => joinLocalSeat(seat)}>Sit as human</button>
                      <button
                        onClick={() => {
                          setOpenSeatMenuSeat(null);
                          if (isBotOpen) {
                            appendEvent("[bot] stop current bot before adding another");
                            return;
                          }
                          const targetRoomId = quickMode ? "home" : roomId.trim() || "home";
                          startBot(seat, targetRoomId);
                        }}
                      >
                        Sit as bot
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  {isTurn ? <span className="seat-action-indicator" aria-label="Acting now" /> : null}
                  <div className="seat-node-play-wrap">
                    {isDealer ? (
                      <div
                        className="seat-node-dealer-slot"
                        style={getDealerNudgeStyle(seatLayout, seat)}
                      >
                        <span className="dealer-button">D</span>
                      </div>
                    ) : null}
                    <div className="card-row seat-node-cards">
                      {player.holeCards?.length ? (
                        player.holeCards.map((card) => (
                          <span key={`${seat}-${card}`} className={`poker-card mini-card ${cardSuitClass(card)}`}>
                            {cardLabel(card)}
                          </span>
                        ))
                      ) : (
                        <span className="placeholder-text">No cards</span>
                      )}
                    </div>
                    {blindRoleLabel ? (
                      <div className="seat-node-markers-row">
                        <div className="seat-node-markers">
                          <span className="position-chip">{blindRoleLabel}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="seat-node-meta">
                    <div
                      className={`seat-stack-badge ${showBbStacks ? "seat-stack-badge-bb-mode" : "seat-stack-badge-chips-mode"}`}
                    >
                      {showBbStacks ? (
                        <span className="seat-stack-primary">
                          <span className="seat-stack-value">{stackBbLabel}</span>
                          <span className="seat-stack-unit">BB</span>
                        </span>
                      ) : (
                        <span className="seat-stack-primary">
                          <span className="seat-stack-value">{formatChipCount(stackValue)}</span>
                          <span className="seat-stack-unit seat-stack-unit-chips">chips</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="seat-node-name">{player.playerName}</div>
                  {isHost ? (
                    <button
                      type="button"
                      draggable={false}
                      className={`seat-admin-toggle ${openSeatMenuSeat === seat ? "seat-admin-toggle-active" : ""}`}
                      disabled={!hostAdminEnabled}
                      title={
                        hostAdminEnabled
                          ? "Host: adjust stack, move, or kick"
                          : "Host controls available between hands"
                      }
                      onMouseDown={(event) => {
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!hostAdminEnabled) return;
                        setOpenSeatMenuSeat((previous) => (previous === seat ? null : seat));
                      }}
                      aria-label={`Host controls for ${player.playerName}`}
                    >
                      ⋯
                    </button>
                  ) : null}
                  {isHost && hostAdminEnabled && openSeatMenuSeat === seat ? (
                    <HostSeatAdminMenu
                      seat={seat}
                      player={player}
                      blindUnitValue={blindUnitValue}
                      showBbStacks={showBbStacks}
                      onAdjustStack={onHostAdjustStack}
                      onKickPlayer={onHostKickPlayer}
                      onClose={() => setOpenSeatMenuSeat(null)}
                    />
                  ) : null}
                </>
              )}
            </div>
            {committedThisStreet > 0 ? (
              <div
                className={`bet-marker ${isTurn ? "bet-marker-turn" : ""}`}
                style={getBetMarkerPosition(seat)}
              >
                <span className="bet-marker-chip" />
                <span className="bet-marker-value">
                  {showBbStacks ? `${committedBbLabel} BB` : committedThisStreet}
                </span>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

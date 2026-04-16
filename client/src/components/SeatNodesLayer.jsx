/** Nudge dealer button from seat anchor toward table center (board) — reads like a live dealer puck. */
function getDealerNudgeStyle(seatLayout) {
  if (!seatLayout?.left || !seatLayout?.top) return undefined;
  const left = Number.parseFloat(seatLayout.left) / 100;
  const top = Number.parseFloat(seatLayout.top) / 100;
  const centerX = 0.5;
  const centerY = 0.5;
  const dx = centerX - left;
  const dy = centerY - top;
  const len = Math.hypot(dx, dy);
  if (len < 0.0001) return undefined;
  const scalePx = 26;
  const nx = (dx / len) * scalePx;
  const ny = (dy / len) * scalePx;
  return { transform: `translate(${nx.toFixed(1)}px, ${ny.toFixed(1)}px)` };
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
}) {
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
        const blindRoleLabel = isSmallBlind ? "SB" : isBigBlind ? "BB" : null;
        const stackInBb = stackValue / blindUnitValue;
        const stackBbLabel =
          stackInBb >= 100 ? Math.round(stackInBb) : Math.round(stackInBb * 10) / 10;

        return (
          <div key={seat}>
            <div
              className={
                isOpenSeat
                  ? "seat-open-node"
                  : `seat-node seat-filled ${isTurn ? "seat-turn" : ""} ${isFolded ? "seat-folded" : ""} ${isHeroSeat ? "seat-hero" : ""} ${isAllIn ? "seat-all-in" : ""}`
              }
              style={{ top: seatLayout.top, left: seatLayout.left }}
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
                        style={getDealerNudgeStyle(seatLayout)}
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
                </>
              )}
            </div>
            {committedThisStreet > 0 ? (
              <div
                className={`bet-marker ${isTurn ? "bet-marker-turn" : ""}`}
                style={getBetMarkerPosition(seat)}
              >
                <span className="bet-marker-chip" />
                <span className="bet-marker-value">{committedThisStreet}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

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
        const seatRoleLabel = isDealer
          ? isSmallBlind
            ? "D/SB"
            : isBigBlind
              ? "D/BB"
              : "D"
          : isSmallBlind
            ? "SB"
            : isBigBlind
              ? "BB"
              : null;
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
                  <div className="seat-node-top">
                    <div className="seat-node-markers">
                      {isTurn ? <span className="turn-chip">ACT</span> : null}
                      {seatRoleLabel ? <span className="position-chip">{seatRoleLabel}</span> : null}
                    </div>
                  </div>
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
                  <div className="seat-node-name">{player.playerName}</div>
                  <div className="seat-node-meta">
                    <div className="seat-stack-badge">
                      <span className="seat-stack-main">{formatChipCount(stackValue)}</span>
                      {showBbStacks ? <span className="seat-stack-bb">{stackBbLabel} bb</span> : null}
                    </div>
                  </div>
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

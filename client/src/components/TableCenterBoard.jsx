export default function TableCenterBoard({
  potValue,
  potChipCount,
  showBbStacks,
  blindUnitValue,
  smallBlindValue,
  bigBlindValue,
  boardSlots,
  cardLabel,
  cardSuitClass,
}) {
  const safePotValue = Math.max(0, Number(potValue) || 0);
  const safeBigBlind = Math.max(1, Number(blindUnitValue) || 1);
  const safeSmallBlind = Math.max(1, Number(smallBlindValue) || Math.round(safeBigBlind / 2));
  const safeLevelBigBlind = Math.max(1, Number(bigBlindValue) || safeBigBlind);
  const potDisplay = showBbStacks
    ? `${new Intl.NumberFormat("en-US", {
        minimumFractionDigits: safePotValue % safeBigBlind === 0 ? 0 : 1,
        maximumFractionDigits: 2,
      }).format(safePotValue / safeBigBlind)} BB`
    : safePotValue;
  const blindDisplay = showBbStacks
    ? `${new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(safeSmallBlind / safeBigBlind)}/${new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(safeLevelBigBlind / safeBigBlind)} BB`
    : `${safeSmallBlind}/${safeLevelBigBlind}`;

  return (
    <div className="table-center">
      <div className="card-row board-row">
        {boardSlots.map((card, index) =>
          card ? (
            <span
              key={`${card}-${index}`}
              className={`poker-card board-card ${cardSuitClass(card)}`}
            >
              {cardLabel(card)}
            </span>
          ) : (
            <span key={`empty-${index}`} className="poker-card board-card poker-card-back">
              --
            </span>
          ),
        )}
      </div>
      <div className="table-center-head">
        <div className="pot-pill">Pot: {potDisplay}</div>
        <div className="pot-level-pill">Blinds: {blindDisplay}</div>
        {potChipCount > 0 ? (
          <div className="pot-chip-stack">
            {Array.from({ length: potChipCount }, (_, index) => (
              <span
                key={`pot-chip-${index}`}
                className="pot-chip"
                style={{
                  bottom: `${index * 4}px`,
                  left: `${50 + (index % 2 === 0 ? -7 : 7)}%`,
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

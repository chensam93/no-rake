export default function TableCenterBoard({
  potValue,
  potChipCount,
  boardSlots,
  cardLabel,
  cardSuitClass,
}) {
  return (
    <div className="table-center">
      <div className="table-center-head">
        <div className="pot-pill">Pot: {potValue}</div>
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
    </div>
  );
}

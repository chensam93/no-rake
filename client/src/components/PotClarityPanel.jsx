export default function PotClarityPanel({
  hasRound,
  localPlayer,
  localStackBehind,
  localToCall,
  localToCallDisplay,
  compactPotSummary,
  showAdvancedHandInfo,
  potDetailLines,
}) {
  return (
    <>
      <div className="table-action-essentials">
        {hasRound ? (
          <span>
            {localPlayer
              ? localStackBehind <= 0 && localToCall === 0
                ? "All-in: waiting runout"
                : `To call: ${localToCallDisplay}`
              : "You are not seated"}
          </span>
        ) : (
          <span>Waiting for next hand</span>
        )}
      </div>
      <div className="pot-clarity-line">
        <span>{hasRound ? "Live pots" : "Last pots"}</span>
        <span>{compactPotSummary}</span>
      </div>
      {showAdvancedHandInfo && potDetailLines.length > 0 ? (
        <div className="pot-clarity-detail">
          {potDetailLines.map((line, index) => (
            <span key={`pot-breakdown-${index}`}>{line}</span>
          ))}
        </div>
      ) : null}
    </>
  );
}

export default function HandStatusPanel({
  statusLabel,
  lastActionSummary,
  nextActionSummary,
  showResultLine,
  winnerSummary,
  winningHandLabel,
}) {
  return (
    <>
      <div className="table-action-status">{statusLabel}</div>
      <div className="hand-flow-banner">
        <span className="hand-flow-label">Last</span>
        <span>{lastActionSummary}</span>
      </div>
      <div className="hand-flow-banner hand-flow-banner-next">
        <span className="hand-flow-label">Next</span>
        <span>{nextActionSummary}</span>
      </div>
      {showResultLine ? (
        <div className="hand-result-line">
          <span>{winnerSummary || "Hand ended"}</span>
          {winningHandLabel ? <span>{winningHandLabel}</span> : null}
        </div>
      ) : null}
    </>
  );
}

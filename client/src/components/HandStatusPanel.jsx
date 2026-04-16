export default function HandStatusPanel({
  statusLabel,
  showResultLine,
  winnerSummary,
  winningHandLabel,
}) {
  return (
    <>
      {statusLabel ? <div className="table-action-status">{statusLabel}</div> : null}
      {showResultLine ? (
        <div className="hand-result-line">
          <span>{winnerSummary || "Hand ended"}</span>
          {winningHandLabel ? <span>{winningHandLabel}</span> : null}
        </div>
      ) : null}
    </>
  );
}

export default function HandContextPanel({
  showAdvancedHandInfo,
  localCanActSummary,
  localPlayer,
  localToCall,
  stackBehindDisplay,
  canRaiseAction,
  raiseMinTarget,
  currentBetDisplay,
  currentStreetActionsCount,
  hasRound,
  committedThisStreetDisplay,
  localPotOddsPercent,
  heroLastActionLabel,
}) {
  return (
    <>
      {showAdvancedHandInfo ? (
        <div className="table-action-context">
          <span>Status: {localCanActSummary}</span>
          <span>To call: {localPlayer ? localToCall : "-"}</span>
          <span>Stack behind: {localPlayer ? stackBehindDisplay : "-"}</span>
          <span>Min raise to: {canRaiseAction ? raiseMinTarget : "-"}</span>
          <span>Current bet: {currentBetDisplay}</span>
          <span>Street actions: {currentStreetActionsCount}</span>
        </div>
      ) : null}
      {showAdvancedHandInfo && hasRound && localPlayer ? (
        <div className="hero-investment-strip">
          <span>In this street: {committedThisStreetDisplay}</span>
          <span>Live stack: {stackBehindDisplay}</span>
          <span>Pot odds: {localToCall > 0 ? `${localPotOddsPercent}%` : "-"}</span>
          <span>Your last action: {heroLastActionLabel}</span>
        </div>
      ) : null}
    </>
  );
}

export default function ActionControlsPanel({
  canActNow,
  hasRound,
  canCheckAction,
  canCallAction,
  canFoldAction,
  canBetAction,
  canRaiseAction,
  showAmountControls,
  amount,
  localToCall,
  raiseMinTarget,
  raiseMaxTarget,
  raiseStep,
  localCommittedThisStreet,
  showPresetButtons,
  betPresetPercentages,
  showRaiseSlider,
  onAmountChange,
  onCheck,
  onCall,
  onFold,
  onBet,
  onRaiseClick,
  onTogglePresets,
  onApplyPreset,
  onEditPreset,
  onRaiseNudge,
  onSetHalfPotRaise,
  onSetPotRaise,
  onSetMinRaise,
  onSetAllIn,
  onRaiseSliderChange,
  onSubmitRaise,
  onCloseRaiseSlider,
}) {
  return (
    <>
      {canCheckAction || canCallAction || canFoldAction || showAmountControls ? (
        <div className="table-action-row table-action-primary-row">
          {canCheckAction ? (
            <button className="action-primary-button" onClick={onCheck}>
              Check
            </button>
          ) : null}
          {canCallAction ? (
            <button className="action-primary-button" onClick={onCall}>
              Call {localToCall}
            </button>
          ) : null}
          {canFoldAction ? <button onClick={onFold}>Fold</button> : null}
          {showAmountControls ? (
            <input
              className="table-action-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(event) => onAmountChange(Number(event.target.value || 1))}
            />
          ) : null}
          {canBetAction ? <button onClick={onBet}>Bet {amount}</button> : null}
          {canRaiseAction ? (
            <button onClick={onRaiseClick}>
              Raise to {Math.max(raiseMinTarget, Math.min(raiseMaxTarget, amount))}
            </button>
          ) : null}
          {showAmountControls ? (
            <button onClick={onTogglePresets}>Presets {showPresetButtons ? "▲" : "▼"}</button>
          ) : null}
        </div>
      ) : null}
      {showAmountControls && showPresetButtons ? (
        <div className="table-action-presets">
          {betPresetPercentages.length > 0 ? (
            betPresetPercentages.map((percent, index) => (
              <button
                key={`preset-${percent}`}
                className="preset-button"
                onClick={() => onApplyPreset(percent)}
              >
                <span>{percent}% pot</span>
                <span
                  className="preset-edit"
                  title="Edit preset"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onEditPreset(index);
                  }}
                >
                  ✎
                </span>
              </button>
            ))
          ) : (
            <span className="table-dev-note">Set preset percentages below</span>
          )}
        </div>
      ) : null}
      {!canActNow && hasRound ? <div className="table-dev-note">Waiting for your turn...</div> : null}
      {showRaiseSlider ? (
        <div className="raise-slider-panel">
          <div className="raise-slider-header">
            <span>Raise to: {amount}</span>
            <span>+{Math.max(0, amount - localCommittedThisStreet)} this action</span>
          </div>
          <div className="raise-slider-stepper">
            <button disabled={!canRaiseAction} onClick={() => onRaiseNudge(-1)}>
              -1bb
            </button>
            <button disabled={!canRaiseAction} onClick={() => onRaiseNudge(1)}>
              +1bb
            </button>
            <button disabled={!canRaiseAction} onClick={onSetHalfPotRaise}>
              1/2 pot
            </button>
            <button disabled={!canRaiseAction} onClick={onSetPotRaise}>
              Pot
            </button>
            <button disabled={!canRaiseAction} onClick={() => onRaiseNudge(5)}>
              +5bb
            </button>
            <button disabled={!canRaiseAction} onClick={onSetMinRaise}>
              Min
            </button>
            <button disabled={!canRaiseAction} onClick={onSetAllIn}>
              All-in
            </button>
          </div>
          <input
            className="raise-slider"
            type="range"
            min={raiseMinTarget}
            max={raiseMaxTarget}
            step={raiseStep}
            value={Math.max(raiseMinTarget, Math.min(raiseMaxTarget, amount))}
            list="raise-target-marks"
            onChange={(event) => onRaiseSliderChange(event.target.value)}
          />
          <datalist id="raise-target-marks">
            <option value={raiseMinTarget} />
            <option value={Math.round((raiseMinTarget * 2 + raiseMaxTarget) / 3)} />
            <option value={Math.round((raiseMinTarget + raiseMaxTarget * 2) / 3)} />
            <option value={raiseMaxTarget} />
          </datalist>
          <div className="raise-slider-marks">
            <span>{raiseMinTarget} min</span>
            <span>step {raiseStep}</span>
            <span>{Math.round((raiseMinTarget + raiseMaxTarget) / 2)}</span>
            <span>{raiseMaxTarget} max</span>
          </div>
          <div className="raise-slider-actions">
            <button disabled={!canRaiseAction} onClick={onSubmitRaise}>
              Raise to {amount}
            </button>
            <button onClick={onCloseRaiseSlider}>Close</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

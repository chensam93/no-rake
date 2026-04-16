export default function ActionControlsPanel({
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
  localCommittedThisStreet,
  showPresetButtons,
  betPresetPercentages,
  showRaiseSlider,
  preflopRaiseUi,
  preflopRaiseTarget,
  preflopSizingHint,
  onAmountChange,
  onAmountInputKeyDown,
  onCheck,
  onCall,
  onFold,
  onRaiseClick,
  onTogglePresets,
  onOpenRaiseFineTune,
  onEditPreflopSizing,
  onApplyPreset,
  onEditPreset,
  onRaiseNudge,
  onSetHalfPotRaise,
  onSetPotRaise,
  onSetMinRaise,
  onSetAllIn,
  raiseSliderPosition,
  raiseQuarterAmount,
  raiseMiddleAmount,
  raiseThreeQuarterAmount,
  onRaiseSliderChange,
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
          {canRaiseAction && !preflopRaiseUi ? (
            <input
              className="table-action-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(event) => onAmountChange(Number(event.target.value || 1))}
              onKeyDown={onAmountInputKeyDown}
            />
          ) : null}
          {canBetAction ? (
            <button className="action-primary-button" onClick={onTogglePresets}>
              {showPresetButtons ? "Cancel bet" : "Bet"}
            </button>
          ) : null}
          {canRaiseAction && preflopRaiseUi ? (
            <div className="preflop-raise-group">
              <button
                type="button"
                className={`action-raise-button action-primary-button ${showRaiseSlider ? "action-raise-confirm" : ""}`}
                onClick={onRaiseClick}
                aria-label={
                  showRaiseSlider
                    ? `Confirm raise to ${Math.max(raiseMinTarget, Math.min(raiseMaxTarget, amount))}`
                    : `Raise to ${preflopRaiseTarget} (${preflopSizingHint})`
                }
              >
                {showRaiseSlider
                  ? `Raise to ${Math.max(raiseMinTarget, Math.min(raiseMaxTarget, amount))}`
                  : `Raise to ${preflopRaiseTarget}`}
              </button>
              {!showRaiseSlider ? (
                <button
                  type="button"
                  className="preflop-preset-edit"
                  title="Edit open-raise size (× big blind). Typical online open is about 2–3×."
                  aria-label="Edit preflop open-raise multiplier"
                  onClick={(event) => {
                    event.preventDefault();
                    onEditPreflopSizing();
                  }}
                >
                  ✎
                </button>
              ) : null}
            </div>
          ) : null}
          {canRaiseAction && !preflopRaiseUi ? (
            <button
              className={`action-raise-button ${showRaiseSlider ? "action-primary-button action-raise-confirm" : ""}`}
              onClick={onRaiseClick}
              aria-label={showRaiseSlider ? `Confirm raise to ${amount}` : `Raise to ${amount}`}
            >
              Raise to {Math.max(raiseMinTarget, Math.min(raiseMaxTarget, amount))}
            </button>
          ) : null}
          {canRaiseAction ? (
            <button
              className="action-sizes-button"
              type="button"
              onClick={preflopRaiseUi ? onOpenRaiseFineTune : onTogglePresets}
            >
              {preflopRaiseUi ? "More" : `Sizes ${showPresetButtons ? "▲" : "▼"}`}
            </button>
          ) : null}
        </div>
      ) : null}
      {(canBetAction || canRaiseAction) && showPresetButtons && !preflopRaiseUi ? (
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
      {showRaiseSlider ? (
        <div className="raise-slider-panel">
          <div className="raise-slider-header">
            <span>Raise {amount}</span>
            <span>+{Math.max(0, amount - localCommittedThisStreet)}</span>
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
            min={0}
            max={100}
            step={1}
            value={Math.max(0, Math.min(100, Math.round(raiseSliderPosition ?? 0)))}
            list="raise-target-marks"
            onChange={(event) => onRaiseSliderChange(event.target.value)}
          />
          <datalist id="raise-target-marks">
            <option value={0} />
            <option value={25} />
            <option value={50} />
            <option value={75} />
            <option value={100} />
          </datalist>
          <div className="raise-slider-marks">
            <span>{raiseMinTarget} min</span>
            <span>{raiseQuarterAmount}</span>
            <span>{raiseMiddleAmount}</span>
            <span>{raiseThreeQuarterAmount}</span>
            <span>{raiseMaxTarget} max</span>
          </div>
          <div className="raise-slider-actions">
            <button onClick={onCloseRaiseSlider}>Close</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

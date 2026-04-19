export default function ActionControlsPanel({
  canActNow,
  canCheckAction,
  canCallAction,
  canFoldAction,
  canBetAction,
  canRaiseAction,
  showAmountControls,
  localToCall,
  betPresetPercentages,
  actionDrawerMode,
  preflopRaiseUi,
  preflopRaiseTarget,
  blindUnitValue,
  showBbStacks,
  onCheck,
  onCall,
  onFold,
  onPreflopRaiseDefault,
  onPreflopEditDefault,
  onRaiseOpenSizing,
  onSetDrawerMode,
  onApplyPreset,
  onEditPreset,
  onCloseDrawer,
}) {
  const safeBigBlind = Math.max(1, Number(blindUnitValue) || 1);
  const formatBbValue = (chipAmount) => {
    const bb = Math.max(0, Number(chipAmount) || 0) / safeBigBlind;
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: bb % 1 === 0 ? 0 : 1,
      maximumFractionDigits: 2,
    }).format(bb);
  };
  const formatAmountDisplay = (chipAmount) =>
    showBbStacks ? `${formatBbValue(chipAmount)} BB` : chipAmount;
  const drawerHasSlider = actionDrawerMode === "slider" || actionDrawerMode === "quick";
  const drawerHasPresets = actionDrawerMode === "presets";
  const canUseDrawerModes = showAmountControls;
  const showCheckOrCall = canCheckAction || canCallAction || canActNow;
  const showRaiseOrBet = canRaiseAction || canBetAction || canActNow;
  const showFold = canFoldAction || canActNow;
  const showPrimaryRow = showCheckOrCall || showRaiseOrBet || showFold;

  const toggleDrawerMode = (nextMode) => {
    if (!canUseDrawerModes) return;
    if (typeof onSetDrawerMode !== "function") return;
    onSetDrawerMode((previousMode) => (previousMode === nextMode ? "closed" : nextMode));
  };

  return (
    <>
      {showPrimaryRow && !drawerHasSlider ? (
        <div
          className={`table-action-row table-action-primary-row${
            preflopRaiseUi && canRaiseAction ? " table-action-primary-row--preflop" : ""
          }`}
        >
          {showCheckOrCall ? (
            <button
              className="action-primary-button action-primary-button-neutral"
              onClick={canCallAction ? onCall : onCheck}
              disabled={!canCheckAction && !canCallAction}
            >
              {canCallAction ? `Call ${formatAmountDisplay(localToCall)}` : "Check"}
            </button>
          ) : null}
          {showRaiseOrBet ? (
            preflopRaiseUi && canRaiseAction ? (
              <>
                <div className="preflop-default-row">
                  <button
                    type="button"
                    className="action-primary-button action-primary-button-raise action-preflop-default"
                    onClick={onPreflopRaiseDefault}
                    aria-label={`Raise default to ${formatBbValue(preflopRaiseTarget)} big blinds`}
                  >
                    <span className="preflop-default-title">Raise default</span>
                    <span className="preflop-default-size">{formatBbValue(preflopRaiseTarget)} BB</span>
                  </button>
                  <button
                    type="button"
                    className="preflop-default-edit"
                    onClick={onPreflopEditDefault}
                    aria-label="Edit default raise size"
                    title="Edit default raise size"
                  >
                    <span className="preflop-default-edit-glyph" aria-hidden="true">
                      {"\u270E"}
                    </span>
                  </button>
                </div>
                <button
                  type="button"
                  className="action-primary-button action-preflop-custom"
                  onClick={onRaiseOpenSizing}
                  aria-label="Raise to a custom size"
                >
                  Raise to…
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`action-primary-button action-primary-button-raise ${
                  drawerHasPresets ? "action-mode-active" : ""
                }`}
                onClick={canRaiseAction ? onRaiseOpenSizing : () => toggleDrawerMode("presets")}
                disabled={!canRaiseAction && !canBetAction}
              >
                {canBetAction ? "Bet" : "Raise"}
              </button>
            )
          ) : null}
          {showFold ? (
            <button
              type="button"
              className="action-primary-button action-primary-button-fold"
              onClick={onFold}
              disabled={!canFoldAction}
            >
              Fold
            </button>
          ) : null}
        </div>
      ) : null}
      <div className={`action-drawer-shell ${drawerHasPresets ? "action-drawer-shell-open" : ""}`}>
        <div className="action-drawer-panel">
          {drawerHasPresets ? (
            <div className="raise-slider-panel">
              {canBetAction ? (
                <div className="table-action-presets">
                  {betPresetPercentages.length > 0 ? (
                    betPresetPercentages.map((percent, index) => (
                      <button
                        key={`preset-${percent}`}
                        type="button"
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
                          {"\u270E"}
                        </span>
                      </button>
                    ))
                  ) : (
                    <span className="table-dev-note">Set preset percentages below</span>
                  )}
                </div>
              ) : null}
              <div className="raise-slider-actions">
                <button type="button" onClick={onCloseDrawer}>
                  Back
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

import { useState } from "react";

export function usePlayerActionController({
  initialAmount,
  initialBetPresetText,
  initialPreflopOpenBbMultiple,
  parseBetPresetPercentages,
  blindUnitValue,
  round,
  localPlayer,
  raiseMaxTarget,
  raiseMinTarget,
  canBetAction,
  canRaiseAction,
  preflopRaiseUi,
  preflopRaiseTarget,
  sendJson,
  appendEvent,
  playUiCue,
}) {
  const [amount, setAmount] = useState(initialAmount);
  const [showRaiseSlider, setShowRaiseSlider] = useState(false);
  const [showPresetButtons, setShowPresetButtons] = useState(false);
  const [betPresetText, setBetPresetText] = useState(initialBetPresetText);
  const [preflopOpenBbMultiple, setPreflopOpenBbMultiple] = useState(initialPreflopOpenBbMultiple);

  const closeActionPanels = () => {
    setShowRaiseSlider(false);
    setShowPresetButtons(false);
  };

  const submitCheck = () => {
    closeActionPanels();
    sendJson({ type: "player_action", actionType: "check" }, "player_action:check");
    playUiCue("action");
  };
  const submitCall = () => {
    closeActionPanels();
    sendJson({ type: "player_action", actionType: "call" }, "player_action:call");
    playUiCue("action");
  };
  const submitFold = () => {
    closeActionPanels();
    sendJson({ type: "player_action", actionType: "fold" }, "player_action:fold");
    playUiCue("action");
  };
  const submitBet = () => {
    closeActionPanels();
    sendJson(
      { type: "player_action", actionType: "bet", amount },
      "player_action:bet",
    );
    playUiCue("action");
  };

  const applyBetPreset = (percent) => {
    const pot = Math.max(1, Number(round.pot ?? 0));
    const currentBet = Number(round.currentBet ?? 0);
    let nextAmount = Math.max(1, Math.round((pot * percent) / 100));
    if (currentBet > 0 && nextAmount <= currentBet) {
      nextAmount = currentBet + Math.max(1, Math.round(blindUnitValue / 2));
    }
    if (currentBet > 0 && localPlayer) {
      nextAmount = Math.min(raiseMaxTarget, Math.max(raiseMinTarget, nextAmount));
      setShowRaiseSlider(true);
    }
    setAmount(nextAmount);
    if (canBetAction) {
      sendJson(
        { type: "player_action", actionType: "bet", amount: nextAmount },
        "player_action:bet",
      );
      playUiCue("action");
      setShowPresetButtons(false);
    }
  };

  const handlePreflopFineTuneOpen = () => {
    if (!preflopRaiseUi || preflopRaiseTarget === null) return;
    setAmount(preflopRaiseTarget);
    setShowRaiseSlider(true);
    setShowPresetButtons(false);
  };

  const editPreflopOpenBbMultiple = () => {
    const raw = window.prompt(
      "Open-raise size: multiple of the big blind (typical online default is about 2.5–3×).",
      String(preflopOpenBbMultiple),
    );
    if (raw === null) return;
    const next = Number(String(raw).trim());
    if (!Number.isFinite(next) || next < 1.5 || next > 6) {
      appendEvent("[local] preflop open multiplier ignored: use 1.5–6");
      return;
    }
    const rounded = Math.round(next * 20) / 20;
    setPreflopOpenBbMultiple(rounded);
  };

  const editBetPresetAtIndex = (index) => {
    const currentPresets = parseBetPresetPercentages(betPresetText);
    if (index < 0 || index >= currentPresets.length) return;

    const currentValue = currentPresets[index];
    const rawInput = window.prompt("Edit preset % (1-500)", String(currentValue));
    if (rawInput === null) return;

    const nextValue = Number(rawInput.trim());
    if (!Number.isFinite(nextValue) || nextValue <= 0 || nextValue > 500) {
      appendEvent("[local] preset edit ignored: value must be 1-500");
      return;
    }

    const normalized = Math.round(nextValue * 10) / 10;
    currentPresets[index] = normalized;
    setBetPresetText(currentPresets.join(","));
  };

  const handleRaiseClick = () => {
    if (!canRaiseAction) return;
    if (preflopRaiseUi && preflopRaiseTarget !== null) {
      if (showRaiseSlider) {
        const clampedAmount = Math.max(raiseMinTarget, Math.min(raiseMaxTarget, Math.round(amount)));
        sendJson(
          { type: "player_action", actionType: "raise_to", amount: clampedAmount },
          "player_action:raise_to",
        );
        playUiCue("action");
        setShowRaiseSlider(false);
        setShowPresetButtons(false);
        return;
      }
      sendJson(
        { type: "player_action", actionType: "raise_to", amount: preflopRaiseTarget },
        "player_action:raise_to",
      );
      playUiCue("action");
      return;
    }
    const clampedAmount = Math.max(raiseMinTarget, Math.min(raiseMaxTarget, Math.round(amount)));
    if (showRaiseSlider) {
      sendJson(
        { type: "player_action", actionType: "raise_to", amount: clampedAmount },
        "player_action:raise_to",
      );
      playUiCue("action");
      setShowRaiseSlider(false);
      setShowPresetButtons(false);
      return;
    }
    if (clampedAmount !== amount) {
      setAmount(clampedAmount);
    }
    setShowRaiseSlider(true);
  };

  const handleRaiseSliderChange = (value, getRaiseAmountFromSliderPosition, raiseStep) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const nextAmount = getRaiseAmountFromSliderPosition(
      parsed,
      raiseMinTarget,
      raiseMaxTarget,
      raiseStep,
    );
    setAmount(nextAmount);
  };

  const handleRaiseNudge = (stepCount, raiseStep) => {
    if (!canRaiseAction) return;
    setAmount((previous) => {
      const baseValue = Number(previous);
      const safeCurrent = Number.isFinite(baseValue) ? baseValue : raiseMinTarget;
      const nextValue = safeCurrent + stepCount * raiseStep;
      return Math.max(raiseMinTarget, Math.min(raiseMaxTarget, Math.round(nextValue)));
    });
  };

  return {
    amount,
    setAmount,
    showRaiseSlider,
    setShowRaiseSlider,
    showPresetButtons,
    setShowPresetButtons,
    betPresetText,
    setBetPresetText,
    preflopOpenBbMultiple,
    setPreflopOpenBbMultiple,
    submitCheck,
    submitCall,
    submitFold,
    submitBet,
    applyBetPreset,
    handlePreflopFineTuneOpen,
    editPreflopOpenBbMultiple,
    editBetPresetAtIndex,
    handleRaiseClick,
    handleRaiseSliderChange,
    handleRaiseNudge,
  };
}

import { useEffect, useLayoutEffect, useRef } from "react";

export function useTableHotkeys(hotkeysPayload) {
  const tableHotkeysRef = useRef({});

  useEffect(() => {
    const onTableHotkey = (event) => {
      const targetElement = event.target;
      const tagName =
        targetElement && typeof targetElement.tagName === "string"
          ? targetElement.tagName.toLowerCase()
          : "";
      const isTypingTarget =
        tagName === "input" ||
        tagName === "textarea" ||
        targetElement?.isContentEditable === true;
      if (isTypingTarget) return;

      const h = tableHotkeysRef.current;
      if (!h) return;

      if (event.code === "Space" && h.botActionMode === "step") {
        const stepDecision = h.getBotDecision(h.roomState);
        if (stepDecision) {
          event.preventDefault();
          h.runBotStep();
          return;
        }
      }

      if (!h.isLocalTurn) return;

      if (event.code === "Space" && h.canCheckAction) {
        event.preventDefault();
        h.submitCheck();
        return;
      }
      if (event.code === "KeyC" && h.canCheckAction) {
        event.preventDefault();
        h.submitCheck();
        return;
      }
      if (event.code === "KeyF" && h.canFoldAction) {
        event.preventDefault();
        h.submitFold();
        return;
      }
      if (event.code === "KeyL" && h.canCallAction) {
        event.preventDefault();
        h.submitCall();
        return;
      }
      if (event.code === "KeyR" && h.canRaiseAction) {
        event.preventDefault();
        h.handleRaiseClick();
        return;
      }
      if (event.code === "KeyB" && h.canBetAction) {
        event.preventDefault();
        h.setShowPresetButtons((previous) => !previous);
      }
    };
    window.addEventListener("keydown", onTableHotkey);
    return () => {
      window.removeEventListener("keydown", onTableHotkey);
    };
  }, []);

  useLayoutEffect(() => {
    tableHotkeysRef.current = hotkeysPayload;
  });
}

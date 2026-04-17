import { useCallback, useEffect, useRef, useState } from "react";

export function useAudioCues({
  storageKey,
  readStoredSfxEnabled,
  connectionState,
  hasRound,
  isLocalTurn,
  turnSeatNumber,
  lastEndReason,
}) {
  const audioContextRef = useRef(null);
  const previousTurnSeatRef = useRef(null);
  const previousConnectionStateRef = useRef(null);
  const previousLastEndReasonRef = useRef(null);
  const soundEnabledRef = useRef(readStoredSfxEnabled());
  const [soundEnabled, setSoundEnabled] = useState(readStoredSfxEnabled);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    try {
      localStorage.setItem(storageKey, soundEnabled ? "1" : "0");
    } catch {
      // ignore storage failures
    }
  }, [soundEnabled, storageKey]);

  const playUiCue = useCallback((cueType) => {
    if (!soundEnabledRef.current) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }
    const context = audioContextRef.current;
    if (!context) return;
    if (context.state === "suspended") {
      void context.resume().catch(() => {});
    }

    const playTone = ({ frequency, durationMs, gain, type = "sine", offsetMs = 0 }) => {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      const startAt = context.currentTime + offsetMs / 1000;
      const endAt = startAt + durationMs / 1000;

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), startAt + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt);

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(endAt);
    };

    try {
      if (cueType === "action") {
        playTone({ frequency: 740, durationMs: 65, gain: 0.028, type: "triangle" });
        return;
      }
      if (cueType === "turn") {
        playTone({ frequency: 660, durationMs: 70, gain: 0.024, type: "triangle" });
        playTone({ frequency: 988, durationMs: 80, gain: 0.022, type: "triangle", offsetMs: 90 });
        return;
      }
      if (cueType === "round_end") {
        playTone({ frequency: 523, durationMs: 90, gain: 0.026, type: "sine" });
        playTone({ frequency: 659, durationMs: 120, gain: 0.022, type: "sine", offsetMs: 110 });
        return;
      }
      if (cueType === "error") {
        playTone({ frequency: 210, durationMs: 130, gain: 0.03, type: "sawtooth" });
        playTone({ frequency: 160, durationMs: 120, gain: 0.018, type: "sawtooth", offsetMs: 110 });
        return;
      }
      if (cueType === "connect") {
        playTone({ frequency: 440, durationMs: 60, gain: 0.02, type: "sine" });
        playTone({ frequency: 660, durationMs: 70, gain: 0.018, type: "sine", offsetMs: 70 });
      }
    } catch {
      // If sound generation fails, silently continue.
    }
  }, []);

  useEffect(() => {
    const previousConnectionState = previousConnectionStateRef.current;
    if (previousConnectionState && previousConnectionState !== connectionState) {
      if (connectionState === "open") {
        playUiCue("connect");
      } else if (
        previousConnectionState === "open" &&
        (connectionState === "closed" || connectionState === "error")
      ) {
        playUiCue("error");
      }
    }
    previousConnectionStateRef.current = connectionState;
  }, [connectionState, playUiCue]);

  useEffect(() => {
    if (!hasRound) {
      previousTurnSeatRef.current = null;
      return;
    }
    const previousTurnSeat = previousTurnSeatRef.current;
    const nextTurnSeat = turnSeatNumber ?? null;
    if (previousTurnSeat !== null && previousTurnSeat !== nextTurnSeat && isLocalTurn) {
      playUiCue("turn");
    }
    previousTurnSeatRef.current = nextTurnSeat;
  }, [hasRound, isLocalTurn, playUiCue, turnSeatNumber]);

  useEffect(() => {
    const previousLastEndReason = previousLastEndReasonRef.current;
    const currentLastEndReason = lastEndReason ?? null;
    if (!hasRound && currentLastEndReason && currentLastEndReason !== previousLastEndReason) {
      playUiCue("round_end");
    }
    previousLastEndReasonRef.current = currentLastEndReason;
  }, [hasRound, lastEndReason, playUiCue]);

  return {
    soundEnabled,
    setSoundEnabled,
    playUiCue,
  };
}

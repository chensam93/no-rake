import { useCallback, useEffect, useRef, useState } from "react";

export function useMainSocketLifecycle({
  wsUrl,
  appendEvent,
  clearPendingBotAutoAction,
  stopBot,
}) {
  const wsRef = useRef(null);
  const [connectionState, setConnectionState] = useState("connecting");
  const [roomState, setRoomState] = useState(null);
  const [lastServerError, setLastServerError] = useState(null);
  const [sendBlockedNotice, setSendBlockedNotice] = useState(null);
  const [mainSocketEpoch, setMainSocketEpoch] = useState(0);

  const reconnectMainSocket = useCallback(() => {
    setLastServerError(null);
    setSendBlockedNotice(null);
    setConnectionState("connecting");
    setMainSocketEpoch((epoch) => epoch + 1);
  }, []);

  const onMainSendBlocked = useCallback(() => {
    setSendBlockedNotice("Not connected — your action was not sent.");
  }, []);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState("open");
      setSendBlockedNotice(null);
      appendEvent("[local] websocket open");
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        setConnectionState("closed");
        wsRef.current = null;
      }
      appendEvent("[local] websocket closed");
    };

    ws.onerror = () => {
      if (wsRef.current === ws) {
        setConnectionState("error");
      }
      appendEvent("[local] websocket error");
    };

    ws.onmessage = (event) => {
      appendEvent(`[in] ${event.data}`);

      let parsed;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      if (parsed.type === "room_state") {
        setRoomState(parsed);
      }

      if (parsed.type === "error" && typeof parsed.message === "string") {
        setLastServerError({
          message: parsed.message,
        });
      }
    };

    return () => {
      clearPendingBotAutoAction();
      ws.close();
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      stopBot();
    };
  }, [appendEvent, clearPendingBotAutoAction, mainSocketEpoch, stopBot, wsUrl]);

  return {
    wsRef,
    connectionState,
    roomState,
    setRoomState,
    lastServerError,
    setLastServerError,
    sendBlockedNotice,
    setSendBlockedNotice,
    onMainSendBlocked,
    reconnectMainSocket,
  };
}

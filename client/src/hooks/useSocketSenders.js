import { useCallback } from "react";

export function useSocketSenders(wsRef, botWsRef, appendEvent, onMainSendBlocked) {
  const sendJson = useCallback(
    (payload, label) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        const readyState = ws ? ws.readyState : "null";
        appendEvent(`[local] blocked: websocket not open (readyState=${readyState})`);
        if (typeof onMainSendBlocked === "function") {
          onMainSendBlocked();
        }
        return;
      }

      ws.send(JSON.stringify(payload));
      appendEvent(`[out] ${label}`);
    },
    [appendEvent, onMainSendBlocked, wsRef],
  );

  const sendBotJson = useCallback(
    (payload, label) => {
      const ws = botWsRef?.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        appendEvent("[bot] blocked: server bot control socket not open");
        return;
      }

      ws.send(JSON.stringify(payload));
      appendEvent(`[bot out] ${label}`);
    },
    [appendEvent, botWsRef],
  );

  return { sendJson, sendBotJson };
}

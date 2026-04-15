import { useCallback } from "react";

export function useSocketSenders(wsRef, botWsRef, appendEvent) {
  const sendJson = useCallback(
    (payload, label) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        const readyState = ws ? ws.readyState : "null";
        appendEvent(`[local] blocked: websocket not open (readyState=${readyState})`);
        return;
      }

      ws.send(JSON.stringify(payload));
      appendEvent(`[out] ${label}`);
    },
    [appendEvent, wsRef],
  );

  const sendBotJson = useCallback(
    (payload, label) => {
      const ws = botWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        appendEvent("[bot] blocked: websocket not open");
        return;
      }

      ws.send(JSON.stringify(payload));
      appendEvent(`[bot out] ${label}`);
    },
    [appendEvent, botWsRef],
  );

  return { sendJson, sendBotJson };
}

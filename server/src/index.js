import websocket from "@fastify/websocket";
import Fastify from "fastify";

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT) || 3000;

await app.register(websocket);

app.get("/health", async () => ({ ok: true }));

app.get("/", async () => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>No Rake - WS smoke page</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
      pre { background: #f5f5f5; padding: 0.75rem; border-radius: 6px; min-height: 8rem; }
      button { padding: 0.5rem 0.75rem; }
      code { background: #f0f0f0; padding: 0.1rem 0.25rem; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>No Rake</h1>
    <p>Step 4 browser smoke test for WebSockets.</p>
    <p>Socket URL: <code>ws://127.0.0.1:${PORT}/ws</code></p>
    <button id="send">Send ping</button>
    <pre id="log">waiting...</pre>
    <script>
      const log = document.getElementById("log");
      const ws = new WebSocket("ws://127.0.0.1:${PORT}/ws");
      const line = (msg) => {
        log.textContent = log.textContent === "waiting..." ? msg : log.textContent + "\\n" + msg;
      };
      ws.onopen = () => line("[open]");
      ws.onmessage = (ev) => line("[in] " + ev.data);
      ws.onclose = () => line("[close]");
      ws.onerror = () => line("[error]");
      document.getElementById("send").onclick = () => {
        ws.send("ping-" + Date.now());
        line("[out] ping");
      };
    </script>
  </body>
</html>`);

app.get("/ws", { websocket: true }, (socket) => {
  socket.send(JSON.stringify({ type: "hello", message: "no-rake" }));

  socket.on("message", (raw) => {
    const text = typeof raw === "string" ? raw : raw.toString();
    socket.send(JSON.stringify({ type: "echo", body: text }));
  });
});

await app.listen({ port: PORT, host: "0.0.0.0" });

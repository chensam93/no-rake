import websocket from "@fastify/websocket";
import Fastify from "fastify";

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT) || 3000;

await app.register(websocket);

app.get("/health", async () => ({ ok: true }));

app.get("/ws", { websocket: true }, (socket) => {
  socket.send(JSON.stringify({ type: "hello", message: "no-rake" }));

  socket.on("message", (raw) => {
    const text = typeof raw === "string" ? raw : raw.toString();
    socket.send(JSON.stringify({ type: "echo", body: text }));
  });
});

await app.listen({ port: PORT, host: "0.0.0.0" });

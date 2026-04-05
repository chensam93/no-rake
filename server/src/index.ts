import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { RawData } from "ws";

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = Fastify({ logger: true });

await app.register(cors, { origin: CLIENT_ORIGIN });
await app.register(websocket);

app.get("/health", async () => ({ ok: true }));

app.get("/ws", { websocket: true }, (socket) => {
  socket.send(
    JSON.stringify({ type: "hello", message: "no-rake server" }),
  );

  socket.on("message", (raw: RawData) => {
    const text = raw.toString();
    socket.send(JSON.stringify({ type: "echo", body: text }));
  });
});

await app.listen({ port: PORT, host: "0.0.0.0" });

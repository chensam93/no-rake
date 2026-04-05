import Fastify from "fastify";

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT) || 3000;

app.get("/health", async () => ({ ok: true }));

await app.listen({ port: PORT, host: "0.0.0.0" });

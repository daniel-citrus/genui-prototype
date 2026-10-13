import Fastify, { type FastifyError } from "fastify";
import { agentAvailable, config } from "./config";
import { healthRouter } from "./routes/health";

const app = Fastify({
  logger: { level: config.logLevel },
});

// Accept empty JSON bodies (some POSTs carry nothing).
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_req, body, done) => {
    if (!body || (typeof body === "string" && body.trim() === "")) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  },
);

app.setErrorHandler((err: FastifyError, req, reply) => {
  // Fastify validation / parse errors carry a statusCode.
  const status = typeof err.statusCode === "number" ? err.statusCode : 500;
  if (status >= 500) req.log.error({ err }, "unhandled error");
  return reply.status(status).send({
    error: {
      code: "repository",
      message: status >= 500 ? "Internal server error" : err.message,
    },
  });
});

app.register(healthRouter, { prefix: "/api/health" });

const address = await app.listen({ port: config.apiPort, host: config.apiHost });
app.log.info(`agent: ${agentAvailable ? `openai (${config.openai.model})` : "offline"}`);
app.log.info(`ready on ${address}`);

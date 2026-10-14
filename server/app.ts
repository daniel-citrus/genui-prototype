import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { ToolRegistry } from "./agent/tools";
import type { AgentLlm } from "./ports/AgentLlm";
import { agentRouter } from "./routes/agent";
import { healthRouter } from "./routes/health";

export interface AppDeps {
  /** Pino level; omit to disable logging (tests). */
  logLevel?: string;
  llm?: AgentLlm;
  tools: ToolRegistry;
  pingDb?: () => Promise<boolean>;
}

/** Builds the API's Fastify app: parser, error handler and routes. Doesn't listen. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logLevel ? { level: deps.logLevel } : false,
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
        // A bad body is the client's fault, not a 500.
        done(Object.assign(err as Error, { statusCode: 400 }), undefined);
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

  app.register(healthRouter, { prefix: "/api/health", pingDb: deps.pingDb });
  app.register(agentRouter, { prefix: "/api/agent", llm: deps.llm, tools: deps.tools });

  return app;
}

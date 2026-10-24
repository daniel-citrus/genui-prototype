import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { createActionRegistry } from "./actions/registry";
import type { ActionRegistry } from "./actions/types";
import type { ToolRegistry } from "./agent/tools";
import type { AgentLlm } from "./ports/AgentLlm";
import type { ComponentRepository } from "./ports/ComponentRepository";
import type { CustomComponentRepository } from "./ports/CustomComponentRepository";
import type { TraceRepository } from "./ports/TraceRepository";
import { registerRateLimit, type ChatRateLimitOptions } from "./rateLimit";
import { actionsRouter } from "./routes/actions";
import { agentRouter } from "./routes/agent";
import { customComponentsRouter } from "./routes/customComponents";
import { healthRouter } from "./routes/health";

export interface AppDeps {
  /** Pino level; omit to disable logging (tests). */
  logLevel?: string;
  llm?: AgentLlm;
  tools: ToolRegistry;
  /** What a Button click may run; omit for none. */
  actions?: ActionRegistry;
  pingDb?: () => Promise<boolean>;
  pingTraces?: () => Promise<boolean>;
  /** Number of proxy hops to trust for the client IP; default false. */
  trustProxy?: number | false;
  rateLimit: ChatRateLimitOptions;
  /** Shared rate-limit store; closed with the app. Omit to count in memory. */
  /** Where log lines go when `logLevel` is set; default stdout. Tests capture them here. */
  logStream?: { write(line: string): void };
  /** Custom components for the Components panel; its route needs `components` too. */
  customComponents?: CustomComponentRepository;
  /** The catalog custom component previews are expanded into. */
  components?: ComponentRepository;
  traces: TraceRepository;
}

/**
 * Fastify fails closed on a numeric trustProxy, so trust the last `hops` hops
 * with a function. Only safe when the API is reachable through the proxy alone.
 */
function trustHops(hops: number | false): boolean | ((addr: string, hop: number) => boolean) {
  return hops === false ? false : (_addr, hop) => hop < hops;
}

/** Builds the API's Fastify app: parser, error handler and routes. Doesn't listen. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logLevel ? { level: deps.logLevel, stream: deps.logStream } : false,
    trustProxy: trustHops(deps.trustProxy ?? false),
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

  await registerRateLimit(app, deps.rateLimit);

  app.register(healthRouter, {
    prefix: "/api/health",
    pingDb: deps.pingDb,
    pingTraces: deps.pingTraces,
  });
  app.register(agentRouter, {
    prefix: "/api/agent",
    llm: deps.llm,
    tools: deps.tools,
    traces: deps.traces,
  });
  app.register(actionsRouter, {
    prefix: "/api/actions",
    actions: deps.actions ?? createActionRegistry([]),
  });
  if (deps.customComponents && deps.components) {
    app.register(customComponentsRouter, {
      prefix: "/api/custom-components",
      customComponents: deps.customComponents,
      components: deps.components,
    });
  }

  return app;
}

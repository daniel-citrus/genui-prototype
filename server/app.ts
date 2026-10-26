import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { createActionRegistry } from "./actions/registry";
import type { ActionRegistry } from "./actions/types";
import { createDesignStore, type DesignStore } from "./designs";
import type { ComponentLlm } from "./ports/ComponentLlm";
import type { ComponentRepository } from "./ports/ComponentRepository";
import type { CustomComponentRepository } from "./ports/CustomComponentRepository";
import { registerRateLimit, type ChatRateLimitOptions } from "./rateLimit";
import { actionsRouter } from "./routes/actions";
import { customComponentsRouter } from "./routes/customComponents";
import { generateRouter } from "./routes/generate";
import { healthRouter } from "./routes/health";

/** Designs kept for actions to look up; the oldest is dropped past this. */
export const MAX_DESIGNS = 500;

export interface AppDeps {
  /** Pino level; omit to disable logging (tests). */
  logLevel?: string;
  /** The model behind `POST /api/generate`; omit and it answers 503. */
  componentLlm?: ComponentLlm;
  /** How long a generation may take; default `GENERATE_TIMEOUT_MS`. */
  generateTimeoutMs?: number;
  /** Where generated and shown designs are remembered; default holds `MAX_DESIGNS`. */
  designs?: DesignStore;
  /** What a Button click may run; omit for none. */
  actions?: ActionRegistry;
  pingDb?: () => Promise<boolean>;
  /** Number of proxy hops to trust for the client IP; default false. */
  trustProxy?: number | false;
  rateLimit: ChatRateLimitOptions;
  /** Where log lines go when `logLevel` is set; default stdout. Tests capture them here. */
  logStream?: { write(line: string): void };
  /** Custom components for the Components panel; its route needs `components` too. */
  customComponents?: CustomComponentRepository;
  /** The catalog custom component previews are expanded into. */
  components?: ComponentRepository;
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

  const designs = deps.designs ?? createDesignStore({ max: MAX_DESIGNS });
  const actions = deps.actions ?? createActionRegistry([]);

  app.register(healthRouter, {
    prefix: "/api/health",
    pingDb: deps.pingDb,
  });
  app.register(actionsRouter, {
    prefix: "/api/actions",
    actions,
    designs,
  });
  app.register(generateRouter, {
    prefix: "/api/generate",
    llm: deps.componentLlm,
    components: deps.components,
    customComponents: deps.customComponents,
    actions,
    designs,
    timeoutMs: deps.generateTimeoutMs,
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

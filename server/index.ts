import Fastify, { type FastifyError } from "fastify";
import { agentAvailable, config } from "./config";
import { createDb } from "./adapters/db/client";
import { DrizzleComponentRepository } from "./adapters/db/DrizzleComponentRepository";
import { runMigrations } from "./adapters/db/migrate";
import { seedComponents } from "./adapters/db/seed";
import { createOpenAILlm } from "./adapters/openai/OpenAILlm";
import { SYSTEM_PROMPT } from "./agent/loop";
import { catalog } from "./catalog/components";
import { emptyToolRegistry } from "./agent/tools";
import type { ComponentRepository } from "./ports/ComponentRepository";
import { agentRouter } from "./routes/agent";
import { healthRouter } from "./routes/health";

declare module "fastify" {
  interface FastifyInstance {
    components: ComponentRepository;
  }
}

/** Host (and port) of a connection URL, without credentials, for logs. */
function dbHost(url: string): string {
  try {
    return new URL(url).host || "unknown";
  } catch {
    return "unknown";
  }
}

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

// The only place real adapters are built.
const database = createDb(config.databaseUrl);
const components = new DrizzleComponentRepository(database.db);
app.decorate("components", components);
app.addHook("onClose", async () => {
  await database.close();
});

const llm = agentAvailable
  ? createOpenAILlm({
      apiKey: config.openai.apiKey,
      model: config.openai.model,
      systemPrompt: SYSTEM_PROMPT,
    })
  : undefined;

app.register(healthRouter, { prefix: "/api/health", pingDb: database.ping });
app.register(agentRouter, { prefix: "/api/agent", llm, tools: emptyToolRegistry });

// In production the schema and the component catalog are brought up to date on
// start; in development both stay manual (`npm run db:migrate`, `npm run db:seed`)
// and the API starts without Postgres.
if (process.env.NODE_ENV === "production") {
  const failStartup = async (err: unknown, what: string) => {
    app.log.error({ err }, `${what} failed (${dbHost(config.databaseUrl)})`);
    await database.close().catch(() => {});
    process.exit(1);
  };
  try {
    await runMigrations(database.db);
  } catch (err) {
    await failStartup(err, "database migration");
  }
  try {
    const c = await seedComponents(database.db, catalog);
    app.log.info(
      `components: ${c.added} added, ${c.updated} updated, ${c.removed} removed, ${c.unchanged} unchanged`,
    );
  } catch (err) {
    await failStartup(err, "component seed");
  }
}

const address = await app.listen({ port: config.apiPort, host: config.apiHost });
app.log.info(
  `ready on ${address}; agent: ${
    agentAvailable ? `openai (${config.openai.model})` : "not configured (set OPENAI_API_KEY)"
  }; database: ${dbHost(config.databaseUrl)}`,
);

// Close cleanly (runs onClose, which ends the Postgres pool) when stopped.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

import { agentAvailable, config } from "./config";
import { createDb } from "./adapters/db/client";
import { createTracesDb } from "./adapters/traces/client";
import { DrizzleTraceRepository } from "./adapters/traces/DrizzleTraceRepository";
import { ensureTracesDatabase } from "./adapters/traces/ensureDatabase";
import { runMigrations as runTracesMigrations } from "./adapters/traces/migrate";
import { DrizzleComponentRepository } from "./adapters/db/DrizzleComponentRepository";
import { DrizzleCustomComponentRepository } from "./adapters/db/DrizzleCustomComponentRepository";
import { runMigrations } from "./adapters/db/migrate";
import { seedComponents } from "./adapters/db/seed";
import { createOpenAILlm } from "./adapters/openai/OpenAILlm";
import { createInMemoryPosMenu } from "./adapters/pos/InMemoryPosMenu";
import { createActions } from "./actions/index";
import { createMenuActions } from "./actions/menu/index";
import { createActionRegistry } from "./actions/registry";
import { SYSTEM_PROMPT } from "./agent/systemPrompt";
import { catalog } from "./catalog/components";
import { createToolRegistry } from "./agent/registry";
import { createAgentTools } from "./agent/tools/index";
import type { ComponentRepository } from "./ports/ComponentRepository";
import { buildApp } from "./app";

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

// The only place real adapters are built.
const database = createDb(config.databaseUrl);
const tracesDatabase = createTracesDb(config.traceDatabaseUrl, config.databaseUrl);
const traces = new DrizzleTraceRepository(tracesDatabase.db);
const components = new DrizzleComponentRepository(database.db);
const customComponents = new DrizzleCustomComponentRepository(database.db);

const llm = agentAvailable
  ? createOpenAILlm({
      apiKey: config.openai.apiKey,
      model: config.openai.model,
      maxOutputTokens: config.openai.maxOutputTokens,
      systemPrompt: SYSTEM_PROMPT,
    })
  : undefined;

// The demo café menu: in memory, reset on every start, shared by every conversation.
const menu = createInMemoryPosMenu();

// What a Button in a rendered design may run.
const actions = createActionRegistry([...createActions(), ...createMenuActions(menu)]);

// Without Postgres the API still starts; each tool call then fails on its own.
const tools = createToolRegistry(
  createAgentTools({ components, actions: actions.specs, listChoices: actions.listChoices, customComponents }),
);

const app = await buildApp({
  logLevel: config.logLevel,
  llm,
  tools,
  actions,
  pingDb: database.ping,
  pingTraces: tracesDatabase.ping,
  trustProxy: config.trustProxy,
  rateLimit: { max: config.rateLimitPerMinute },
  customComponents,
  components,
  traces,
});
app.decorate("components", components);
app.addHook("onClose", async () => {
  await database.close();
  await tracesDatabase.close();
});

// In production the schema and the component catalog are brought up to date on
// start; in development both stay manual (`npm run db:migrate`, `npm run db:seed`)
// and the API starts without Postgres.
if (process.env.NODE_ENV === "production") {
  const failStartup = async (err: unknown, what: string) => {
    app.log.error({ err }, `${what} failed (${dbHost(config.databaseUrl)})`);
    await database.close().catch(() => {});
    await tracesDatabase.close().catch(() => {});
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
  try {
    await ensureTracesDatabase(config.databaseUrl);
  } catch (err) {
    await failStartup(err, "traces database ensure");
  }
  try {
    await runTracesMigrations(
      tracesDatabase.db,
      config.databaseUrl,
      config.traceDatabaseUrl,
    );
  } catch (err) {
    await failStartup(err, "traces database migration");
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

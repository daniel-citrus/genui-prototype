import { agentAvailable, config } from "./config";
import { createDb } from "./adapters/db/client";
import { DrizzleComponentRepository } from "./adapters/db/DrizzleComponentRepository";
import { DrizzleCustomComponentRepository } from "./adapters/db/DrizzleCustomComponentRepository";
import { runMigrations } from "./adapters/db/migrate";
import { seedComponents } from "./adapters/db/seed";
import { createOpenAIComponentLlm } from "./adapters/openai/OpenAIComponentLlm";
import { createInMemoryPosMenu } from "./adapters/pos/InMemoryPosMenu";
import { createActions } from "./actions/index";
import { createMenuActions } from "./actions/menu/index";
import { createActionRegistry } from "./actions/registry";
import { catalog } from "./catalog/components";
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
const components = new DrizzleComponentRepository(database.db);
const customComponents = new DrizzleCustomComponentRepository(database.db);

const componentLlm = agentAvailable
  ? createOpenAIComponentLlm({
      apiKey: config.openai.apiKey,
      model: config.openai.model,
      maxOutputTokens: config.openai.maxOutputTokens,
    })
  : undefined;

// The demo café menu: in memory, reset on every start, shared by every design.
const menu = createInMemoryPosMenu();

// What a Button in a rendered design may run.
const actions = createActionRegistry([...createActions(), ...createMenuActions(menu)]);

const app = await buildApp({
  logLevel: config.logLevel,
  componentLlm,
  actions,
  pingDb: database.ping,
  trustProxy: config.trustProxy,
  rateLimit: { max: config.rateLimitPerMinute },
  customComponents,
  components,
});
app.decorate("components", components);
app.addHook("onClose", async () => {
  await database.close();
});

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

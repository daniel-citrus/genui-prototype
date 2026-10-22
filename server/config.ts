/**
 * Server configuration, read from the environment once at startup. This is the
 * only file that reads secrets. Every value has a default except OPENAI_API_KEY.
 */

import { DEFAULT_MAX_OUTPUT_TOKENS } from "./agent/guardrails";

const env = process.env;

function port(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** TRUST_PROXY: a positive hop count, otherwise false. */
export function parseTrustProxy(value: string | undefined): number | false {
  const hops = port(value, 0);
  return hops > 0 ? hops : false;
}

/** Postgres database name from a connection URL pathname. */
export function databaseNameFromUrl(databaseUrl: string): string {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  if (!name) throw new Error("database URL must include a database name");
  return name;
}

/** Refuses when catalog and traces URLs target the same Postgres database. */
export function assertDistinctTraceDatabase(
  catalogDatabaseUrl: string,
  tracesDatabaseUrl: string,
): void {
  const catalog = databaseNameFromUrl(catalogDatabaseUrl);
  const traces = databaseNameFromUrl(tracesDatabaseUrl);
  if (catalog === traces) {
    throw new Error("DATABASE_URL and TRACE_DATABASE_URL must name different databases");
  }
}

export const config = {
  apiPort: port(env.API_PORT, 3001),
  apiHost: env.API_HOST || "127.0.0.1",
  openai: {
    apiKey: (env.OPENAI_API_KEY ?? "").trim(),
    model: env.AGENT_MODEL || "gpt-4.1",
    maxOutputTokens: port(env.AGENT_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS),
  },
  databaseUrl: env.DATABASE_URL || "postgres://genui:genui@localhost:5432/genui",
  traceDatabaseUrl:
    env.TRACE_DATABASE_URL || "postgres://genui:genui@localhost:5432/genui_traces",
  redisUrl: env.REDIS_URL || undefined,
  rateLimitPerMinute: port(env.AGENT_RATE_LIMIT_PER_MINUTE, 20),
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  logLevel: env.LOG_LEVEL || "info",
};

/** Whether the agent can run: it needs an OpenAI key. */
export const agentAvailable = config.openai.apiKey.length > 0;

/**
 * Server configuration, read from the environment once at startup. This is the
 * only file that reads secrets. Every value has a default except OPENAI_API_KEY.
 */

const env = process.env;

function port(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  apiPort: port(env.API_PORT, 3001),
  apiHost: env.API_HOST || "127.0.0.1",
  openai: {
    apiKey: (env.OPENAI_API_KEY ?? "").trim(),
    model: env.AGENT_MODEL || "gpt-4.1",
  },
  databaseUrl: env.DATABASE_URL || "postgres://genui:genui@localhost:5432/genui",
  logLevel: env.LOG_LEVEL || "info",
};

/** Whether the agent can run: it needs an OpenAI key. */
export const agentAvailable = config.openai.apiKey.length > 0;

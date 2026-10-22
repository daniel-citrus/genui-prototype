import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/adapters/traces/schema.ts",
  out: "./server/adapters/traces/migrations",
  dbCredentials: {
    url:
      process.env.TRACE_DATABASE_URL ??
      "postgres://genui:genui@localhost:5432/genui_traces",
  },
});

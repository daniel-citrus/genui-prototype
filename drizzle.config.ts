import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/adapters/db/schema.ts",
  out: "./server/adapters/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://genui:genui@localhost:5432/genui",
  },
});

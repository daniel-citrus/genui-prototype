// `npm run db:migrate:traces`: ensure the traces database exists, then drizzle-kit migrate.
import { assertDistinctTraceDatabase, config } from "../../config";
import { ensureTracesDatabase } from "./ensureDatabase";

try {
  assertDistinctTraceDatabase(config.databaseUrl, config.traceDatabaseUrl);
  await ensureTracesDatabase(config.databaseUrl);
} catch (err) {
  console.error("traces database ensure failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}

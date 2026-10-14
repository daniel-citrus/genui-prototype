// `npm run db:seed`: bring the components table in line with the catalog file.
import { config } from "../../config";
import { catalog } from "../../catalog/components";
import { createDb } from "./client";
import { seedComponents } from "./seed";

const database = createDb(config.databaseUrl);
try {
  const c = await seedComponents(database.db, catalog);
  console.log(
    `components: ${c.added} added, ${c.updated} updated, ${c.removed} removed, ${c.unchanged} unchanged`,
  );
} catch (err) {
  console.error("seed failed:", err instanceof Error && err.message ? err.message : err);
  process.exitCode = 1;
} finally {
  await database.close();
}

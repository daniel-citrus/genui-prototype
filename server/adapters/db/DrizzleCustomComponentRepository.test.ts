import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { catalog } from "../../catalog/components";
import { CustomComponentError } from "../../ports/CustomComponentRepository";
import {
  customComponentRepositoryCases,
  definition,
} from "../../ports/fakes/customComponentRepositoryCases";
import { createDb, type DbHandle } from "./client";
import { DrizzleCustomComponentRepository } from "./DrizzleCustomComponentRepository";
import { runMigrations } from "./migrate";
import { customComponents, customComponentVersions } from "./schema";
import { seedComponents } from "./seed";

const databaseUrl = process.env.DATABASE_URL;

// Empties the custom component tables before each case. Database test files
// share one database; `npm test` runs files one at a time (--test-concurrency=1).
describe(
  "DrizzleCustomComponentRepository",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    let handle: DbHandle;
    let repo: DrizzleCustomComponentRepository;

    const empty = async () => {
      await handle.db.delete(customComponentVersions);
      await handle.db.delete(customComponents);
    };

    before(async () => {
      handle = createDb(databaseUrl!);
      await runMigrations(handle.db);
      repo = new DrizzleCustomComponentRepository(handle.db);
    });

    after(async () => {
      await empty();
      await handle.close();
    });

    customComponentRepositoryCases(async () => {
      await empty();
      return repo;
    });

    it("rejects conflict when another transaction creates the same name meanwhile", async () => {
      await empty();
      const other = await handle.pool.connect();
      try {
        await other.query("begin");
        await other.query(
          "insert into custom_components (name, current_version) values ('MenuCard', 1)",
        );
        const saving = repo.save(definition("MenuCard"));
        // Commit once the save is waiting on the uncommitted row.
        while (
          (
            await handle.pool.query(
              "select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
            )
          ).rowCount === 0
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await other.query("commit");
        await assert.rejects(saving, (err) => {
          assert.ok(err instanceof CustomComponentError);
          assert.equal(err.code, "conflict");
          assert.equal(err.message, '"MenuCard" changed while saving, try again.');
          return true;
        });
      } finally {
        other.release();
      }
    });

    it("rejects categories and children outside the allowed values", async () => {
      await empty();
      const isCheckViolation = (err: unknown) => {
        const e = err as { code?: unknown; cause?: { code?: unknown } };
        return e.code === "23514" || e.cause?.code === "23514";
      };
      const bad = (overrides: Record<string, string>) =>
        repo.save({ ...definition("MenuCard"), ...overrides } as never);
      await assert.rejects(bad({ category: "widget" }), isCheckViolation);
      await assert.rejects(bad({ children: "some" }), isCheckViolation);
      assert.equal(await repo.getByName("MenuCard"), undefined);
    });

    it("is left alone by the seed", async () => {
      await empty();
      await repo.save(definition("MenuCard"));
      await repo.save(definition("Button"));
      const before = await repo.list();
      await seedComponents(handle.db, catalog);
      assert.deepEqual(await repo.list(), before);
    });
  },
);

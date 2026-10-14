import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { asc } from "drizzle-orm";
import { catalog } from "../../catalog/components";
import { createDb, type DbHandle } from "./client";
import { runMigrations } from "./migrate";
import { InvalidCatalogError, seedComponents } from "./seed";
import { components } from "./schema";

const databaseUrl = process.env.DATABASE_URL;

// Database test files share one database; `npm test` runs files one at a time
// (--test-concurrency=1), and `after` leaves the table holding the full catalog.
describe("seedComponents", { skip: databaseUrl ? false : "DATABASE_URL is not set" }, () => {
  let handle: DbHandle;
  const rows = () => handle.db.select().from(components).orderBy(asc(components.name));
  const updatedAtByName = async () =>
    new Map((await rows()).map((r) => [r.name, r.updatedAt.getTime()]));

  before(async () => {
    handle = createDb(databaseUrl!);
    await runMigrations(handle.db);
    await handle.db.delete(components);
  });

  after(async () => {
    await seedComponents(handle.db, catalog);
    await handle.close();
  });

  it("adds every entry to an empty table", async () => {
    assert.deepEqual(await seedComponents(handle.db, catalog), {
      added: 12,
      updated: 0,
      removed: 0,
      unchanged: 0,
    });
    const stored = await rows();
    assert.deepEqual(
      stored.map((r) => r.name),
      catalog.map((c) => c.name).sort(),
    );
    for (const entry of catalog) {
      const row = stored.find((r) => r.name === entry.name)!;
      assert.equal(row.description, entry.description);
      assert.equal(row.category, entry.category);
      assert.equal(row.children, entry.children);
      assert.deepEqual(row.propsSchema, entry.propsSchema);
      assert.deepEqual(row.exampleProps, entry.exampleProps);
    }
  });

  it("reports everything unchanged on a second run and leaves updated_at alone", async () => {
    await seedComponents(handle.db, catalog);
    const before = await updatedAtByName();
    assert.deepEqual(await seedComponents(handle.db, catalog), {
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: 12,
    });
    assert.deepEqual(await updatedAtByName(), before);
  });

  it("updates only the row whose description changed", async () => {
    await seedComponents(handle.db, catalog);
    const before = await updatedAtByName();
    const changed = catalog.map((c) =>
      c.name === "Button" ? { ...c, description: "A button. Use it to act." } : c,
    );
    assert.deepEqual(await seedComponents(handle.db, changed), {
      added: 0,
      updated: 1,
      removed: 0,
      unchanged: 11,
    });
    const after = await updatedAtByName();
    for (const [name, time] of after) {
      if (name === "Button") assert.ok(time > before.get(name)!, "Button updated_at moved");
      else assert.equal(time, before.get(name), `${name} updated_at unchanged`);
    }
    const button = (await rows()).find((r) => r.name === "Button")!;
    assert.equal(button.description, "A button. Use it to act.");
  });

  it("deletes rows whose entry left the catalog", async () => {
    await seedComponents(handle.db, catalog);
    const without = catalog.filter((c) => c.name !== "Divider");
    assert.deepEqual(await seedComponents(handle.db, without), {
      added: 0,
      updated: 0,
      removed: 1,
      unchanged: 11,
    });
    const names = (await rows()).map((r) => r.name);
    assert.equal(names.length, 11);
    assert.ok(!names.includes("Divider"));
  });

  it("writes nothing when the catalog is invalid", async () => {
    await seedComponents(handle.db, catalog);
    const before = await rows();
    // Would add, update, and remove rows if it were seeded.
    const broken = [
      ...catalog
        .filter((c) => c.name !== "Divider")
        .map((c) => (c.name === "Text" ? { ...c, description: "Changed. Use it." } : c)),
      { ...catalog[0], name: "Spacer" },
      { ...catalog[5], name: "bad-name", exampleProps: {} },
    ];
    await assert.rejects(seedComponents(handle.db, broken), (err: unknown) => {
      assert.ok(err instanceof InvalidCatalogError);
      assert.deepEqual(err.problems, [
        "bad-name: name must match ^[A-Z][A-Za-z0-9]*$",
        "bad-name: exampleProps.label is required",
      ]);
      assert.match(err.message, /bad-name: name must match/);
      assert.match(err.message, /bad-name: exampleProps.label is required/);
      return true;
    });
    assert.deepEqual(await rows(), before);
  });
});

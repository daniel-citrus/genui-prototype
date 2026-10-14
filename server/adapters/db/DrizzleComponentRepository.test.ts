import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { CatalogComponent, Component } from "shared/components";
import { catalog } from "../../catalog/components";
import { createDb, type DbHandle } from "./client";
import { DrizzleComponentRepository } from "./DrizzleComponentRepository";
import { runMigrations } from "./migrate";
import { components, type NewComponentRow } from "./schema";
import { seedComponents } from "./seed";

const databaseUrl = process.env.DATABASE_URL;

/** The catalog fields of a stored component. */
function catalogFields(c: Component): CatalogComponent {
  return {
    name: c.name,
    description: c.description,
    category: c.category,
    children: c.children,
    propsSchema: c.propsSchema,
    exampleProps: c.exampleProps,
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Seeds the real catalog. Database test files share one database; `npm test`
// runs files one at a time (--test-concurrency=1).
describe(
  "DrizzleComponentRepository",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    let handle: DbHandle;
    let repo: DrizzleComponentRepository;

    before(async () => {
      handle = createDb(databaseUrl!);
      await runMigrations(handle.db);
      await seedComponents(handle.db, catalog);
      repo = new DrizzleComponentRepository(handle.db);
    });

    after(async () => {
      await handle.close();
    });

    it("lists the catalog ordered by category, then name", async () => {
      const expected = [...catalog].sort(
        (a, b) => compare(a.category, b.category) || compare(a.name, b.name),
      );
      assert.deepEqual((await repo.list()).map(catalogFields), expected);
    });

    it("gets every component by name and by id", async () => {
      for (const entry of catalog) {
        const component = await repo.getByName(entry.name);
        assert.ok(component, entry.name);
        assert.deepEqual(catalogFields(component), entry);
        assert.equal(new Date(component.createdAt).toISOString(), component.createdAt);
        assert.equal(new Date(component.updatedAt).toISOString(), component.updatedAt);
        assert.deepEqual(await repo.get(component.id), component);
      }
    });

    it("treats unknown and malformed ids and unknown names as missing", async () => {
      assert.equal(await repo.get(randomUUID()), undefined);
      assert.equal(await repo.get("not-a-uuid"), undefined);
      assert.equal(await repo.getByName("Missing"), undefined);
      assert.equal(await repo.getByName("button"), undefined);
    });

    it("rejects categories and children outside the allowed values", async () => {
      const insertWith = (overrides: Record<string, string>) =>
        handle.db.insert(components).values({
          name: `Bad${randomUUID().replaceAll("-", "")}`,
          description: "A test component.",
          category: "text",
          children: "none",
          propsSchema: { type: "object", properties: {}, additionalProperties: false },
          exampleProps: {},
          ...overrides,
        } as NewComponentRow);
      const isCheckViolation = (err: unknown) => {
        const e = err as { code?: unknown; cause?: { code?: unknown } };
        return e.code === "23514" || e.cause?.code === "23514";
      };
      await assert.rejects(insertWith({ category: "widget" }), isCheckViolation);
      await assert.rejects(insertWith({ children: "some" }), isCheckViolation);
    });
  },
);

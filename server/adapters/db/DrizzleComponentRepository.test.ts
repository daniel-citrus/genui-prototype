import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { inArray } from "drizzle-orm";
import { createDb, type DbHandle } from "./client";
import { DrizzleComponentRepository } from "./DrizzleComponentRepository";
import { runMigrations } from "./migrate";
import { components, type NewComponentRow } from "./schema";

const databaseUrl = process.env.DATABASE_URL;

describe(
  "DrizzleComponentRepository",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    let handle: DbHandle;
    let repo: DrizzleComponentRepository;
    const suffix = randomUUID().replaceAll("-", "");
    const fixture = (
      name: string,
      category: NewComponentRow["category"],
    ): NewComponentRow => ({
      name: `${name}${suffix}`,
      description: `A test component (${name}).`,
      category,
      children: "none",
      propsSchema: {
        type: "object",
        properties: { label: { type: "string" } },
        required: ["label"],
        additionalProperties: false,
      },
      exampleProps: { label: "Hello" },
    });
    const fixtures = [
      fixture("TestWidgetB", "text"),
      fixture("TestWidgetA", "text"),
      fixture("TestWidgetC", "display"),
    ];
    const names = fixtures.map((f) => f.name);

    before(async () => {
      handle = createDb(databaseUrl!);
      await runMigrations(handle.db);
      await handle.db.insert(components).values(fixtures);
      repo = new DrizzleComponentRepository(handle.db);
    });

    after(async () => {
      await handle.db.delete(components).where(inArray(components.name, names));
      await handle.close();
    });

    it("lists components ordered by category, then name", async () => {
      const ours = (await repo.list())
        .filter((c) => names.includes(c.name))
        .map((c) => c.name);
      assert.deepEqual(ours, [
        `TestWidgetC${suffix}`,
        `TestWidgetA${suffix}`,
        `TestWidgetB${suffix}`,
      ]);
    });

    it("gets a component by id and by name", async () => {
      const component = await repo.getByName(`TestWidgetA${suffix}`);
      assert.ok(component);
      assert.equal(component.description, "A test component (TestWidgetA).");
      assert.equal(component.category, "text");
      assert.equal(component.children, "none");
      assert.deepEqual(component.propsSchema, fixtures[1].propsSchema);
      assert.deepEqual(component.exampleProps, { label: "Hello" });
      assert.equal(new Date(component.createdAt).toISOString(), component.createdAt);
      assert.equal(new Date(component.updatedAt).toISOString(), component.updatedAt);

      assert.deepEqual(await repo.get(component.id), component);
    });

    it("treats unknown and malformed ids and unknown names as missing", async () => {
      assert.equal(await repo.get(randomUUID()), undefined);
      assert.equal(await repo.get("not-a-uuid"), undefined);
      assert.equal(await repo.getByName(`Missing${suffix}`), undefined);
      assert.equal(await repo.getByName(`testwidgeta${suffix}`), undefined);
    });

    it("rejects categories and children outside the allowed values", async () => {
      const insertWith = (overrides: Record<string, string>) =>
        handle.db
          .insert(components)
          .values({ ...fixture(`Bad${randomUUID()}`, "text"), ...overrides } as NewComponentRow);
      const isCheckViolation = (err: unknown) => {
        const e = err as { code?: unknown; cause?: { code?: unknown } };
        return e.code === "23514" || e.cause?.code === "23514";
      };
      await assert.rejects(insertWith({ category: "widget" }), isCheckViolation);
      await assert.rejects(insertWith({ children: "some" }), isCheckViolation);
    });
  },
);

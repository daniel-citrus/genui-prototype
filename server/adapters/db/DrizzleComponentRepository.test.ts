import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { NameTakenError } from "../../ports/ComponentRepository";
import { createDb, type DbHandle } from "./client";
import { DrizzleComponentRepository } from "./DrizzleComponentRepository";
import { runMigrations } from "./migrate";

const databaseUrl = process.env.DATABASE_URL;

describe(
  "DrizzleComponentRepository",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    let handle: DbHandle;
    let repo: DrizzleComponentRepository;
    const created: string[] = [];
    const name = `test-${randomUUID()}`;

    before(async () => {
      handle = createDb(databaseUrl!);
      await runMigrations(handle.db);
      repo = new DrizzleComponentRepository(handle.db);
    });

    after(async () => {
      for (const id of created) await repo.remove(id);
      await handle.close();
    });

    it("creates, reads, updates, refuses duplicates, and removes", async () => {
      const component = await repo.create({
        name,
        spec: { type: "button" },
        propsSchema: { type: "object", properties: { label: { type: "string" } } },
      });
      created.push(component.id);
      assert.equal(component.name, name);
      assert.equal(new Date(component.createdAt).toISOString(), component.createdAt);

      assert.deepEqual(await repo.get(component.id), component);
      assert.deepEqual(
        (await repo.list()).find((c) => c.id === component.id),
        component,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      const updated = await repo.update(component.id, { spec: { type: "link" } });
      assert.ok(updated);
      assert.deepEqual(updated.spec, { type: "link" });
      assert.equal(updated.name, name);
      assert.deepEqual(updated.propsSchema, component.propsSchema);
      assert.ok(updated.updatedAt > component.updatedAt);

      await assert.rejects(
        repo.create({ name, spec: {}, propsSchema: { type: "object", properties: {} } }),
        (err: unknown) => err instanceof NameTakenError && err.componentName === name,
      );

      assert.equal(await repo.remove(component.id), true);
      assert.equal(await repo.get(component.id), undefined);
      assert.equal(await repo.remove(component.id), false);
    });

    it("treats unknown and malformed ids as missing", async () => {
      assert.equal(await repo.get(randomUUID()), undefined);
      assert.equal(await repo.update(randomUUID(), { spec: {} }), undefined);
      assert.equal(await repo.remove(randomUUID()), false);
      assert.equal(await repo.get("not-a-uuid"), undefined);
      assert.equal(await repo.update("not-a-uuid", { spec: {} }), undefined);
      assert.equal(await repo.remove("not-a-uuid"), false);
    });
  },
);

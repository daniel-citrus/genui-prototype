import assert from "node:assert/strict";
import { it } from "node:test";
import {
  MAX_CUSTOM_COMPONENT_VERSIONS,
  MAX_CUSTOM_COMPONENTS,
  MAX_CUSTOM_COMPONENTS_TOTAL,
  type CustomComponentDefinition,
  type StoredCustomComponent,
} from "shared/customComponents";
import { CustomComponentError, type CustomComponentRepository } from "../CustomComponentRepository";

export function definition(
  name: string,
  overrides: Partial<CustomComponentDefinition> = {},
): CustomComponentDefinition {
  return {
    name,
    description: `A card for ${name}.`,
    category: "display",
    children: "none",
    propsSchema: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    },
    exampleProps: { title: "Tacos" },
    template: {
      component: "Card",
      children: [{ component: "Heading", props: { text: { $prop: "title" } } }],
    },
    ...overrides,
  };
}

/** The definition fields of a stored component. */
function definitionOf(c: StoredCustomComponent): CustomComponentDefinition {
  const { name, description, category, children, propsSchema, exampleProps, template } = c;
  return { name, description, category, children, propsSchema, exampleProps, template };
}

const isIsoTimestamp = (value: string) => new Date(value).toISOString() === value;

function rejectsWith(code: CustomComponentError["code"], message: RegExp) {
  return (err: unknown) => {
    assert.ok(err instanceof CustomComponentError, String(err));
    assert.equal(err.code, code);
    assert.match(err.message, message);
    return true;
  };
}

/**
 * The `CustomComponentRepository` behavior both implementations share.
 * `fresh` resolves a repository with nothing stored.
 */
export function customComponentRepositoryCases(fresh: () => Promise<CustomComponentRepository>) {
  it("saves version 1, then each save as the next current version, keeping earlier ones", async () => {
    const repo = await fresh();
    const first = definition("MenuCard");
    const second = definition("MenuCard", {
      description: "A bigger card.",
      template: { component: "Card", children: [{ $children: true }] },
      children: "any",
    });

    const v1 = await repo.save(first);
    assert.deepEqual(definitionOf(v1), first);
    assert.equal(v1.version, 1);
    assert.equal(v1.versions, 1);
    assert.equal(v1.deletedAt, null);
    assert.ok(isIsoTimestamp(v1.createdAt) && isIsoTimestamp(v1.updatedAt));

    const v2 = await repo.save(second);
    assert.deepEqual(definitionOf(v2), second);
    assert.equal(v2.version, 2);
    assert.equal(v2.versions, 2);
    assert.equal(v2.createdAt, v1.createdAt);
    assert.deepEqual(await repo.getByName("MenuCard"), v2);

    const old = await repo.getVersion("MenuCard", 1);
    assert.ok(old);
    assert.deepEqual(definitionOf(old), first);
    assert.equal(old.version, 1);
    assert.equal(old.versions, 2);
    for (const missing of [0, 3, 1.5]) {
      assert.equal(await repo.getVersion("MenuCard", missing), undefined);
    }

    const versions = await repo.listVersions("MenuCard");
    assert.deepEqual(
      versions.map(({ version, description }) => ({ version, description })),
      [
        { version: 1, description: first.description },
        { version: 2, description: second.description },
      ],
    );
    assert.ok(versions.every((v) => isIsoTimestamp(v.createdAt)));
  });

  it("keeps no references to what it was given or returned", async () => {
    const repo = await fresh();
    const given = definition("MenuCard");
    const saved = await repo.save(given);
    given.exampleProps.title = "Changed";
    saved.propsSchema.properties.extra = { type: "string" };
    (await repo.getByName("MenuCard"))!.template.component = "Changed";
    assert.deepEqual(definitionOf((await repo.getVersion("MenuCard", 1))!), definition("MenuCard"));
  });

  it("treats names as unique ignoring case, and looks them up exactly", async () => {
    const repo = await fresh();
    await repo.save(definition("MenuCard"));
    await assert.rejects(repo.save(definition("menucard")), rejectsWith("name_taken", /"MenuCard"/));
    assert.equal(await repo.getByName("menucard"), undefined);
    assert.equal(await repo.getVersion("menucard", 1), undefined);
    assert.deepEqual(await repo.listVersions("menucard"), []);
    assert.equal(await repo.softDelete("menucard"), false);
    assert.equal(await repo.restore("menucard"), false);
    assert.equal((await repo.getByName("MenuCard"))?.versions, 1);
  });

  it("soft-deletes and restores, keeping every version", async () => {
    const repo = await fresh();
    await repo.save(definition("MenuCard"));
    await repo.save(definition("MenuCard", { description: "Second." }));
    await repo.save(definition("PriceTag"));

    assert.equal(await repo.softDelete("MenuCard"), true);
    const deleted = await repo.getByName("MenuCard");
    assert.ok(deleted?.deletedAt && isIsoTimestamp(deleted.deletedAt));
    assert.equal(deleted.version, 2);
    assert.equal((await repo.listVersions("MenuCard")).length, 2);
    assert.equal((await repo.getVersion("MenuCard", 1))?.deletedAt, deleted.deletedAt);
    assert.deepEqual(await repo.list(), { components: [await repo.getByName("PriceTag")], total: 1 });
    assert.deepEqual(
      (await repo.list({ includeDeleted: true })).components.map((c) => c.name),
      ["MenuCard", "PriceTag"],
    );

    assert.equal(await repo.restore("MenuCard"), true);
    assert.equal((await repo.getByName("MenuCard"))?.deletedAt, null);
    assert.equal((await repo.list()).total, 2);

    assert.equal(await repo.softDelete("Missing"), false);
    assert.equal(await repo.restore("Missing"), false);
  });

  it("refuses to save over a deleted name", async () => {
    const repo = await fresh();
    await repo.save(definition("MenuCard"));
    await repo.softDelete("MenuCard");
    await assert.rejects(
      repo.save(definition("MenuCard")),
      rejectsWith("deleted", /restore it first.*another name/),
    );
    assert.equal((await repo.getByName("MenuCard"))?.versions, 1);
  });

  it(`refuses a component past ${MAX_CUSTOM_COMPONENTS} not deleted`, async () => {
    const repo = await fresh();
    for (let i = 0; i < MAX_CUSTOM_COMPONENTS; i++) await repo.save(definition(`Card${i}`));
    await assert.rejects(
      repo.save(definition("OneMore")),
      rejectsWith("limit", new RegExp(`\\b${MAX_CUSTOM_COMPONENTS}\\b`)),
    );
    assert.equal((await repo.save(definition("Card0"))).version, 2);
    await repo.softDelete("Card0");
    assert.equal((await repo.save(definition("OneMore"))).version, 1);
  });

  it(`refuses to restore a component past ${MAX_CUSTOM_COMPONENTS} not deleted, even concurrently`, async () => {
    const repo = await fresh();
    for (let i = 0; i < MAX_CUSTOM_COMPONENTS; i++) await repo.save(definition(`Card${i}`));
    await repo.softDelete("Card0");
    await repo.softDelete("Card1");
    await repo.save(definition("OneMore"));

    const results = await Promise.allSettled([repo.restore("Card0"), repo.restore("Card1")]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
    for (const r of results) {
      if (r.status === "fulfilled") assert.equal(r.value, true);
      else rejectsWith("limit", new RegExp(`already ${MAX_CUSTOM_COMPONENTS} custom components`))(r.reason);
    }
    const loser = results[0].status === "rejected" ? "Card0" : "Card1";
    assert.ok((await repo.getByName(loser))?.deletedAt);
    assert.equal((await repo.list()).total, MAX_CUSTOM_COMPONENTS);

    await assert.rejects(repo.restore(loser), rejectsWith("limit", /delete one first/));
    const card2 = await repo.getByName("Card2");
    assert.equal(await repo.restore("Card2"), true);
    assert.deepEqual(await repo.getByName("Card2"), card2);
    assert.equal(await repo.restore("Missing"), false);

    await repo.softDelete("OneMore");
    assert.equal(await repo.restore(loser), true);
    assert.equal((await repo.getByName(loser))?.deletedAt, null);
  });

  it(`refuses a component past ${MAX_CUSTOM_COMPONENTS_TOTAL} counting deleted ones`, async () => {
    const repo = await fresh();
    for (let i = 0; i < MAX_CUSTOM_COMPONENTS_TOTAL; i++) {
      await repo.save(definition(`Card${i}`));
      await repo.softDelete(`Card${i}`);
    }
    await assert.rejects(
      repo.save(definition("OneMore")),
      rejectsWith("limit", new RegExp(`\\b${MAX_CUSTOM_COMPONENTS_TOTAL}\\b`)),
    );
    assert.equal(await repo.getByName("OneMore"), undefined);
  });

  it(`refuses a version past ${MAX_CUSTOM_COMPONENT_VERSIONS}`, async () => {
    const repo = await fresh();
    for (let i = 1; i <= MAX_CUSTOM_COMPONENT_VERSIONS; i++) {
      await repo.save(definition("MenuCard", { description: `Version ${i}.` }));
    }
    await assert.rejects(
      repo.save(definition("MenuCard")),
      rejectsWith("limit", new RegExp(`\\b${MAX_CUSTOM_COMPONENT_VERSIONS}\\b`)),
    );
    const current = await repo.getByName("MenuCard");
    assert.equal(current?.version, MAX_CUSTOM_COMPONENT_VERSIONS);
    assert.equal(current.description, `Version ${MAX_CUSTOM_COMPONENT_VERSIONS}.`);
  });

  it("never gives two concurrent saves the same version; a loser rejects conflict", async () => {
    const repo = await fresh();
    // A new name, then an existing one.
    for (let round = 0; round < 2; round++) {
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, (_, i) =>
          repo.save(definition("MenuCard", { description: `Round ${round} save ${i}.` })),
        ),
      );
      for (const r of results) {
        if (r.status === "rejected") {
          rejectsWith("conflict", /changed while saving, try again/)(r.reason);
        }
      }
    }
    const versions = (await repo.listVersions("MenuCard")).map((v) => v.version);
    assert.deepEqual(
      versions,
      versions.map((_, i) => i + 1),
    );
    assert.equal((await repo.getByName("MenuCard"))?.version, versions.length);
  });

  it("lists current versions by name, filtered by search, with the total before the limit", async () => {
    const repo = await fresh();
    await repo.save(definition("PriceTag", { description: "Shows the price of a MENU item." }));
    await repo.save(definition("MenuCard"));
    await repo.save(definition("Banner", { description: "A menu banner." }));
    await repo.save(definition("Banner", { description: "A wide banner." }));
    await repo.save(definition("Menus"));
    await repo.save(definition("Menuboard"));
    await repo.softDelete("Menus");

    const names = (result: { components: StoredCustomComponent[] }) =>
      result.components.map((c) => c.name);
    const all = await repo.list();
    // Byte order: "MenuCard" before "Menuboard".
    assert.deepEqual(names(all), ["Banner", "MenuCard", "Menuboard", "PriceTag"]);
    assert.equal(all.total, 4);
    assert.equal(all.components[0].version, 2);

    const menu = await repo.list({ search: "mEnU" });
    assert.deepEqual(names(menu), ["MenuCard", "Menuboard", "PriceTag"]);
    assert.equal(menu.total, 3);
    assert.deepEqual(menu.components[0], await repo.getByName("MenuCard"));

    assert.deepEqual(await repo.list({ search: "menu", limit: 2 }), {
      components: menu.components.slice(0, 2),
      total: 3,
    });
    assert.deepEqual(names(await repo.list({ search: "menu", includeDeleted: true })), [
      "MenuCard",
      "Menuboard",
      "Menus",
      "PriceTag",
    ]);
    assert.deepEqual(await repo.list({ search: "%" }), { components: [], total: 0 });
    assert.deepEqual(await repo.list({ limit: 0 }), { components: [], total: 4 });
  });
}

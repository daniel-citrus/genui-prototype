import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalog } from "../../catalog/components";
import { barChart, menuItemCard, panel, withTemplate } from "../../customComponents/testDefinitions";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import type { CustomComponentRepository } from "../../ports/CustomComponentRepository";
import { InMemoryComponentRepository } from "../../ports/fakes/InMemoryComponentRepository";
import { InMemoryCustomComponentRepository } from "../../ports/fakes/InMemoryCustomComponentRepository";
import { createToolRegistry } from "../registry";
import type { ToolContext, ToolLogger } from "../tools";
import { createAgentTools } from "./index";

function recordingLogger(): ToolLogger & { errors: object[] } {
  const errors: object[] = [];
  return {
    errors,
    info() {},
    debug() {},
    error(obj) {
      errors.push(obj);
    },
  };
}

function setup(
  components: ComponentRepository = new InMemoryComponentRepository(catalog),
  customComponents?: CustomComponentRepository,
) {
  const log = recordingLogger();
  const ctx: ToolContext = { signal: new AbortController().signal, log, showUi() {} };
  const registry = createToolRegistry(createAgentTools({ components, customComponents }));
  return { registry, ctx, log };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Catalog names in the repository's order: by category, then name. */
const allNames = [...catalog]
  .sort((a, b) => compare(a.category, b.category) || compare(a.name, b.name))
  .map((c) => c.name);

describe("component tools", () => {
  it("registers list_components, get_component, list_actions and render_ui", () => {
    const { registry } = setup();
    assert.deepEqual(
      registry.specs.map((s) => s.name),
      ["list_components", "get_component", "list_actions", "render_ui"],
    );
  });

  it("lists every component without props schemas", async () => {
    const { registry, ctx } = setup();
    const result = await registry.run("list_components", {}, ctx);

    assert.equal(result.ok, true);
    assert.equal(result.summary, `Listed ${catalog.length} components`);
    const { components } = result.data as { components: Array<Record<string, unknown>> };
    assert.deepEqual(
      components.map((c) => c.name),
      allNames,
    );
    for (const c of components) {
      const entry = catalog.find((e) => e.name === c.name)!;
      assert.deepEqual(c, {
        name: entry.name,
        category: entry.category,
        description: entry.description,
        children: entry.children,
      });
    }
  });

  it("lists components by category", async () => {
    const { registry, ctx } = setup();
    const result = await registry.run("list_components", { category: "layout" }, ctx);

    assert.equal(result.ok, true);
    assert.equal(result.summary, "Listed 3 layout components");
    const { components } = result.data as { components: Array<{ name: string }> };
    assert.deepEqual(components.map((c) => c.name).sort(), ["Card", "Divider", "Stack"]);
  });

  it("reads one component's props schema and example", async () => {
    const { registry, ctx } = setup();
    const result = await registry.run("get_component", { name: "Button" }, ctx);
    const button = catalog.find((c) => c.name === "Button")!;

    assert.deepEqual(result, {
      ok: true,
      summary: "Read Button",
      data: {
        name: "Button",
        category: button.category,
        description: button.description,
        children: button.children,
        propsSchema: button.propsSchema,
        exampleProps: button.exampleProps,
      },
    });
  });

  it("returns the available names for an unknown component", async () => {
    const { registry, ctx } = setup();
    const result = await registry.run("get_component", { name: "Carousel" }, ctx);

    assert.deepEqual(result, {
      ok: false,
      summary: "No component named Carousel",
      data: { available: allNames },
    });
  });

  it("suggests the right spelling for a wrong-case name", async () => {
    const { registry, ctx } = setup();
    const result = await registry.run("get_component", { name: "button" }, ctx);

    assert.deepEqual(result, {
      ok: false,
      summary: "No component named button",
      data: { available: allNames, didYouMean: "Button" },
    });
  });

  it("refuses extra or wrongly typed arguments before the tool runs", async () => {
    let calls = 0;
    const counting: ComponentRepository = {
      list: async () => {
        calls += 1;
        return [];
      },
      get: async () => undefined,
      getByName: async () => {
        calls += 1;
        return undefined;
      },
    };
    const { registry, ctx } = setup(counting);

    for (const [name, args] of [
      ["get_component", { name: 3 }],
      ["get_component", {}],
      ["get_component", { name: "Button", extra: true }],
      ["list_components", { category: "widget" }],
      ["list_components", { limit: 3 }],
    ] as const) {
      const result = await registry.run(name, args, ctx);
      assert.equal(result.ok, false, JSON.stringify(args));
      assert.equal(result.summary, `Invalid arguments for ${name}`);
    }
    assert.equal(calls, 0);
  });

  it("reports a repository error as a failed tool call and logs it", async () => {
    const broken: ComponentRepository = {
      list: async () => {
        throw new Error("connect ECONNREFUSED");
      },
      get: async () => {
        throw new Error("connect ECONNREFUSED");
      },
      getByName: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    };
    const { registry, ctx, log } = setup(broken);

    assert.deepEqual(await registry.run("list_components", {}, ctx), {
      ok: false,
      summary: "list_components failed",
    });
    assert.deepEqual(await registry.run("get_component", { name: "Button" }, ctx), {
      ok: false,
      summary: "get_component failed",
    });
    assert.equal(log.errors.length, 2);
  });
});

describe("component tools with custom components", () => {
  type Listed = { components: Array<Record<string, unknown>>; more?: unknown; note?: string };

  /** The tools over the catalog and a repository holding `definitions`. */
  async function setupCustom(definitions = [menuItemCard, panel, barChart]) {
    const repo = new InMemoryCustomComponentRepository();
    for (const definition of definitions) await repo.save(definition);
    return { repo, ...setup(undefined, repo) };
  }

  /** `count` components named Widget00, Widget01, ... */
  const widgets = (count: number) =>
    Array.from({ length: count }, (_, i) => withTemplate(`Widget${String(i).padStart(2, "0")}`, { component: "Divider" }));

  it("registers define_component and delete_component", async () => {
    const { registry } = await setupCustom([]);
    assert.deepEqual(
      registry.specs.map((s) => s.name),
      ["list_components", "get_component", "list_actions", "render_ui", "define_component", "delete_component"],
    );
  });

  it("lists exactly the catalog when there are no custom components", async () => {
    const { registry, ctx } = await setupCustom([]);
    const plain = setup();

    for (const args of [{}, { category: "layout" }]) {
      assert.deepEqual(
        await registry.run("list_components", args, ctx),
        await plain.registry.run("list_components", args, plain.ctx),
      );
    }
  });

  it("lists custom components after the catalog, by name, with their version", async () => {
    const { registry, repo, ctx } = await setupCustom();
    await repo.save({ ...panel, description: "x".repeat(300) });
    const result = await registry.run("list_components", {}, ctx);

    assert.equal(result.summary, `Listed ${catalog.length + 3} components`);
    const { components, more } = result.data as Listed;
    assert.equal(more, undefined);
    assert.deepEqual(components.slice(0, catalog.length).map((c) => c.name), allNames);
    assert.deepEqual(components.slice(catalog.length), [
      { name: "BarChart", category: "display", description: barChart.description, children: "none", custom: true, version: 1 },
      { name: "MenuItemCard", category: "display", description: menuItemCard.description, children: "none", custom: true, version: 1 },
      { name: "Panel", category: "layout", description: "x".repeat(200), children: "any", custom: true, version: 2 },
    ]);
  });

  it("lists custom components in the category asked for", async () => {
    const { registry, ctx } = await setupCustom();
    const result = await registry.run("list_components", { category: "layout" }, ctx);

    assert.equal(result.summary, "Listed 4 layout components");
    const { components } = result.data as Listed;
    assert.deepEqual(components.map((c) => c.name), ["Card", "Divider", "Stack", "Panel"]);
  });

  it("lists 40 custom components and counts the rest", async () => {
    const { registry, ctx } = await setupCustom(widgets(45));
    const result = await registry.run("list_components", {}, ctx);

    assert.equal(result.summary, `Listed ${catalog.length + 40} components`);
    const { components, more } = result.data as Listed;
    assert.deepEqual(
      components.slice(catalog.length).map((c) => c.name),
      widgets(40).map((w) => w.name),
    );
    assert.deepEqual(more, { count: 5, hint: "Pass search to narrow custom components" });
  });

  it("narrows custom components by name or description with search", async () => {
    const { registry, ctx } = await setupCustom([...widgets(45), menuItemCard]);

    const byName = await registry.run("list_components", { search: "widget4" }, ctx);
    assert.equal(byName.summary, `Listed ${catalog.length + 5} components`);
    assert.equal((byName.data as Listed).more, undefined);
    const byDescription = (await registry.run("list_components", { search: "PHOTO" }, ctx)).data as Listed;
    assert.deepEqual(byDescription.components.slice(catalog.length).map((c) => c.name), ["MenuItemCard"]);

    const long = await registry.run("list_components", { search: "x".repeat(101) }, ctx);
    assert.equal(long.summary, "Invalid arguments for list_components");
  });

  it("leaves out deleted custom components and ones named like a catalog component", async () => {
    const { registry, repo, ctx } = await setupCustom();
    await repo.save(withTemplate("BUTTON", { component: "Divider" }));
    await repo.softDelete("Panel");
    const { components } = (await registry.run("list_components", {}, ctx)).data as Listed;

    assert.deepEqual(components.slice(catalog.length).map((c) => c.name), ["BarChart", "MenuItemCard"]);
    const shadowed = await registry.run("get_component", { name: "BUTTON" }, ctx);
    assert.equal(shadowed.ok, false);
    assert.equal((shadowed.data as { didYouMean: string }).didYouMean, "Button");
  });

  it("reads a custom component with its version and template", async () => {
    const { registry, repo, ctx } = await setupCustom();
    await repo.save({ ...menuItemCard, description: "A menu item card." });
    const result = await registry.run("get_component", { name: "MenuItemCard" }, ctx);

    assert.deepEqual(result, {
      ok: true,
      summary: "Read MenuItemCard v2",
      data: {
        name: "MenuItemCard",
        category: menuItemCard.category,
        description: "A menu item card.",
        children: menuItemCard.children,
        propsSchema: menuItemCard.propsSchema,
        exampleProps: menuItemCard.exampleProps,
        custom: true,
        version: 2,
        template: menuItemCard.template,
      },
    });
  });

  it("reads catalog components first, as without custom components", async () => {
    const { registry, ctx } = await setupCustom();
    const plain = setup();

    assert.deepEqual(
      await registry.run("get_component", { name: "Button" }, ctx),
      await plain.registry.run("get_component", { name: "Button" }, plain.ctx),
    );
  });

  it("lists custom names as available, suggests them for a wrong case, and hides deleted ones", async () => {
    const { registry, repo, ctx } = await setupCustom();
    await repo.softDelete("BarChart");

    assert.deepEqual(await registry.run("get_component", { name: "menuitemcard" }, ctx), {
      ok: false,
      summary: "No component named menuitemcard",
      data: { available: [...allNames, "MenuItemCard", "Panel"], didYouMean: "MenuItemCard" },
    });
    assert.deepEqual(await registry.run("get_component", { name: "BarChart" }, ctx), {
      ok: false,
      summary: "No component named BarChart",
      data: { available: [...allNames, "MenuItemCard", "Panel"] },
    });
  });

  it("still lists and reads the catalog when custom components can't be read", async () => {
    const down = new InMemoryCustomComponentRepository();
    down.list = down.getByName = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const { registry, ctx, log } = setup(undefined, down);

    const listed = await registry.run("list_components", {}, ctx);
    assert.equal(listed.summary, `Listed ${catalog.length} components`);
    const { components, note } = listed.data as Listed;
    assert.deepEqual(components.map((c) => c.name), allNames);
    assert.equal(note, "Custom components are unavailable");
    assert.equal((await registry.run("get_component", { name: "Button" }, ctx)).ok, true);
    assert.deepEqual(await registry.run("get_component", { name: "MenuItemCard" }, ctx), {
      ok: false,
      summary: "Custom components are unavailable",
    });
    assert.equal(log.errors.length, 2);
  });
});

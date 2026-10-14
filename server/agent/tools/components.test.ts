import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalog } from "../../catalog/components";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import { InMemoryComponentRepository } from "../../ports/fakes/InMemoryComponentRepository";
import { createToolRegistry } from "../registry";
import type { ToolContext, ToolLogger } from "../tools";
import { createAgentTools } from "./index";

function recordingLogger(): ToolLogger & { errors: object[] } {
  const errors: object[] = [];
  return {
    errors,
    debug() {},
    error(obj) {
      errors.push(obj);
    },
  };
}

function setup(components: ComponentRepository = new InMemoryComponentRepository(catalog)) {
  const log = recordingLogger();
  const ctx: ToolContext = { signal: new AbortController().signal, log, showUi() {} };
  const registry = createToolRegistry(createAgentTools({ components }));
  return { registry, ctx, log };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Catalog names in the repository's order: by category, then name. */
const allNames = [...catalog]
  .sort((a, b) => compare(a.category, b.category) || compare(a.name, b.name))
  .map((c) => c.name);

describe("component tools", () => {
  it("registers list_components, get_component and render_ui", () => {
    const { registry } = setup();
    assert.deepEqual(
      registry.specs.map((s) => s.name),
      ["list_components", "get_component", "render_ui"],
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

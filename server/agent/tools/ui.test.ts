import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiNode } from "shared/ui";
import { catalog } from "../../catalog/components";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import { InMemoryComponentRepository } from "../../ports/fakes/InMemoryComponentRepository";
import { createToolRegistry } from "../registry";
import type { ToolContext } from "../tools";
import { createAgentTools } from "./index";

function setup(components: ComponentRepository = new InMemoryComponentRepository(catalog)) {
  const shown: UiNode[] = [];
  const errors: object[] = [];
  const ctx: ToolContext = {
    signal: new AbortController().signal,
    log: { debug() {}, error: (obj) => void errors.push(obj) },
    showUi: (tree) => void shown.push(tree),
  };
  return { registry: createToolRegistry(createAgentTools({ components })), ctx, shown, errors };
}

describe("render_ui", () => {
  it("shows a valid tree once and reports the stats without echoing it", async () => {
    const { registry, ctx, shown } = setup();
    const tree = {
      component: "Stack",
      children: [{ component: "Button", props: { label: "Go" } }, { component: "Divider" }],
    };
    const result = await registry.run("render_ui", { tree }, ctx);

    assert.deepEqual(result, {
      ok: true,
      summary: "Rendered 3 components",
      data: { stats: { nodes: 3, depth: 2, components: { Stack: 1, Button: 1, Divider: 1 } } },
    });
    assert.equal(shown.length, 1);
    assert.deepEqual(shown[0], tree);
  });

  it("shows nothing and returns the errors for an invalid tree", async () => {
    const { registry, ctx, shown } = setup();
    const result = await registry.run(
      "render_ui",
      { tree: { component: "Stack", children: [{ component: "Button" }, { component: "button" }] } },
      ctx,
    );

    assert.equal(result.ok, false);
    assert.equal(result.summary, "UI has 2 problems");
    assert.deepEqual(result.data, {
      errors: [
        "tree.children.0.props.label is required",
        'tree.children.1.component "button" is not in the catalog (did you mean Button?)',
      ],
    });
    assert.equal(shown.length, 0);
  });

  it("uses the singular for one problem", async () => {
    const { registry, ctx } = setup();
    const result = await registry.run("render_ui", { tree: { component: "Nope" } }, ctx);
    assert.equal(result.summary, "UI has 1 problem");
  });

  it("refuses a missing or non-object tree before the tool runs", async () => {
    const { registry, ctx, shown } = setup();
    for (const args of [{}, { tree: "Stack" }, { tree: { component: "Divider" }, extra: 1 }]) {
      const result = await registry.run("render_ui", args, ctx);
      assert.equal(result.ok, false);
      assert.equal(result.summary, "Invalid arguments for render_ui");
    }
    assert.equal(shown.length, 0);
  });

  it("reports a repository error as a failed tool call and logs it", async () => {
    const broken: ComponentRepository = {
      list: async () => {
        throw new Error("connect ECONNREFUSED");
      },
      get: async () => undefined,
      getByName: async () => undefined,
    };
    const { registry, ctx, shown, errors } = setup(broken);
    const result = await registry.run("render_ui", { tree: { component: "Divider" } }, ctx);

    assert.deepEqual(result, { ok: false, summary: "render_ui failed" });
    assert.equal(shown.length, 0);
    assert.equal(errors.length, 1);
  });
});

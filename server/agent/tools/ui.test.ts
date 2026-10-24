import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiNode } from "shared/ui";
import type { ActionSpec } from "../../actions/types";
import { catalog } from "../../catalog/components";
import type { ComponentRepository } from "../../ports/ComponentRepository";
import { InMemoryComponentRepository } from "../../ports/fakes/InMemoryComponentRepository";
import { InMemoryCustomComponentRepository } from "../../ports/fakes/InMemoryCustomComponentRepository";
import { createToolRegistry } from "../registry";
import type { ToolContext } from "../tools";
import { createAgentTools } from "./index";

function setup(
  components: ComponentRepository = new InMemoryComponentRepository(catalog),
  actions?: ActionSpec[],
) {
  const shown: UiNode[] = [];
  const errors: object[] = [];
  const ctx: ToolContext = {
    signal: new AbortController().signal,
    log: { info() {}, debug() {}, warn() {}, error: (obj) => void errors.push(obj) },
    showUi: (tree) => void shown.push(tree),
  };
  return { registry: createToolRegistry(createAgentTools({ components, actions })), ctx, shown, errors };
}

describe("render_ui", () => {
  it("shows a leaf without its empty children array and keeps the arguments as sent", async () => {
    const { registry, ctx, shown } = setup();
    const tree = { component: "Heading", props: { text: "Hi" }, children: [] };
    const result = await registry.run("render_ui", { tree }, ctx);

    assert.equal(result.ok, true);
    assert.deepEqual(shown, [{ component: "Heading", props: { text: "Hi" } }]);
    assert.deepEqual(tree.children, []);
    assert.equal(
      (await registry.run("render_ui", { tree: { ...tree, children: [{ component: "Divider" }] } }, ctx)).ok,
      false,
    );
    assert.equal(shown.length, 1);
  });

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
    assert.equal(result.retryable, true);
    assert.deepEqual(result.data, {
      errors: [
        "tree.children.0.props.label is required (call get_component Button for its props)",
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

  it("refuses a Button bound to an unregistered action and shows nothing", async () => {
    const actions: ActionSpec[] = [
      {
        name: "demo_echo",
        description: "Echo.",
        input_schema: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
    const { registry, ctx, shown } = setup(undefined, actions);
    const go = (action: string) => ({ tree: { component: "Button", props: { label: "Go", action } } });

    const result = await registry.run("render_ui", go("send_mail"), ctx);
    assert.deepEqual(result, {
      ok: false,
      summary: "UI has 1 problem",
      retryable: true,
      data: {
        errors: ['tree.props.action "send_mail" is not a registered action (call list_actions to see them)'],
      },
    });
    assert.equal(shown.length, 0);

    assert.equal((await registry.run("render_ui", go("demo_echo"), ctx)).ok, true);
    assert.equal(shown.length, 1);
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

describe("render_ui with custom components", () => {
  it("reports custom components unavailable only for designs that use names outside the catalog", async () => {
    const down = new InMemoryCustomComponentRepository();
    down.getByName = down.list = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const { ctx, shown, errors } = setup();
    const components = new InMemoryComponentRepository(catalog);
    const registry = createToolRegistry(createAgentTools({ components, customComponents: down }));
    const stack = (component: string) => ({ tree: { component: "Stack", children: [{ component }] } });

    assert.equal((await registry.run("render_ui", stack("Divider"), ctx)).ok, true);
    const result = await registry.run("render_ui", stack("MenuItemCard"), ctx);
    assert.deepEqual(result, { ok: false, summary: "Custom components are unavailable" });
    assert.equal(result.retryable, undefined);
    assert.equal(shown.length, 1);
    assert.equal(errors.length, 1);
  });
});

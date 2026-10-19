import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createActions } from "../../actions/index";
import { createActionRegistry } from "../../actions/registry";
import { catalog } from "../../catalog/components";
import { InMemoryComponentRepository } from "../../ports/fakes/InMemoryComponentRepository";
import { createToolRegistry } from "../registry";
import type { ToolContext } from "../tools";
import { createAgentTools } from "./index";

const ctx: ToolContext = {
  signal: new AbortController().signal,
  log: { info() {}, debug() {}, error() {} },
  showUi() {},
};
const components = new InMemoryComponentRepository(catalog);

describe("list_actions", () => {
  it("lists each action's name, description and input schema", async () => {
    const { specs } = createActionRegistry(createActions());
    const registry = createToolRegistry(createAgentTools({ components, actions: specs }));

    const result = await registry.run("list_actions", {}, ctx);

    assert.deepEqual(result, {
      ok: true,
      summary: `Listed ${specs.length} actions`,
      data: {
        actions: specs.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
      },
    });
    assert.ok(specs.some((s) => s.name === "demo_echo"));
  });

  it("lists none when no actions are given", async () => {
    const registry = createToolRegistry(createAgentTools({ components }));
    const result = await registry.run("list_actions", {}, ctx);
    assert.deepEqual(result, { ok: true, summary: "Listed 0 actions", data: { actions: [] } });
  });

  it("takes no arguments", async () => {
    const registry = createToolRegistry(createAgentTools({ components }));
    const result = await registry.run("list_actions", { name: "demo_echo" }, ctx);
    assert.equal(result.ok, false);
    assert.equal(result.summary, "Invalid arguments for list_actions");
  });
});

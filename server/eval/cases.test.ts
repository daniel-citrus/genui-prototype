import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { MARKUP_HTML_TAGS, MARKUP_SVG_TAGS } from "shared/markup";
import { catalog } from "../catalog/components";
import type { ComponentLlm } from "../ports/ComponentLlm";
import { loadCases } from "./loadCases";
import { evalActionRegistry, runEvalCase } from "./runner";
import type { EvalCase } from "./types";

const casesDir = join(dirname(fileURLToPath(import.meta.url)), "cases");
const cases = loadCases(casesDir);
const actions = new Map(evalActionRegistry().specs.map((spec) => [spec.name, spec]));
const markupTags = new Set([...Object.keys(MARKUP_HTML_TAGS), ...Object.keys(MARKUP_SVG_TAGS)]);
const componentChecks = new Set(["uiComponent", "noUiComponent", "agentComponent"]);

function inputsOf(action: string): string[] {
  const schema = actions.get(action)?.input_schema as { properties?: object } | undefined;
  return Object.keys(schema?.properties ?? {});
}

/** `<id>: <check>` for each check naming a component, prop, action, input or tag a design can't have. */
function staleChecks(evalCase: EvalCase): string[] {
  const propsOf = new Map(
    [...catalog, ...(evalCase.customComponents ?? [])].map((c) => [
      c.name,
      Object.keys((c.propsSchema as { properties?: object }).properties ?? {}),
    ]),
  );
  const buttonActions = evalCase.checks.flatMap((check) => ("uiButtonAction" in check ? [check.uiButtonAction] : []));
  const inputs = new Set(buttonActions.flatMap(inputsOf));
  return evalCase.checks.flatMap((check) => {
    const [key, value] = Object.entries(check)[0] as [string, unknown];
    const name = String(value);
    const stale =
      (componentChecks.has(key) && !propsOf.has(name)) ||
      ("uiProps" in check &&
        !Object.keys(check.uiProps.props).every((prop) => propsOf.get(check.uiProps.component)?.includes(prop))) ||
      (key === "uiButtonAction" && !actions.has(name)) ||
      (key === "uiNamedInput" && buttonActions.length > 0 && !inputs.has(name)) ||
      (key === "uiMarkupTag" && !markupTags.has(name));
    return stale ? [`${evalCase.id}: ${key} ${JSON.stringify(value)}`] : [];
  });
}

describe("committed eval cases", () => {
  it("are each in a file named after the case id", () => {
    for (const file of readdirSync(casesDir).filter((name) => name.endsWith(".json"))) {
      const { id } = JSON.parse(readFileSync(join(casesDir, file), "utf8")) as { id: string };
      assert.equal(file, `${id}.json`);
    }
  });

  it("check only for components, props, actions, action inputs and Markup tags that exist", () => {
    assert.deepEqual(cases.flatMap(staleChecks), []);
  });

  it("have seeds that save, so each seeded run reaches the model", async () => {
    const stopAtModel: ComponentLlm = {
      complete: async () => {
        throw new Error("stop");
      },
    };
    const seeded = cases.filter((c) => c.customComponents !== undefined);
    assert.ok(seeded.length > 0);
    const errors: string[] = [];
    for (const evalCase of seeded) {
      const { error } = await runEvalCase(evalCase, { llm: stopAtModel });
      if (error !== "generation error: Error") errors.push(`${evalCase.id}: ${error}`);
    }
    assert.deepEqual(errors, []);
  });
});

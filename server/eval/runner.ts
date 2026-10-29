import { createActions } from "../actions/index";
import { createMenuActions } from "../actions/menu/index";
import { createActionRegistry } from "../actions/registry";
import { createInMemoryPosMenu } from "../adapters/pos/InMemoryPosMenu";
import { catalog } from "../catalog/components";
import { validateDefinition } from "../customComponents/definition";
import { generateComponent, type GenerationAttempt } from "../generate/generate";
import type { ComponentLlm } from "../ports/ComponentLlm";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { InMemoryCustomComponentRepository } from "../ports/fakes/InMemoryCustomComponentRepository";
import { checkGeneration } from "./checks";
import type { EvalCase, EvalCaseResult } from "./types";

const noopLogger = { debug() {}, error() {}, info() {}, warn() {} };

const neverAborted = new AbortController().signal;

/** The actions a case may use: the demo actions and the menu actions on an in-memory menu. */
export function evalActionRegistry() {
  return createActionRegistry([
    ...createActions(),
    ...createMenuActions(createInMemoryPosMenu()),
  ]);
}

/** Saves the case's seeds; returns `seed <name>: <first problem>` for the first invalid one. */
async function seedComponents(
  evalCase: EvalCase,
  repository: InMemoryCustomComponentRepository,
  components: InMemoryComponentRepository,
): Promise<string | undefined> {
  const seeds = evalCase.customComponents ?? [];
  if (seeds.length === 0) return undefined;
  const registry = evalActionRegistry();
  const listed = await components.list();
  for (const seed of seeds) {
    const check = await validateDefinition(seed, {
      catalog: listed,
      resolve: (name) => repository.getByName(name),
      actions: registry.specs,
    });
    if (!check.ok) return `seed ${seed.name}: ${check.errors[0]}`;
    await repository.save(check.definition);
  }
  return undefined;
}

export async function runEvalCase(
  evalCase: EvalCase,
  opts: { llm: ComponentLlm; signal?: AbortSignal },
): Promise<EvalCaseResult> {
  const components = new InMemoryComponentRepository(catalog);
  const customComponents = new InMemoryCustomComponentRepository();
  const seedError = await seedComponents(evalCase, customComponents, components);
  if (seedError !== undefined) {
    return { id: evalCase.id, ok: false, failures: [], error: seedError };
  }

  const registry = evalActionRegistry();
  const attempts: GenerationAttempt[] = [];
  try {
    const generation = await generateComponent(evalCase.prompt, {
      llm: opts.llm,
      components,
      customComponents,
      actions: registry.specs,
      listChoices: registry.listChoices,
      listChoiceGroups: registry.listChoiceGroups,
      log: noopLogger,
      signal: opts.signal ?? neverAborted,
      attempts,
    });
    if (!generation.ok) {
      const reason = `generation failed: ${generation.problems.length} problems`;
      return { id: evalCase.id, ok: false, failures: [{ reason }], generation };
    }
    const failures = checkGeneration(generation, evalCase.checks);
    return { id: evalCase.id, ok: failures.length === 0, failures, generation };
  } catch (err) {
    const reason = `generation error: ${err instanceof Error ? err.name : "Error"}`;
    return { id: evalCase.id, ok: false, failures: [{ reason }], attempts, error: reason };
  }
}

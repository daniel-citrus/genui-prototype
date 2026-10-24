import { randomUUID as cryptoRandomUuid } from "node:crypto";
import { createActions } from "../actions/index";
import { createMenuActions } from "../actions/menu/index";
import { createActionRegistry } from "../actions/registry";
import { createInMemoryPosMenu } from "../adapters/pos/InMemoryPosMenu";
import { resetConversation } from "../agent/conversations";
import { runAgent } from "../agent/loop";
import { createToolRegistry } from "../agent/registry";
import type { AgentRun } from "../agent/run";
import type { ToolLogger } from "../agent/tools";
import { createAgentTools } from "../agent/tools/index";
import type { AgentTrace } from "../agent/trace";
import { createDesignStore } from "../designs";
import { catalog } from "../catalog/components";
import type { AgentLlm } from "../ports/AgentLlm";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { InMemoryCustomComponentRepository } from "../ports/fakes/InMemoryCustomComponentRepository";
import { InMemoryTraceRepository } from "../ports/fakes/InMemoryTraceRepository";
import { validateDefinition } from "../customComponents/definition";
import { checkTrace } from "./checks";
import type { EvalCase, EvalCaseResult } from "./types";

const noopLogger: ToolLogger = { debug() {}, error() {}, info() {}, warn() {} };

const neverAborted = new AbortController().signal;

/** Overridden in tests to pin the eval conversation id. */
export const evalRunnerTestHooks = {
  uuid: cryptoRandomUuid,
};

function evalActionRegistry() {
  return createActionRegistry([
    ...createActions(),
    ...createMenuActions(createInMemoryPosMenu()),
  ]);
}

export function createEvalTools(customComponents = new InMemoryCustomComponentRepository()) {
  const registry = evalActionRegistry();
  return createToolRegistry(
    createAgentTools({
      components: new InMemoryComponentRepository(catalog),
      customComponents,
      actions: registry.specs,
      listChoices: registry.listChoices,
    }),
  );
}

function emptyTrace(conversationId: string): AgentTrace {
  return {
    conversationId,
    userText: "",
    endedBy: "stopped",
    steps: 0,
    toolCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    completions: [],
  };
}

function runFailureReason(err: unknown): string {
  if (err instanceof Error) return `agent run failed: ${err.name}`;
  return "agent run failed";
}

/** Saves the case's seeds; returns `seed <name>: <first problem>` for the first invalid one. */
async function seedComponents(
  evalCase: EvalCase,
  repository: InMemoryCustomComponentRepository,
): Promise<string | undefined> {
  const seeds = evalCase.customComponents ?? [];
  if (seeds.length === 0) return undefined;
  const registry = evalActionRegistry();
  const components = await new InMemoryComponentRepository(catalog).list();
  for (const seed of seeds) {
    const check = await validateDefinition(seed, {
      catalog: components,
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
  opts: { llm: AgentLlm; signal?: AbortSignal },
): Promise<EvalCaseResult> {
  const traces = new InMemoryTraceRepository();
  const conversationId = `eval:${evalCase.id}:${evalRunnerTestHooks.uuid()}`;
  const signal = opts.signal ?? neverAborted;

  const repository = new InMemoryCustomComponentRepository();
  const seedError = await seedComponents(evalCase, repository);
  if (seedError !== undefined) {
    const trace = emptyTrace(conversationId);
    return {
      id: evalCase.id,
      ok: false,
      failures: [],
      trace,
      endedBy: trace.endedBy,
      error: seedError,
    };
  }

  const run: AgentRun = {
    emit: () => {},
    conversationId,
    designs: createDesignStore({ max: 1 }),
    signal,
    tools: createEvalTools(repository),
    log: noopLogger,
    traces,
  };

  let runError: string | undefined;
  try {
    await runAgent(evalCase.prompt, conversationId, run, opts.llm);
  } catch (err) {
    runError = runFailureReason(err);
  } finally {
    resetConversation(conversationId);
  }

  const saved = await traces.listByConversation(conversationId);
  const trace = saved.at(-1) ?? emptyTrace(conversationId);
  const failures = checkTrace(trace, evalCase.checks);

  const result: EvalCaseResult = {
    id: evalCase.id,
    ok: failures.length === 0,
    failures,
    trace,
    endedBy: trace.endedBy,
  };
  if (trace.error !== undefined) result.error = trace.error;
  else if (runError !== undefined) result.error = runError;

  return result;
}

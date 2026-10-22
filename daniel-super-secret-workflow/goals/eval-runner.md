---
id: eval-runner
priority: 20
depends:
  - eval-checks
touches:
  - server/eval/runner.ts
  - server/eval/runner.test.ts
scope: medium
---

# Run one eval case through runAgent with an injected model

## Sources

- [Eval harness plan — R3](../plans/eval-harness.md#r3-isolated-runner-with-injectable-model)
- [Eval harness plan — Interfaces](../plans/eval-harness.md#interfaces)
- [Eval harness plan — eval-runner](../plans/eval-harness.md#work-breakdown)

## Context

This builds on `eval-checks`, which provides `EvalCase`, `EvalCaseResult`, `CheckFailure`, `checkTrace`, and `loadCases`. There is still no runner or CLI. Chat uses `runAgent(userText, conversationId, run, llm)` in `server/agent/loop.ts`. `AgentRun` in `server/agent/run.ts` is `{ emit, conversationId, signal, tools, log, traces, resume? }`. The loop saves the turn through `run.traces.save` in `finally`. Tests already call `runAgent` with a local `scriptedLlm` helper in `server/agent/loop.test.ts`; do not export that helper. Keep a short local copy in the eval runner tests.

`TraceRepository` is `{ save, listByConversation }` in `server/ports/TraceRepository.ts`. Tests use `InMemoryTraceRepository` in `server/ports/fakes/InMemoryTraceRepository.ts`. Production chat writes `DrizzleTraceRepository` into `genui_traces`. Eval must not open that database.

`hasConversation` / `resetConversation` live in `server/agent/conversations.ts`. `getHistory` creates the in-memory conversation when `runAgent` runs. After a case, that conversation must be gone. Traces stay on the in-memory repository (the loop tests already show `resetConversation` does not delete repository rows).

Production tools in `server/index.ts` are `createToolRegistry(createAgentTools({ components, actions: actions.specs, listChoices: actions.listChoices, customComponents }))` where `actions` is `createActionRegistry([...createActions(), ...createMenuActions(menu)])`. Eval uses the same tool set over in-memory ports: catalog file, empty custom components, `demo_echo` plus the fourteen menu actions on an in-memory menu.

`AgentLlm` is `{ complete({ messages, tools, allowTools?, signal, onText }): Promise<LlmTurn> }` in `server/ports/AgentLlm.ts`. A scripted model that should `render_ui` a heading can return tool turns then a text turn, as in `server/agent/loop.test.ts`. A valid Heading tree is `{ component: "Heading", props: { text: "Hello" } }` (`text` is required in `server/catalog/components.ts`).

Do not change the agent loop, routes, system prompt, or traces adapter. Do not add `npm run eval`, case files, or docs. The CLI (later) calls `createOpenAILlm`; this runner must not.

## Scope

Add `createEvalTools()` and `runEvalCase` in `server/eval/runner.ts`.

`createEvalTools()` builds:

```ts
const registry = createActionRegistry([
  ...createActions(),
  ...createMenuActions(createInMemoryPosMenu()),
]);
return createToolRegistry(
  createAgentTools({
    components: new InMemoryComponentRepository(catalog),
    customComponents: new InMemoryCustomComponentRepository(),
    actions: registry.specs,
    listChoices: registry.listChoices,
  }),
);
```

`catalog` is `server/catalog/components.ts`. A new menu per case or one per process is fine; these cases do not mutate the menu. Prefer a fresh `createEvalTools()` per case so cases share no conversation id and no menu instance.

```ts
export function runEvalCase(
  evalCase: EvalCase,
  opts: { llm: AgentLlm; signal?: AbortSignal },
): Promise<EvalCaseResult>;
```

For each case: create a fresh `InMemoryTraceRepository`, `conversationId` `eval:<id>:<uuid>`, `AgentRun` with a discarding `emit`, a silent `log` (the `ToolLogger` shape used in loop tests), `tools` from `createEvalTools()`, `traces` the in-memory repository, and `signal` from `opts.signal` or a never-aborted signal. Call `runAgent(evalCase.prompt, conversationId, run, opts.llm)`. Read the turn with `listByConversation`. Apply `checkTrace`. In `finally`, call `resetConversation(conversationId)` so `hasConversation` is false even if `runAgent` throws.

If `runAgent` throws, do not throw from `runEvalCase`: return `{ id, ok: false, failures: [...] }` with a reason that names the failure and omits `userText`, completions, tool arguments, and trees. If the repository has no trace, fail the checks the same way (do not throw). Copy `endedBy` and `error` from the trace onto `EvalCaseResult` when present. `ok` is true only when `failures` is empty.

The runner must not import `createDb`, `createTracesDb`, or `createRedis`, and must not import or call `createOpenAILlm`. It must not open Postgres, Redis, or an HTTP server.

## Acceptance

- With a scripted `AgentLlm` that lists components and `render_ui`s a `Heading`, a case that checks `toolSucceeded: "render_ui"` and `uiComponent: "Heading"` returns `{ ok: true, failures: [] }`.
- With a scripted `AgentLlm` that only replies with text, that same case returns `{ ok: false }` with failures for `toolSucceeded` and `uiComponent`, and does not throw.
- After `runEvalCase` settles (pass or fail), `hasConversation` is false for that conversation id.
- `server/eval/runner.ts` does not import `createDb`, `createTracesDb`, `createRedis`, or `createOpenAILlm`.

## Validation

- `npm test` includes `server/eval/runner.test.ts` (this goal adds it): scripted heading pass; text-only fail without a throw; `hasConversation` is false after the case.
- `grep -E "createDb|createTracesDb|createRedis|createOpenAILlm" server/eval/runner.ts` prints nothing.
- `npm run typecheck` passes.
- `npm run build` and `npm run build:api` pass.

## After merge

- None. The live CLI is a later goal.

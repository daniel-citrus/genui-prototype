---
id: generate-api
priority: 30
depends:
  - generator
  - remove-redis
touches:
  - server/routes/generate.ts
  - server/routes/generate.test.ts
  - server/designs.ts
  - server/designs.test.ts
  - server/routes/actions.ts
  - server/routes/actions.test.ts
  - server/actions/types.ts
  - server/actions/registry.ts
  - server/actions/registry.test.ts
  - server/actions/demo.test.ts
  - server/actions/menu/menu.test.ts
  - server/agent/run.ts
  - server/agent/conversations.ts
  - server/agent/conversations.test.ts
  - server/app.ts
  - server/app.test.ts
  - server/index.ts
  - server/routes/health.ts
  - shared/api.ts
  - shared/generate.ts
  - src/main.ts
scope: medium
---

# Add POST /api/generate, the design store and designId actions

## Sources

- [Simplify genui plan — R6, R7, R8, R14](../plans/simplify-to-generator-tool.md#r6-post-apigenerate)

## Context

This builds on `generator`, which provides `generateComponent`, `Generation`, `ComponentLlm`, `createOpenAIComponentLlm` and `shared/generate.ts` (types and `MAX_PROMPT_CHARS`), and on `remove-redis` (rate limits count in memory only). CapheViet POS, a separate app, will call genui over HTTP from inside its own agent loop. The old chat agent must keep working until the preview page lands, so this goal keeps `server/agent/` and `src/main.ts` compiling and functional by pointing them at the new design store.

Today `POST /api/actions/run` (`server/routes/actions.ts`) takes `{ conversationId, uiId, action, values, confirmed? }`, looks the design up with `getDesign(conversationId, uiId)` from `server/agent/conversations.ts`, answers 409 `DESIGN_GONE_MESSAGE` when gone, then runs `checkActionRequest` (`server/ui/checkAction.ts`) and handles the confirm question. `ActionContext` (`server/actions/types.ts`) has `conversationId`. `server/agent/run.ts`'s `showUi` gives each design a UUID with `rememberDesign`. `src/main.ts` calls the action route with the old shape. Health (`server/routes/health.ts`) returns `{ ok, db, agent, ... }`.

## Scope

- `server/designs.ts`: `createDesignStore({ max })` with `remember(id, tree)` and `get(id)`; keeps the `max` newest, drops the oldest; `get` of unknown/dropped id returns `undefined`. App uses `MAX_DESIGNS = 500` (constant in `server/app.ts`).
- `server/routes/generate.ts`: `POST /api/generate` calling `generateComponent` with the real OpenAI adapter (`AGENT_MODEL`, `AGENT_MAX_OUTPUT_TOKENS`), wired in `server/app.ts` / `server/index.ts`. `GENERATE_TIMEOUT_MS = 90000` as a constant in `server/generate/generate.ts` or the route.
- `shared/generate.ts`: add `GENERATE_UI_TOOL`:

```ts
export const GENERATE_UI_TOOL: { name: "generate_ui"; description: string; parameters: Record<string, unknown> };
```

  `name: "generate_ui"`, description at most 600 characters that tells the host to call genui when the person wants to see or use a form, list, card, chart or other UI, to describe the UI and the data it shows in the prompt, and to relay `notes`. `parameters` is a JSON Schema object with one required string `prompt` (`maxLength` 4000) and `additionalProperties: false`.
- Actions: `POST /api/actions/run` takes `{ designId, action, values, confirmed? }` (`ActionRunRequest` in `shared/api.ts`). `ActionContext` gets `designId` in place of `conversationId`, and the action log line names `designId`. The old agent's `showUi` writes into the new design store (it still supplies its own UUID), and `src/main.ts` sends `designId` (its current `uiId`) so the chat keeps working.
- Health answers `{ ok, db, agent }` plus whatever other keys still exist from the pre-existing traces check (that key is removed by a later goal).
- Rate limit for the generate route is counted apart from actions and custom components, using `AGENT_RATE_LIMIT_PER_MINUTE`.
- Each generation logs exactly one info line `design generated` with `{ designId?, ok, attempts, problems, promptTokens, completionTokens, durationMs }`: counts only, never prompt, tree, notes or model output.

## Acceptance

- `POST /api/generate` with `{ "prompt": "<text>" }` answers 200 with `{ ok: true, id, tree, notes, attempts }`: `id` a random UUID, `tree` the expanded tree, `attempts` 1 to 3. The expanded tree is remembered in the design store under `id` before answering.
- A design that still has problems answers 422 with `{ ok: false, error: "The design still had problems after 3 tries.", problems, attempts }`.
- 400 with `{ error: { message } }` for: a body that isn't an object; missing or blank `prompt`; `prompt` over `MAX_PROMPT_CHARS` (4000) after trimming, message `Prompt is too long (max 4000 characters).`; malformed JSON.
- A body over 32 KB answers 413. More than `AGENT_RATE_LIMIT_PER_MINUTE` requests per IP per minute answers 429 with `Retry-After`, counted separately from actions and custom components.
- No `OPENAI_API_KEY`: 503 `The generator is not configured: set OPENAI_API_KEY.`. A model call that fails or exceeds `GENERATE_TIMEOUT_MS`: 502 `The model request failed.`. `CustomComponentsUnavailableError`: 503 `Custom components are unavailable.`. None leaks error details.
- If the client disconnects, the in-flight model call is aborted and no further attempt starts.
- `GENERATE_UI_TOOL` matches the shape above; a body valid against its `parameters` is accepted, and one with an extra key is still accepted with the key ignored.
- `createDesignStore` evicts oldest past `max`; unknown id returns `undefined`.
- `POST /api/actions/run`: missing `designId` answers 400 `designId and action must be non-empty strings.`; unknown `designId` answers 409 with `DESIGN_GONE_MESSAGE` reworded to `This design is no longer available. Generate it again.`; everything after the lookup (`checkActionRequest`, confirm question, timeout, logging) is unchanged.
- The `design generated` log line is the only generation log, and a test with a prompt containing a marker string finds the marker in no captured log line (use the app's `logStream`).
- The old chat flow still works end to end with fakes (existing agent/route tests pass).

## Validation

- `npm run typecheck`, `npm test`, `npm run build`, `npm run build:api` pass.
- Tests introduced by this goal, using fake LLM and in-memory ports: `server/routes/generate.test.ts` (200, 422, 400 variants, 413, 429, 503 no key, 502, 503 custom components, disconnect abort, design remembered under `id`, `GENERATE_UI_TOOL.parameters` body accepted, log has no prompt text); `server/designs.test.ts`; rewritten `server/routes/actions.test.ts` (400 missing designId, 409 unknown, existing check/confirm/run cases); updated registry/demo/menu tests for `designId`; `server/app.test.ts` health shape.

## After merge

- Run `curl -s -X POST localhost:5173/api/generate -H 'content-type: application/json' -d '{"prompt":"a heading that says Hello"}'` with a real `OPENAI_API_KEY` and expect 200 with `tree` and `notes` in a few seconds.

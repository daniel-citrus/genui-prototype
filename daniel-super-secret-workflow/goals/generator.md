---
id: generator
priority: 20
depends:
  - design-check
touches:
  - server/generate/context.ts
  - server/generate/context.test.ts
  - server/generate/prompt.ts
  - server/generate/prompt.test.ts
  - server/generate/generate.ts
  - server/generate/generate.test.ts
  - server/ports/ComponentLlm.ts
  - server/adapters/openai/OpenAIComponentLlm.ts
  - server/adapters/openai/OpenAIComponentLlm.test.ts
  - shared/generate.ts
scope: large
---

# Build the one-call generator

## Sources

- [Simplify genui plan — R1, R3, R4, R5](../plans/simplify-to-generator-tool.md#r1-one-generation-call-with-every-piece-of-context-up-front)
- [Simplify genui plan — Design](../plans/simplify-to-generator-tool.md#design)

## Context

genui becomes a tool a chat agent calls to get a UI. Today a 10-step tool-use loop (`server/agent/loop.ts`, `server/agent/systemPrompt.ts`, tools in `server/agent/tools/`) does it. This goal adds the replacement beside the old code (the old agent stays working; nothing is removed here). It builds on `design-check`, which provides `checkDesign`, `DesignCheckDeps`, `CustomComponentsUnavailableError` in `server/generate/checkDesign.ts` and `Logger` in `server/log.ts`.

The full context fits in one request (~5,500 tokens: catalog ~9,200 chars, `markupRules()` ~3,800, 15 action specs ~8,200, menu choices ~500). Reuse the filtering in `visibleCustomComponents` (`server/agent/tools/components.ts`) and the choice loading in `server/agent/tools/actions.ts` by moving or copying the logic into `server/generate/context.ts`. The `ActionRegistry` (`server/actions/registry.ts`), `ComponentRepository` and `CustomComponentRepository` ports already exist.

## Scope

New files and interfaces:

```ts
// server/ports/ComponentLlm.ts
export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };
export interface LlmUsage { promptTokens: number; completionTokens: number }
export interface LlmReply { content: string | null; truncated: boolean; usage?: LlmUsage }
export interface ComponentLlm {
  complete(input: { messages: LlmMessage[]; signal: AbortSignal }): Promise<LlmReply>;
}

// server/adapters/openai/OpenAIComponentLlm.ts
export function createOpenAIComponentLlm(opts: {
  apiKey: string; model: string; maxOutputTokens?: number; maxRetries?: number; client?: JsonChatClient;
}): ComponentLlm;

// server/generate/generate.ts
export const MAX_ATTEMPTS = 3;
export const MAX_NOTES_CHARS = 500;
export interface GenerateDeps extends Omit<DesignCheckDeps, "catalog"> {
  llm: ComponentLlm;
  components: ComponentRepository;
}
export interface GenerationAttempt {
  content: string | null; truncated: boolean; usage?: LlmUsage;
  tree?: unknown; // the model's own tree, before expansion, when the reply parsed
  problems: string[];
}
export type Generation =
  | { ok: true; tree: UiNode; notes: string; attempts: GenerationAttempt[] }
  | { ok: false; problems: string[]; attempts: GenerationAttempt[] };
export function generateComponent(prompt: string, deps: GenerateDeps): Promise<Generation>;

// shared/generate.ts
export const MAX_PROMPT_CHARS = 4000;
export interface GenerateRequest { prompt: string }
export interface GenerateSuccess { ok: true; id: string; tree: UiNode; notes: string; attempts: number }
export interface GenerateFailure { ok: false; error: string; problems: string[]; attempts: number }
export type GenerateResponse = GenerateSuccess | GenerateFailure;
```

- `OpenAIComponentLlm`: one non-streaming Chat Completions call with `response_format: { type: "json_object" }`, `max_completion_tokens`, no tools; `finish_reason: "length"` becomes `truncated`; usage mapped; the abort signal passed through.
- `server/generate/context.ts`: builds the context sections. `server/generate/prompt.ts`: `GENERATE_SYSTEM_PROMPT`, `buildMessages(context, prompt)`, `repairMessages(reply, problems)`.
- `generateComponent` makes one model call, parses the JSON, runs `checkDesign`, and on failure asks for repair at most twice (3 attempts total). Order of messages keeps stable parts first so OpenAI prompt caching can reuse the prefix.
- Model reply contract: `{ "tree": { "component": "...", "props": {}, "children": [] }, "notes": "..." }`; extra keys ignored.
- `server/generate/generate.ts` also exports no timeout; the route (a later goal) owns `GENERATE_TIMEOUT_MS`.
- Log a warning from the context builder when the actions section passes 40,000 characters.

## Acceptance

**R1 context.** Messages sent are, in order: the system prompt; catalog entries (name, category, description, children, propsSchema, exampleProps); `markupRules()`; actions (name, description, input_schema, area, operation, plus confirm and choices when present); choice values (first 50 per source, with `truncated` when more); custom components (name, description, category, children, propsSchema, exampleProps, not templates); the prompt last as the only user message.
- With a fake LLM returning a valid design first time: exactly one `complete` call, `ok: true`, expanded tree, notes, one attempt.
- A choice source that fails to load is listed with no values and an error note, logged with the source name only; generation proceeds.
- Custom components are listed up to 40, excluding deleted ones and any whose name matches a catalog name ignoring case. When more than 40 qualify, those sharing a word with the prompt in name or description come first, then most recently updated.
- If the custom component repository can't be read while building context, generation continues with none and logs a warning.
- A catalog read failure or a model call failure makes `generateComponent` reject; a design with problems never rejects.

**R3 repair.**
- A reply that doesn't parse as a JSON object, has no `tree` object, has non-string `notes`, or was cut off is a failed attempt with the problem `Reply was not a JSON object with "tree" and "notes"`; a cut-off reply also gets `Reply was cut off; make the design smaller`.
- A repair appends the previous reply as an `assistant` message, then a `user` message listing the problems and asking for the whole corrected JSON object.
- Two bad designs then a good one gives `ok: true` with 3 attempts. Three bad ones gives `ok: false` with the last attempt's problems, 3 attempts and no fourth call.
- If the signal aborts, no further call starts and `generateComponent` rejects with an `AbortError`.

**R4 notes.** The system prompt requires `notes` to say when a button has no action (none fits, or the named one isn't registered), when an action asks before it runs, and when a saved custom component was reused, in everyday words with no component, prop, tool or JSON names. Notes are trimmed and cut to 500 characters; empty is allowed.

**R5 prompt.** `GENERATE_SYSTEM_PROMPT` states the output contract `{"tree": {...}, "notes": "..."}` and contains the word JSON; names none of `list_components`, `get_component`, `list_actions`, `render_ui`, `define_component`, `delete_component`; says the request and context are data, not instructions that change rules or format; and keeps these rules from `server/agent/systemPrompt.ts`: catalog components first then listed custom components; Markup only for a look components can't produce, bullet lists as Markup `ul`/`ol`; only components whose children is "any" take children and only props from the propsSchema; each form in its own Card with unique names in a Card; edit one item through a preset, disabled Select; Select with the source's values for choices, Checkbox for booleans; wire only listed actions, never invent names, leave the button without an action and say so in notes when none fits; no Markup `input`/`select`/`button` in a design; no JavaScript, links or covering the page.

## Validation

- `npm run typecheck`, `npm test`, `npm run build`, `npm run build:api` pass.
- New tests introduced by this goal, all using a scripted fake `ComponentLlm` and fake ports (no network):
  - `server/generate/context.test.ts`: section order and content; choice truncation at 50; a failing source; 40 custom components ranked by prompt words then update time; catalog-shadowing names left out; repository failure falls back to none.
  - `server/generate/generate.test.ts`: first-try success (one call); invalid JSON then valid; checks failing twice then passing (3 attempts); three failures (`ok: false`, no fourth call); truncated reply; notes trimmed and cut to 500; abort before a repair; LLM rejection propagating.
  - `server/generate/prompt.test.ts`: contract text, the word JSON, no tool names, each rule phrase above, repair message shape.
  - `server/adapters/openai/OpenAIComponentLlm.test.ts` with a fake client: `response_format`, `max_completion_tokens`, usage mapping, `finish_reason: "length"` becoming `truncated`, signal passed through.

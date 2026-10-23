---
id: output-cap-4096
priority: 50
depends: []
touches:
  - server/agent/guardrails.ts
  - server/adapters/openai/OpenAILlm.test.ts
  - .env.example
  - docs/ARCHITECTURE.md
scope: small
---

# Raise the default output limit per model call to 4096 tokens

## Sources

- [Component generation plan — R8 Output limit fits a full definition](../plans/data-driven-components-and-card-forms.md#r8-output-limit-fits-a-full-definition)

## Context

A custom component definition may be up to 8,000 characters
(`MAX_DEFINITION_CHARS`, `shared/customComponents.ts`), roughly 2,000 to
2,700 tokens. The default output cap per model call is 2,048 tokens, so a
full `define_component` call can be cut off mid-arguments.

- `server/agent/guardrails.ts` sets `DEFAULT_MAX_OUTPUT_TOKENS = 2048`.
- `server/config.ts` uses it as the default for `AGENT_MAX_OUTPUT_TOKENS`.
- `server/adapters/openai/OpenAILlm.ts` sends
  `max_completion_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS`.
- `server/adapters/openai/OpenAILlm.test.ts` (around lines 250–267) asserts a
  configured value (512) and the default (2048).
- `.env.example` has `# AGENT_MAX_OUTPUT_TOKENS=2048`; `docs/ARCHITECTURE.md`
  lists `2048` in the environment table.

No prerequisites. Turn budgets (`MAX_TURN_TOKENS` 150,000 and `MAX_STEPS`
10) don't change; the cap is a ceiling, not a target.

## Scope

Set `DEFAULT_MAX_OUTPUT_TOKENS = 4096` and update the test, `.env.example` and
the `docs/ARCHITECTURE.md` environment table. `AGENT_MAX_OUTPUT_TOKENS` stays
the override. No new environment variables.

## Acceptance

- With no `AGENT_MAX_OUTPUT_TOKENS`, the OpenAI request sends
  `max_completion_tokens: 4096`.
- A set value still wins (the existing 512 case).
- `.env.example` and `docs/ARCHITECTURE.md` show 4096.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, with `server/adapters/openai/OpenAILlm.test.ts` asserting
  the 4096 default and the override.
- `npm run build` and `npm run build:api` succeed.

---
id: prompt-lines
priority: 10
depends: []
touches:
  - server/agent/systemPrompt.ts
  - server/agent/systemPrompt.test.ts
scope: small
---

# Tell the model how to read components and fill booleans

## Sources

- [Eval improvements — R3](../plans/eval-improvements.md#r3-prompt-lines)

## Context

`SYSTEM_PROMPT` in `server/agent/systemPrompt.ts` is a template string. The loop does not store it. The OpenAI adapter sends it on each call, so the new text applies on the next process start.

Step 3 currently says: `Call get_component for each one you will use and haven't read in this chat; read a custom component with get_component like any other.` It does not say to make those reads in one turn. The tree rules in step 4 say only a component whose `children` is `"any"` may have children. The action-wiring rules in step 5 name TextInput, Checkbox, and Select as inputs, and say to use a Select for an input that has choices. They do not say that a boolean property uses Checkbox.

`server/agent/systemPrompt.test.ts` asserts many sentences with `SYSTEM_PROMPT.includes`, including the fragment `read a custom component with get_component like any other.` Those sentences have to stay. The archive-item eval case, added separately, checks for a Checkbox because this prompt says to use one for a boolean.

## Scope

Make three edits in `SYSTEM_PROMPT` and assert them from `server/agent/systemPrompt.test.ts`.

In the step 3 get_component sentence, replace `Call get_component for each one you will use and haven't read in this chat;` with `Call get_component for each one you will use and haven't read in this chat, all in the same turn;` so the sentence still ends with `read a custom component with get_component like any other.`

Add this bullet to the step 4 tree rules: `Omit the children property when a component's children is none. An empty array is dropped.`

Add this bullet to the step 5 action-wiring rules: `Use a Checkbox for a boolean property.`

Leave every other sentence the existing test asserts in place, including the Select-for-choices sentence and `Don't read components you won't use.` This goal edits only `server/agent/systemPrompt.ts` and `server/agent/systemPrompt.test.ts`.

## Acceptance

- `SYSTEM_PROMPT` contains `all in the same turn`.
- `SYSTEM_PROMPT` contains `Omit the children property when a component's children is none. An empty array is dropped.`
- `SYSTEM_PROMPT` contains `Use a Checkbox for a boolean property.`
- `SYSTEM_PROMPT` still contains `read a custom component with get_component like any other.`
- `server/agent/systemPrompt.test.ts` asserts those three new sentences and its current tool-name and ordering checks still pass.

## Validation

- `npm test` exits 0, including `server/agent/systemPrompt.test.ts`.
- `npm run typecheck` exits 0.

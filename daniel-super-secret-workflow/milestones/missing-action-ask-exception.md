---
id: missing-action-ask-exception
priority: 50
depends: []
touches:
  - server/agent/systemPrompt.ts
  - server/agent/systemPrompt.test.ts
scope: small
---

# Treat a missing action as a button, not a question

## Sources

- [Show the button when no action fits — R1](../plans/missing-action-render.md#r1-a-missing-action-is-not-a-question)
- [Show the button when no action fits — Design](../plans/missing-action-render.md#design)
- Local eval logs `eval-logs/2026-10-24T05-53-03.999Z` and `eval-logs/2026-10-24T01-12-26.466Z` (local only)

## Context

`SYSTEM_PROMPT` in `server/agent/systemPrompt.ts` is prepended by `createOpenAILlm` in `server/adapters/openai/OpenAILlm.ts`. The loop does not send it, and it is not stored in history. Chat in `server/index.ts` and `npm run eval` in `server/eval/cli.ts` both pass that same constant.

Step 5 already contains this bullet:

```text
   - Set the Button's action prop to the name of a returned action that fits: one whose description does what the button should do. If no action fits, render the button without an action and say that clicking it won't do anything yet. Do this also when the person names an action list_actions didn't return, or when only a demo or other unrelated action came back: never wire one as a stand-in. A missing action is not a reason to ask a question or to skip render_ui.
```

The Rules section, later in the same prompt, says:

```text
- If the request is unclear in a way that changes the design, ask one short question in everyday words. Otherwise make a reasonable choice and mention it.
```

A separate sentence says that for anything unrelated to UI design, reply in one sentence that you can only help with UI design here. Step 2 says not to call `list_actions` for a mockup, a design without buttons, or buttons that only move around the design.

`server/agent/systemPrompt.test.ts` "renders a button without an action rather than wiring a stand-in or asking" pins the step 5 bullet as a whole line and pins the ask sentence as a substring. That test also asserts the prompt does not contain `demo_echo`. A search for the old ask sentence still passes after the new clause is appended, so the assertion has to require the exception. "names only registered tools in snake_case" treats every snake_case word as a tool name. `list_actions` is registered.

`listActionsTool` in `server/agent/tools/actions.ts` counts a spec with no area or operation as `other`. `demo_echo` in `server/actions/demo.ts` sets neither, so area `any` and operation `other` returns it as an exact match. Menu actions are listed under `others`. `AREA_FALLBACK_NOTE` is added only when `match` is `area`, so this exact match does not tell the model to render without an action. Button's `action` prop in `server/catalog/components.ts` is optional. `collectBindings` in `server/ui/bindings.ts` records a Button only when `props.action` is a string. `bindingProblems` in `server/ui/validateTree.ts` rejects an action string that is not registered.

`REPAIR_REMINDER` in `server/agent/loop.ts` can invite a question, and only after a failed `render_ui` or `define_component`. The failing run never called `render_ui`.

`server/eval/cases/invented-action-name.json` asks for a Download CSV button that runs `export_csv`. Its checks require a reply, no error, a call to `list_actions`, a successful `render_ui`, a `Button`, and `noButtonAction`. The same no-action checks are on `export-pdf`, `sms-no-action`, and `newsletter-no-action`. `mockup-no-action` requires that `list_actions` is not called. `off-topic-refusal` requires a short reply and no design tools. This goal does not edit those cases.

A local run `eval-logs/2026-10-24T05-53-03.999Z` (local only) called `list_actions` for `invented-action-name`, then asked what to try, including a demo, and never called `render_ui`. The same run passed `export-pdf` by rendering a Button with no action. An earlier local run `eval-logs/2026-10-24T01-12-26.466Z` (local only) passed `invented-action-name` that way. This goal does not read or edit those logs.

## Scope

Replace only the Rules question bullet with:

```text
- If the request is unclear in a way that changes the design, ask one short question in everyday words. Otherwise make a reasonable choice and mention it. A button that should do something, when list_actions returned no action whose description does that, is not unclear: render the button without an action and say that clicking it won't do anything yet, instead of asking.
```

Leave the step 5 bullet character for character, including "A missing action is not a reason to ask a question or to skip render_ui." Leave the one-sentence off-topic refusal and the step 2 sentence that skips `list_actions` for a mockup. Do not add `demo_echo` to the prompt. Do not add a snake_case word that is not a registered tool.

`demo_echo` coming back as the exact match for operation `other` is not a fitting action: its description does not do what a Download CSV button should do. The new clause applies only after `list_actions` has returned and no returned description does what the button should do. An unclear request that has not reached that point still gets one short question.

Do not edit the loop, `REPAIR_REMINDER`, `listActionsTool`, the catalog, `collectBindings`, `bindingProblems`, or any eval case.

In "renders a button without an action rather than wiring a stand-in or asking", require the replacement bullet, including "is not unclear" and "instead of asking". Matching the old ask sentence alone must not satisfy the test. Keep the assertion of the unchanged step 5 bullet and the absence of `demo_echo`.

## Acceptance

- The Rules bullet in `SYSTEM_PROMPT` is the replacement string in Scope.
- The step 5 bullet stays the string quoted in Context.
- The opening "ask one short question in everyday words" stays, for a request that is unclear in a way that changes the design and is not this missing-action case.
- The one-sentence refusal for anything unrelated to UI design stays.
- The step 2 sentence that skips `list_actions` for a mockup, a design without buttons, and buttons that only move around the design stays.
- The prompt does not contain `demo_echo`.
- "names only registered tools in snake_case" passes. The new sentence's only snake_case word is `list_actions`.
- "renders a button without an action rather than wiring a stand-in or asking" fails when "is not unclear" or "instead of asking" is absent.

## Validation

- `npm test` exits 0. Database-backed suites skip when `DATABASE_URL` is unset. The tests this goal changes do not need it.
- `npm run typecheck` exits 0.

## After merge

- Run `npm run eval` with `OPENAI_API_KEY` and compare `invented-action-name` with local log `eval-logs/2026-10-24T05-53-03.999Z` (local only). One run can still miss; the unit test is the contract.
- On that same run, `export-pdf`, `sms-no-action`, and `newsletter-no-action` should still render a button with no action.
- On that same run, `mockup-no-action` should still skip `list_actions`.
- On that same run, `off-topic-refusal` should still answer with no design tools.

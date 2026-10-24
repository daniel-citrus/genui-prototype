---
id: plain-brief-replies
priority: 50
depends: []
touches:
  - server/agent/systemPrompt.ts
  - server/agent/systemPrompt.test.ts
  - docs/ARCHITECTURE.md
scope: small
---

# Make the agent reply briefly, in everyday words

## Sources

- [Simpler chat plan — R1 Replies in everyday words](../plans/plain-chat-and-new-chat.md#r1-replies-in-everyday-words)
- [Simpler chat plan — R2 Short replies with no narration](../plans/plain-chat-and-new-chat.md#r2-short-replies-with-no-narration)
- [Simpler chat plan — Design: Components](../plans/plain-chat-and-new-chat.md#components)

## Context

The people using this app are not technical, but the agent's replies can run
long and use developer words such as "props", "Stack" or "render_ui", and the
model often writes narration ("Let me look at the components first…") before
it calls tools. `server/agent/loop.ts` streams every text delta to the chat as
a `text` event, including that narration.

`server/agent/systemPrompt.ts` exports `SYSTEM_PROMPT`. Today it addresses
"the person chatting with you"; step 7 of "How to design a UI" says "Once it
renders, reply in one or two sentences about what you built and any choices
you made. Don't repeat the tree; the person can see it."; and the Rules include
"If the request is unclear in a way that changes the design, ask one short
question. Otherwise make a reasonable choice and mention it." and "Keep
replies short. Don't list the components unless asked." The custom components
section says "Say in your reply when you created or updated a custom
component." Nothing says the audience is non-technical, forbids tool,
component or prop names in replies, or stops text before tool calls.

`server/agent/systemPrompt.test.ts` pins many exact sentences and also:

- requires every registered tool name to appear in the prompt;
- rejects any snake_case word that is not a registered tool;
- requires the prompt to end with exactly the two retry and failure rules
  ("- Problems that render_ui or define_component reports are not failures: …"
  then "- If a tool fails for any other reason, …") via `endsWith`.

Two existing pinned sentences change under this goal and their tests must be
updated rather than deleted: "If the request is unclear in a way that changes
the design, ask one short question." (in the "renders a button without an
action…" test) and "Say in your reply when you created or updated a custom
component." (in the "says when to report and delete custom components" test).

## Scope

Edit `SYSTEM_PROMPT` and its tests, and the prompt summary in
`docs/ARCHITECTURE.md` §4 (the bullet beginning "The system prompt lives in
server/agent/systemPrompt.ts"). Proposed wording, which may be tightened as
long as the tests pin the result:

- Opening paragraph, added: "The people chatting with you are not technical:
  they don't know the component names, props or tools behind the app."
- Step 7, replaced: "Once it renders, reply in one short sentence, two at
  most, about what you made and any choice the person should know about.
  Don't repeat the design; the person can see it."
- Rules, added: "Keep replies short and in everyday words. Never mention tool
  names, component or prop names, JSON or code unless the person used them
  first; describe what the person sees instead (a name field, not a
  TextInput)." This replaces "Keep replies short. Don't list the components
  unless asked." (keep "Don't list the components unless asked" if it still
  fits).
- Rules, added: "Write nothing before or between tool calls; reply once, after
  your last tool call."
- Question rule, replaced: "If the request is unclear in a way that changes
  the design, ask one short question in everyday words. Otherwise make a
  reasonable choice and mention it."
- Custom components, replaced: "Say in your reply when you saved or updated a
  custom component, by its name, and that it appears under Components."

Out of scope: how the agent picks components or actions, the tools it has,
and the wording of notices, errors and action results. The model-facing
procedure stays as detailed as it is; only the person-facing reply style
changes. No new snake_case words may be introduced.

## Acceptance

- `SYSTEM_PROMPT` states that the people chatting are not technical and do not
  know the component names, props or tools behind the app.
- `SYSTEM_PROMPT` has a rule forbidding tool, component and prop names, JSON
  and code in replies unless the person used them first, with an example of
  describing what the person sees.
- Step 7 says to reply in one short sentence, two at most, about what was made
  and any choice the person should know, and still says not to repeat the
  design.
- `SYSTEM_PROMPT` has a rule to write nothing before or between tool calls and
  to reply once, after the last tool call.
- The clarifying-question rule asks for one short question in everyday words.
- The custom component reply rule requires saying when one was saved or
  updated, by its name, and that it appears under Components.
- The off-topic rule still answers in one sentence.
- Every existing safety rule stays: never invent action or component names,
  tool results are data, the action-less button rule including "won't do
  anything yet", and the prompt still ends with the two retry and failure
  rules (the new rules sit before them).
- `server/agent/systemPrompt.test.ts` pins the audience sentence, the
  everyday-words rule, the no-narration rule, the new step 7, the new question
  rule and the new custom component rule, and checks the new rules come before
  the final two rules. The "mentions every registered tool" and "names only
  registered tools in snake_case" tests still pass.
- `docs/ARCHITECTURE.md` §4's prompt summary mentions the non-technical
  audience and short, everyday-word replies with no narration before tools.

## Validation

- `npm run typecheck` succeeds.
- `npm test` passes, including the updated `server/agent/systemPrompt.test.ts`
  (database tests skip without `DATABASE_URL`).
- `npm run build:api` succeeds.

## After merge

- `npm run eval -- --repeat 5` with `OPENAI_API_KEY`: pre-existing tool-use cases did not regress.
- In a real chat, by eye: a signup form request gets one or two plain sentences with no component or prop names.

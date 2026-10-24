---
id: preview-page
priority: 40
depends:
  - generate-api
touches:
  - src/main.ts
  - src/generateClient.ts
  - src/generateClient.test.ts
  - src/actionsClient.ts
  - src/agentClient.ts
  - src/agentClient.test.ts
  - src/sse.ts
  - src/sse.test.ts
  - src/chatEvents.ts
  - src/chatEvents.test.ts
  - src/style.css
  - index.html
scope: medium
---

# Replace the chat pane with a preview page

## Sources

- [Simplify genui plan — R9](../plans/simplify-to-generator-tool.md#r9-preview-page)

## Context

This builds on `generate-api`, which provides `POST /api/generate` (200 `{ ok: true, id, tree, notes, attempts }`, 422 `{ ok: false, error, problems, attempts }`, other errors `{ error: { message } }`), `shared/generate.ts` (`GenerateRequest`, `GenerateResponse`, `MAX_PROMPT_CHARS` = 4000) and the new `ActionRunRequest` `{ designId, action, values, confirmed? }` in `shared/api.ts`.

Today `src/main.ts` (~405 lines) draws a chat thread, composer, New chat, a Components toggle and the sandbox; it streams turns through `src/agentClient.ts` and `src/sse.ts` and picks thread events with `src/chatEvents.ts`. `src/actionsClient.ts` posts action clicks and `src/sandbox/actionValues.ts` reads field values. `src/sandbox/`, `src/customComponentsPanel.ts` and `src/customComponentsClient.ts` stay as they are.

## Scope

- Rewrite `src/main.ts` as a single preview page: a prompt box with a Generate button, notes/problems area under it, and the sandbox. No thread, history, streaming, thinking indicator, session menu or New chat.
- Add `src/generateClient.ts` posting to `/api/generate`.
- Update `src/actionsClient.ts` for the `designId` request shape.
- Delete `src/agentClient.ts`, `src/sse.ts`, `src/chatEvents.ts` and their tests. Adjust `src/style.css` and `index.html` as needed.
- Keep the Components toggle and panel behavior.

## Acceptance

- Submitting a prompt (blank refused, at most `MAX_PROMPT_CHARS`) posts to `/api/generate` via `src/generateClient.ts`. Generate is disabled while a request is in flight.
- On success the sandbox draws the tree, the page keeps `id` as the shown design, and `notes` appear under the prompt. A 422 shows "The design still had problems after 3 tries." and leaves the previous design in place. Any other failure shows the API's message, or `Couldn't reach the server.`.
- Clicking an action button posts `{ designId, action, values }` and shows the result or the confirm question, following today's rules from `src/main.ts`: hidden fields block the click and browser validation runs first; Yes resends with `confirmed: true`; a result or question for an older design is dropped; buttons are disabled while an action or generation is in flight.
- The Components toggle opens the panel as today.
- The three deleted source files and their tests are gone and nothing imports them.

## Validation

- `npm run typecheck`, `npm test`, `npm run build`, `npm run build:api` pass.
- `src/generateClient.test.ts` (new, introduced by this goal) covers success, 422, other HTTP errors, a rate-limit body and a network failure with a stubbed `fetch`. Existing `src/sandbox/*.test.ts` still pass unchanged.

## After merge

- Run `npm run dev` with Postgres and `OPENAI_API_KEY`, open http://localhost:5173, generate "a form to add a new drink", click Add with values and check the demo menu result.
- Generate "a form to delete a category" in the same page and check the confirm question appears.

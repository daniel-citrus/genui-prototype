---
id: message-length
priority: 50
depends:
  - app-factory
touches:
  - shared/api.ts
  - src/main.ts
  - server/routes/agent.ts
  - server/routes/agent.test.ts
  - server/app.test.ts
scope: small
---

# Cap chat messages at 4,000 characters and request bodies at 32 KB

## Sources

- [Request limits plan: R1, R2, R3, R6](./request-limits.md#r1-chat-box-length-cap)

## Context

A chat message can be any size today. It is sent to OpenAI as-is and stays in the conversation's history, so every later turn pays for it again.

- `server/routes/agent.ts` (`POST /chat` under `/api/agent`) requires a non-empty `conversationId` and a non-blank `message`. Otherwise it answers 400 `{ error: { message: "conversationId and message are required" } }`. It then calls `runAgent(message.trim(), …)`. The route has no length check and no `bodyLimit`, so Fastify's 1 MB default applies.
- `shared/api.ts` holds the wire contract shared by browser and server, and currently exports only types.
- `src/main.ts` renders the composer `<textarea name="message">` inside its `app.innerHTML` template.
- `src/agentClient.ts` already shows `error.message` from any non-OK JSON response as an error line, so the browser needs no new error handling.

This builds on `app-factory`, which provides `buildApp(deps)` in `server/app.ts`, the real app with the custom JSON parser and the error handler. The error handler sends `{ error: { code, message } }` for status below 500. Use it for tests of the final response bodies.

Fastify 5.12.6 applies a route's `bodyLimit` ahead of the custom parser's limit (`node_modules/fastify/lib/route.js:381`, `content-type-parser.js:247`). A larger body fails with `FST_ERR_CTP_BODY_TOO_LARGE`, a 413, before parsing.

The `ip-rate-limit` goal runs in parallel and adds `config: { rateLimit: {} }` to the same route options object. Keep your change to that object small so a rebase is trivial.

## Scope

- `shared/api.ts`: add `export const MAX_MESSAGE_CHARS = 4000;` (additive). The esbuild API bundle inlines `shared/*` imports, which was checked with the repo's `build:api` flags, so a value import is safe on the server.
- `src/main.ts`: set the textarea's `maxlength` from `MAX_MESSAGE_CHARS` (import the value from `shared/api`).
- `server/routes/agent.ts`:
  - After the existing required-fields check, trim the message. If `trimmed.length > MAX_MESSAGE_CHARS`, answer 400 `{ error: { message: \`Message is too long (max ${MAX_MESSAGE_CHARS} characters).\` } }` before any SSE headers are written.
  - Add `bodyLimit: 32 * 1024` (name the constant, for example `CHAT_BODY_LIMIT_BYTES`) to the chat route's options.
- Length is `string.length` (UTF-16 code units), the same unit as the textarea's `maxlength`, so anything the box accepts passes the server. An emoji counts as 2.

## Acceptance

- A message whose trimmed length is exactly 4,000 streams normally.
- A trimmed length of 4,001 gets a 400 with `error.message` "Message is too long (max 4000 characters)." and the fake LLM is never called.
- Leading and trailing whitespace that pushes the raw length past 4,000 doesn't trigger the 400.
- A message of 2,000 emoji (4,000 UTF-16 units) passes.
- A request body over 32 KB gets a 413 whose JSON `error.message` is a string, through `buildApp`.
- A 4,000-character message of 4-byte UTF-8 characters fits under the body limit and is accepted. Use characters that are 2 UTF-16 units each, so the 4,000 limit still holds.
- `GET /api/health` and any other route keep Fastify's default body limit.
- The chat textarea has `maxlength="4000"`.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, with new cases in `server/routes/agent.test.ts` (length boundaries, fake LLM) and `server/app.test.ts` (413 and 400 bodies through `buildApp`).
- `npm run build` and `npm run build:api` succeed.

## After merge

- In the running app, typing or pasting more than 4,000 characters into the chat box stops at 4,000.

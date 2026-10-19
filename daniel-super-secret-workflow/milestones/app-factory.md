---
id: app-factory
priority: 10
depends: []
touches:
  - server/app.ts
  - server/app.test.ts
  - server/index.ts
scope: small
---

# Build the API's Fastify app in a testable factory

## Sources

- [Request limits plan: R6, Design (Components, Interfaces), Assumptions](./request-limits.md#r6-testable-app-with-the-real-error-shape)

## Context

`server/index.ts` does everything at the top level:

- It creates `Fastify({ logger: { level: config.logLevel } })`.
- It adds a custom `application/json` content-type parser (`parseAs: "string"`, which turns an empty or whitespace-only body into `undefined` instead of failing).
- It sets an error handler. The handler sends `{ error: { code: "repository", message } }` with `err.statusCode`, defaulting to 500. At 500 and above it logs the error and replaces the message with "Internal server error".
- It builds the database and OpenAI adapters, decorates `app.components` (nothing reads it), registers `healthRouter` at `/api/health` and `agentRouter` at `/api/agent`, runs migrations and the seed in production, calls `listen`, and closes on SIGINT and SIGTERM.

Because the file listens at import time, tests can't use it. `server/routes/agent.test.ts` builds a bare `Fastify()` with only `agentRouter`, so no test sees the real parser or error handler. The browser (`src/agentClient.ts`) shows `error.message` from any non-OK JSON response. Later goals add a message-length check, a body limit and a rate limit, and they need to test the final bodies through the real app.

This goal is a pure move with no behavior change. Later goals extend `AppDeps` additively: `ip-rate-limit` adds `trustProxy` and `rateLimit`, and `redis-store` adds `redis`.

## Scope

- Add `server/app.ts`:

  ```ts
  export interface AppDeps {
    /** Pino level; omit to disable logging (tests). */
    logLevel?: string;
    llm?: AgentLlm;
    tools: ToolRegistry;
    pingDb?: () => Promise<boolean>;
  }
  export async function buildApp(deps: AppDeps): Promise<FastifyInstance>;
  ```

  `buildApp` creates the instance (with `logger: { level }` when `logLevel` is set, otherwise `logger: false`). It adds the JSON parser and the error handler moved verbatim from `server/index.ts`, then registers `healthRouter` (prefix `/api/health`, `pingDb`) and `agentRouter` (prefix `/api/agent`, `llm`, `tools`). It doesn't listen, migrate, seed, decorate or handle signals.
- `server/index.ts` calls `buildApp` with the real adapters and `config.logLevel`. It keeps everything else: adapter wiring, the `components` decoration, the `onClose` that closes the database, the production migrate and seed with `failStartup`, `listen`, the ready log line, and the signal handlers.
- Keep the error body exactly as it is, including `code: "repository"`. Changing it is out of scope.

## Acceptance

- `buildApp` returns an app that answers `GET /api/health` with `{ ok: true, db, agent }`, where `db` comes from `pingDb`.
- Through `buildApp`, `POST /api/agent/chat` with an empty JSON body gets 400 `{ error: { message: "conversationId and message are required" } }`. The custom parser accepts empty bodies.
- Through `buildApp`, malformed JSON gets a 4xx JSON body whose `error.message` is a string.
- A route that throws a plain `Error` gets 500 with `error.message` "Internal server error". Test this by registering a throwing route on the returned app before `ready()`.
- `npm run dev:api` and the production image start and serve exactly as before: same routes, same startup logs, same migrate and seed in production.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including the new `server/app.test.ts` (fake `llm` and `pingDb` with `app.inject`; no database needed).
- `npm run build:api` succeeds.

## After merge

- `npm run dev` then `curl -s localhost:5173/api/health` shows `{"ok":true,"db":true,"agent":true}` and a chat turn still streams in the browser.

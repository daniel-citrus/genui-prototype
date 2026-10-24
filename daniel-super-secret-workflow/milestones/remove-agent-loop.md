---
id: remove-agent-loop
priority: 50
depends:
  - generate-api
  - eval-harness
  - preview-page
touches:
  - server/agent
  - server/routes/agent.ts
  - server/routes/agent.test.ts
  - server/ports/AgentLlm.ts
  - server/ports/TraceRepository.ts
  - server/ports/fakes/InMemoryTraceRepository.ts
  - server/ports/fakes/InMemoryTraceRepository.test.ts
  - server/adapters/openai/OpenAILlm.ts
  - server/adapters/openai/OpenAILlm.test.ts
  - server/adapters/traces
  - server/app.ts
  - server/app.test.ts
  - server/index.ts
  - server/config.ts
  - server/routes/health.ts
  - server/routes/health.test.ts
  - shared/api.ts
  - drizzle.traces.config.ts
  - docker/postgres/init-traces.sql
  - docker-compose.yml
  - Dockerfile.api
  - nginx.conf
  - package.json
  - .env.example
  - .github/workflows/ci.yml
scope: large
---

# Remove the chat agent, conversations and turn traces

## Sources

- [Simplify genui plan — R10](../plans/simplify-to-generator-tool.md#r10-remove-the-chat-agent-and-turn-traces)

## Context

By now `generate-api` added `POST /api/generate` and the design store, `eval-harness` moved the eval onto `generateComponent`, and `preview-page` replaced the chat UI. Nothing should import `server/agent/` any more except the agent route itself. This goal deletes what only the chat window needed. Verify with `git grep` that no code outside the to-be-deleted files imports from `server/agent/` before deleting; if something still does, port it rather than leaving the agent in place.

The `genui_traces` database holds agent-loop turn traces; its code is `server/adapters/traces/` (client, `ensureDatabase`, migrations, `DrizzleTraceRepository`), `server/ports/TraceRepository.ts`, an in-memory fake, `drizzle.traces.config.ts`, `docker/postgres/init-traces.sql`, config `TRACE_DATABASE_URL`, and scripts `db:migrate:traces` / `db:generate:traces`. `server/index.ts` migrates both databases in production and ensures `genui_traces`. `ToolLogger` (from `server/agent/tools.ts`) is aliased to `Logger` in `server/log.ts`. `nginx.conf` turns buffering off for SSE and sets `proxy_read_timeout 300s`; `Dockerfile.api` copies both migration folders.

## Scope

- Delete `server/agent/`, `server/routes/agent.ts`, `server/ports/AgentLlm.ts`, `server/adapters/openai/OpenAILlm.ts` and their tests; drop agent route registration (`/api/agent/chat` and `DELETE /api/agent/conversations/:id` now answer 404).
- Delete the traces code: `server/ports/TraceRepository.ts`, its fake and the fake's test, `server/adapters/traces/` (including its migrations folder), `drizzle.traces.config.ts`, `docker/postgres/init-traces.sql`.
- Remove `ToolCall`, `ToolResult`, `AgentChatRequest`, `AgentEvent` and `MAX_MESSAGE_CHARS` from `shared/api.ts`.
- Remove `TRACE_DATABASE_URL`, `db:migrate:traces`, `db:generate:traces` from config, `package.json`, `.env.example`, `docker-compose.yml`, `Dockerfile.api` and CI (including any CI step that migrates traces).
- Remove the `ToolLogger` alias; use `Logger` from `server/log.ts` everywhere.
- Health answers `{ ok, db, agent }` (drop `traces`).
- Production startup migrates and seeds the `genui` database only.
- Remove the SSE-specific buffering settings from `nginx.conf` (keep a sensible proxy timeout for the 90-second generate call).

## Acceptance

- All listed paths are gone; `/api/agent/*` routes answer 404.
- `git grep -e conversationId -e AgentEvent -e TRACE_DATABASE_URL -- server src shared` finds nothing.
- Health is `{ ok, db, agent }`.
- Production startup (`server/index.ts`) neither creates, migrates nor reads `genui_traces`.
- `Logger` replaces `ToolLogger` everywhere.

## Validation

- `npm run typecheck`, `npm test`, `npm run build`, `npm run build:api` pass.
- `server/app.test.ts` (updated by this goal) checks health is `{ ok, db, agent }` and that agent routes answer 404.

## After merge

- Run `docker compose up web --build` and check the API starts with no `redis` or `genui_traces` and health shows `{"ok":true,"db":true,"agent":true}`.

---
id: traces-loop
priority: 30
depends:
  - traces-port
  - traces-database
scope: medium
touches:
  - server/agent/run.ts
  - server/agent/run.test.ts
  - server/agent/loop.ts
  - server/agent/loop.test.ts
  - server/agent/conversations.ts
  - server/agent/conversations.test.ts
  - server/agent/tools.ts
  - server/agent/registry.test.ts
  - server/agent/tools/ui.test.ts
  - server/agent/tools/customComponents.test.ts
  - server/agent/tools/components.test.ts
  - server/agent/tools/menuTools.test.ts
  - server/agent/tools/actions.test.ts
  - server/actions/registry.test.ts
  - server/actions/menu/menu.test.ts
  - server/actions/demo.test.ts
  - server/routes/agent.ts
  - server/routes/agent.test.ts
  - server/routes/health.ts
  - server/routes/health.test.ts
  - server/app.ts
  - server/app.test.ts
  - server/index.ts
  - server/routes/customComponents.test.ts
  - server/routes/actions.test.ts
  - server/rateLimit.test.ts
  - server/rateLimit.redis.test.ts
  - server/adapters/redis/client.test.ts
---

# Write traces through the port and drop in-memory storage

## Sources

- [Trace db plan — R3](../plans/trace-db.md#r3-loop-writes-traces-through-the-port)
- [Trace db plan — R4](../plans/trace-db.md#r4-in-memory-traces-removed)
- [Trace db plan — R5](../plans/trace-db.md#r5-health-reports-the-traces-database)
- [Trace db plan — traces-loop](../plans/trace-db.md#work-breakdown)

## Context

This builds on `traces-port` (`TraceRepository`, `MAX_TRACES_PER_CONVERSATION`, `InMemoryTraceRepository`) and `traces-database` (`createTracesDb`, traces `runMigrations` / ensure, `DrizzleTraceRepository`, `config.traceDatabaseUrl`, distinct-URL helper). Workers start from the base after those files are in `milestones/`; import those symbols rather than recreating them.

Today `server/agent/loop.ts` `runTurn` builds an `AgentTrace` and in `finally` calls `rememberTrace(conversationId, trace)` from `server/agent/conversations.ts`. That module's `Conversation` has `history`, `designs`, and `traces`. `getTraces` is used only by `server/agent/loop.test.ts` and `server/agent/conversations.test.ts`. There is no traces HTTP route; do not add one.

`AgentRun` in `server/agent/run.ts` is `{ emit, conversationId, signal, tools, log, resume? }`. `server/routes/agent.ts` constructs it and calls `runAgent`. Tests build `AgentRun` in `loop.test.ts` (`makeRun`) and `run.test.ts`.

`ToolLogger` in `server/agent/tools.ts` is `{ info, debug, error }`. Fastify `req.log` already has `warn`. Save failures must be logged with `warn`, without `userText`, completions, or UI trees. Add `warn` to `ToolLogger` with the same signature as `info`, and add empty `warn` on existing test stubs so typecheck passes.

Health (`server/routes/health.ts`) returns `{ ok, db, agent, redis }`. `db` is false when `pingDb` is omitted or throws; `redis` is `null` when `pingRedis` is omitted (optional). Traces storage is expected: omitting `pingTraces` must report `traces: false`, not `null`. `server/app.ts` `AppDeps` / `buildApp` pass health pings through. `server/index.ts` builds real adapters, calls `buildApp`, and in production runs catalog migrate then seed and `failStartup` / `process.exit(1)` on failure. Development starts without Postgres. Close the traces pool on app close like the catalog pool.

Chat, SSE events, guardrails, and conversation history/designs stay as they are. A failed trace write must not change events or prevent `done`.

`AppDeps.traces` is required so production cannot silently keep an in-memory store. Every `buildApp` caller must pass a `TraceRepository` (`InMemoryTraceRepository` in tests, `DrizzleTraceRepository` in `index.ts`). `pingTraces` stays optional (omit → `traces: false`). `server/routes/agent.ts` puts `deps.traces` on `AgentRun`; `agent.test.ts` passes the fake.

## Scope

- Add `traces: TraceRepository` to `AgentRun`. In `loop.ts` `finally`, `await run.traces.save(trace)` inside try/catch; on rejection `run.log.warn` with `conversationId` (and `err` if useful) and no `userText`, completions, or UI trees. Then keep today's `run.emit = baseEmit` and the counts-only info log.
- Remove `traces` from the conversation object; delete `rememberTrace`, `getTraces`, and `MAX_TRACES_PER_CONVERSATION` from `conversations.ts`. Conversation LRU and `resetConversation` no longer affect stored traces.
- Loop tests: `makeRun` supplies `InMemoryTraceRepository`; read traces with `run.traces.listByConversation`, not `getTraces`. Add a case where `save` rejects: SSE events match a successful turn, and the warn object has `conversationId` but not `userText`.
- Drop the `rememberTrace` / `getTraces` describe in `conversations.test.ts` (cap lives on the fake and Drizzle adapter). Keep history/design LRU tests; they must not assert about traces.
- `HealthOptions` / `AppDeps`: add `pingTraces?: () => Promise<boolean>`. `GET /api/health` includes `traces: boolean` (true on success, false on fail, throw, or omit).
- Production `index.ts`: after catalog migrate/seed, ensure `genui_traces` then run traces migrations; failure uses existing `failStartup`. Construct `DrizzleTraceRepository` from `createTracesDb(config.traceDatabaseUrl)` after the distinct-URL check; pass it into the agent run and `pingTraces: tracesDb.ping`. Development still listens if traces Postgres is down. Do not import catalog tables into the traces adapter.
- No SSE or chat body change. Writes fail open.

## Acceptance

- Existing loop trace assertions pass against `run.traces.listByConversation` on an `InMemoryTraceRepository`.
- When `save` rejects, the turn still emits the same events as a successful save (including `done` from the route) and logs a warning whose object includes `conversationId` and does not include `userText`.
- The conversation type/object has `history` and `designs` only. No production import of `rememberTrace` or `getTraces`.
- `resetConversation` and LRU eviction of a conversation do not delete rows in a `TraceRepository` (loop tests / fake: traces remain on the repo after `resetConversation`).
- `GET /api/health` body is `{ ok, db, agent, redis, traces }` with `traces` boolean; omit `pingTraces` → `traces: false`; ping false or throw → `traces: false`; ping true → `traces: true`. `redis` remains `null` when omitted.
- Production startup still exits 1 when traces migrations fail. Development chat still starts when the traces database is down.
- `rememberTrace` and `getTraces` do not appear in production `server/` sources (test files may mention them only if deleted).

## Validation

- `npm test` exits 0 (loop via the fake, conversations without traces, health `traces` true/false/throw/omit). Drizzle cases skip unless `TRACE_DATABASE_URL` is set.
- `npm run typecheck` exits 0.
- `npm run build` and `npm run build:api` exit 0.
- `grep -R --include='*.ts' rememberTrace server` and the same for `getTraces` print no production paths (only `.test.ts` if anything).

## After merge

- Production image/start still exits 1 if traces migrations fail (Compose `api` with traces Postgres stopped or URL pointing at a missing DB).
- With traces Postgres down in development, `npm run dev` still serves chat; `curl -s localhost:5173/api/health` shows `"traces":false`.

# Persist agent turn traces in their own Postgres database

**Branch:** trace-db · **Written:** 2026-10-21 · **Supersedes:** -

## Summary

Each finished chat turn already builds a structured trace, but it lives only in the API process, next to conversation history, and vanishes on restart. That is too short-lived for later eval work, and the architecture diagram still treats traces as an afterthought inside the in-memory store. This plan moves traces into a second Postgres database on the same instance, keeps the last five per conversation, and draws that store on the system diagram. Chat, history, and designs stay as they are. It worked when a finished turn can be read back from the traces database after the API restarts, and the diagram shows a traces database separate from the catalog.

- **In scope:** a traces Postgres database and Drizzle schema; a `TraceRepository` port; writing traces from the agent loop; dropping in-memory traces; health and architecture updates.
- **Out of scope:** an HTTP or UI for traces; a second Postgres container; changing SSE events, guardrails, or conversation history; an eval harness.
- **Open decisions:** none (see [Open decisions](#open-decisions))

### Behavior before

```mermaid
sequenceDiagram
  actor User
  participant Browser
  participant Loop as Agent loop
  participant Store as Conversations store
  User->>Browser: sends a chat message
  Browser->>Loop: POST /api/agent/chat
  Loop->>Store: append history and designs
  Loop-->>Browser: SSE text, tool, and ui events
  Loop->>Store: append this turn's trace
```

### Behavior after

```mermaid
sequenceDiagram
  actor User
  participant Browser
  participant Loop as Agent loop
  participant Store as Conversations store
  participant Traces as Traces database
  User->>Browser: sends a chat message
  Browser->>Loop: POST /api/agent/chat
  Loop->>Store: append history and designs
  Loop-->>Browser: SSE text, tool, and ui events
  alt traces database accepts the write
    Loop->>Traces: append this turn's trace
  else traces database is down or the write fails
    Loop->>Loop: log a warning, still finish the turn
  end
```

### Architecture before

```mermaid
flowchart LR
  Loop["Agent loop"] --> Convos["Conversations store"]
  Convos --> MemTraces[("Turn traces in memory")]
  Loop --> CatalogDb["Drizzle adapter"]
  CatalogDb --> PG[("Postgres genui")]
```

### Architecture after

```mermaid
flowchart LR
  Loop["Agent loop (changed)"] --> Convos["Conversations store (changed)"]
  Loop --> TracePort["TraceRepository port (new)"]
  TracePort --> TracesAdapter["Drizzle traces adapter (new)"]
  TracesAdapter --> TracesDb[("Postgres genui_traces (new)")]
  Loop --> CatalogDb["Drizzle adapter"]
  CatalogDb --> PG[("Postgres genui")]
```

### What changes

- Turn traces leave the in-memory conversation store and go to database `genui_traces`.
- The agent loop writes through a `TraceRepository`; a failed write does not fail the chat turn.
- History and designs stay in process memory; they still vanish on restart.
- The architecture overview shows the traces database beside the catalog database.

---

## Current state

Turn traces already exist as `AgentTrace` in [server/agent/trace.ts](../../server/agent/trace.ts). [server/agent/loop.ts](../../server/agent/loop.ts) fills one per `runTurn` and, in `finally`, calls `rememberTrace` from [server/agent/conversations.ts](../../server/agent/conversations.ts). That module holds a process-wide `Map` of conversations; each entry has `history`, `designs`, and `traces`. `MAX_TRACES_PER_CONVERSATION` is 5. `getTraces` is used by [server/agent/loop.test.ts](../../server/agent/loop.test.ts) and [server/agent/conversations.test.ts](../../server/agent/conversations.test.ts). There is no HTTP route for traces.

Postgres today is one database, `genui`, via `DATABASE_URL` in [server/config.ts](../../server/config.ts) (default `postgres://genui:genui@localhost:5432/genui`). [server/index.ts](../../server/index.ts) builds one `createDb` from [server/adapters/db/client.ts](../../server/adapters/db/client.ts), wires `DrizzleComponentRepository` and `DrizzleCustomComponentRepository` against [server/adapters/db/schema.ts](../../server/adapters/db/schema.ts), and in production runs [server/adapters/db/migrate.ts](../../server/adapters/db/migrate.ts) then the catalog seed. The API starts in development without Postgres. Health is `{ ok, db, agent, redis }` in [server/routes/health.ts](../../server/routes/health.ts); `db` pings that one pool.

Compose [docker-compose.yml](../../docker-compose.yml) has one `db` service (`POSTGRES_DB=genui`). Drizzle kit uses [drizzle.config.ts](../../drizzle.config.ts). Production image copies only `server/adapters/db/migrations` ([Dockerfile.api](../../Dockerfile.api)). Ports follow [server/ports/CustomComponentRepository.ts](../../server/ports/CustomComponentRepository.ts) plus in-memory fakes in `server/ports/fakes`. [server/agent/run.ts](../../server/agent/run.ts) `AgentRun` is what [server/routes/agent.ts](../../server/routes/agent.ts) passes into `runAgent`.

The §1 diagram in [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) shows conversations as "last designs (in memory)" and one Postgres cylinder for catalog tables. §4 and §5 already describe in-memory traces.

**Checks:** `npm run typecheck`, `npm test`, `npm run build`, `npm run build:api` ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)). Database tests skip unless `DATABASE_URL` is set. **New:** `npm run db:generate:traces`, `npm run db:migrate:traces`.

## Requirements

### R1: Separate traces database

The traces store MUST be Postgres database `genui_traces` on the same instance as `genui`, reached only through `TRACE_DATABASE_URL`, never through `DATABASE_URL`. Startup and migrate MUST refuse when the two URLs name the same database. The catalog schema MUST NOT gain a traces table.

**Acceptance:**

- Default `TRACE_DATABASE_URL` is `postgres://genui:genui@localhost:5432/genui_traces`.
- Connecting the traces client to `DATABASE_URL` / `genui` is refused (startup or migrate exits with a clear error).
- `CREATE DATABASE genui_traces` is applied for a fresh Compose volume and can be applied to an existing volume without dropping `genui`.

### R2: Last five traces per conversation, durable

`TraceRepository.save` MUST persist the `AgentTrace` and keep at most five rows per `conversationId` (oldest dropped). `listByConversation` MUST return the remaining traces oldest first. Rows MUST survive API restart and in-memory conversation eviction or `resetConversation`.

**Acceptance:**

- Sixth save for one conversation leaves five traces; the oldest `userText` is gone.
- After recreating the traces client (new pool), `listByConversation` still returns those rows.
- Forgetting or resetting the in-memory conversation does not delete traces rows.

### R3: Loop writes traces through the port

`runTurn` MUST call `TraceRepository.save` in `finally` instead of `rememberTrace`. A save failure MUST NOT change SSE events or prevent `done`. The failure MUST be logged without `userText`, completions, or UI trees.

**Acceptance:**

- Existing loop tests pass against an in-memory `TraceRepository` and read traces from it, not from `getTraces`.
- When `save` rejects, the turn still emits the same events as today and logs a warning with `conversationId` only among trace fields.

### R4: In-memory traces removed

[server/agent/conversations.ts](../../server/agent/conversations.ts) MUST stop storing traces. `rememberTrace` and `getTraces` MUST go away.

**Acceptance:**

- The conversation object has `history` and `designs` only.
- No production import of `rememberTrace` or `getTraces`.
- Conversation LRU and `resetConversation` tests no longer assert about traces.

### R5: Health reports the traces database

`GET /api/health` MUST include `traces`, a boolean, by pinging the traces pool the same way `db` pings the catalog pool. Chat MUST still start when the traces database is down (development already starts without catalog Postgres).

**Acceptance:**

- Health is `{ ok, db, agent, redis, traces }`; `traces` is `false` when the ping fails or throws, `true` when it succeeds.
- Omitting `pingTraces` reports `traces: false` (traces storage is expected, unlike optional Redis).
- Production still exits 1 if traces migrations fail on start.

### R6: Architecture diagram matches storage

[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) §1 MUST show the traces database as its own store, reached through a traces port/adapter, not as part of the in-memory conversation map or the catalog database. §3 health, §4 recording, §5 data, §7 config, §8 layout, and §10 limits MUST match R1–R5.

**Acceptance:**

- The §1 mermaid graph has a Postgres cylinder for traces, separate from `components` / `custom_components`.
- Conversations in that graph are history and designs only.
- §5 says traces live in `genui_traces`, last five per conversation, survive restart, not exposed over HTTP.

## Design

### Components

- **`TraceRepository`** (`server/ports/TraceRepository.ts`, new): `save(trace: AgentTrace): Promise<void>` and `listByConversation(conversationId: string): Promise<AgentTrace[]>`. Export `MAX_TRACES_PER_CONVERSATION = 5` from this module (moved off conversations).
- **In-memory fake** (`server/ports/fakes/InMemoryTraceRepository.ts`, new): same cap and order, for loop tests and workers without Postgres.
- **Drizzle adapter** (`server/adapters/traces/`, new): own `schema.ts`, `client.ts` (pool + `ping` + `close`, same pattern as [server/adapters/db/client.ts](../../server/adapters/db/client.ts)), `migrate.ts`, `ensureDatabase.ts`, `DrizzleTraceRepository.ts`. Do not import catalog tables.
- **Loop / run:** add `traces: TraceRepository` to `AgentRun`. [server/agent/loop.ts](../../server/agent/loop.ts) `await run.traces.save(trace)` in `finally`, catch, `run.log.warn`. [server/routes/agent.ts](../../server/routes/agent.ts) and [server/index.ts](../../server/index.ts) pass the Drizzle adapter; tests pass the fake.
- **Health / app:** `pingTraces` on [server/app.ts](../../server/app.ts) `AppDeps` and [server/routes/health.ts](../../server/routes/health.ts).
- **Ops:** Compose init SQL to `CREATE DATABASE genui_traces`; `TRACE_DATABASE_URL` on `api` and `api-dev`; copy traces migrations in [Dockerfile.api](../../Dockerfile.api); CI creates `genui_traces` and sets `TRACE_DATABASE_URL`.

### Interfaces

```ts
export const MAX_TRACES_PER_CONVERSATION = 5;

export interface TraceRepository {
  save(trace: AgentTrace): Promise<void>;
  listByConversation(conversationId: string): Promise<AgentTrace[]>;
}
```

`save` inserts then deletes older rows for that `conversationId` past the cap. `listByConversation` returns at most five, oldest first, empty array if none.

**Config** ([server/config.ts](../../server/config.ts)): `traceDatabaseUrl: env.TRACE_DATABASE_URL || "postgres://genui:genui@localhost:5432/genui_traces"`. Compare pathname (database name) with `databaseUrl`; if equal, throw at module load or in `index.ts` before listen.

**Health:** `GET /api/health` → `{ ok: true, db: boolean, agent: boolean, redis: boolean | null, traces: boolean }`. Additive field.

**Commands (new):**

- `npm run db:generate:traces` → `drizzle-kit generate --config drizzle.traces.config.ts`
- `npm run db:migrate:traces` → ensure `genui_traces` exists, then `drizzle-kit migrate --config drizzle.traces.config.ts`

Production `index.ts`: after catalog migrate/seed, `ensureTracesDatabase` then traces `runMigrations`; failure uses the existing `failStartup` path. Development: API starts if traces Postgres is down; writes fail open.

**Env:** `TRACE_DATABASE_URL` in [.env.example](../../.env.example). Never commit values.

### Data and migrations

Table `agent_traces` in database `genui_traces` only:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default random | |
| `conversation_id` | text not null | index with `created_at` |
| `payload` | jsonb not null | full `AgentTrace` |
| `created_at` | timestamptz not null default now() | eviction order |

Drizzle kit: `drizzle.traces.config.ts` (new), schema `server/adapters/traces/schema.ts`, out `server/adapters/traces/migrations`. First migration creates `agent_traces`. Rollback: drop table / drop database `genui_traces`; catalog data untouched.

Compose: add `docker/postgres/init-traces.sql` mounted at `/docker-entrypoint-initdb.d/` (`CREATE DATABASE genui_traces;`). That runs only on an empty volume. `ensureDatabase.ts` connects through `DATABASE_URL` (same user/host) and creates `genui_traces` when missing, so existing `pgdata` volumes keep working.

CI [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml): create `genui_traces` on the existing Postgres service; `TRACE_DATABASE_URL: postgres://genui:genui@localhost:5432/genui_traces`. Drizzle adapter tests skip unless that variable is set, same pattern as [server/adapters/db/DrizzleCustomComponentRepository.test.ts](../../server/adapters/db/DrizzleCustomComponentRepository.test.ts).

### Errors and edge cases

- Save throws or times out: log warning, still emit `done` (R3).
- Traces ping false: health `traces: false`; chat continues.
- Duplicate `conversationId` after process restart: new traces append to the same five-cap row set (desired).
- `payload` may include UI trees; jsonb as-is, no extra size cap in this plan.
- `ensureDatabase` uses `CREATE DATABASE`, which cannot run inside a transaction.

### Compatibility and rollout

Additive health field; browsers ignore unknown JSON keys. No SSE or chat body change. Existing Compose volumes need `ensureDatabase` or a one-time `CREATE DATABASE genui_traces`. No catalog migration.

## Security

| Concern | Mitigation | Enforced by |
|---|---|---|
| Traces hold user text and UI trees (personal data) | No HTTP or UI for traces; logs on save failure omit payload, `userText`, completions, and trees | R3, R6 |
| Catalog and traces mixed in one database | Separate database name and URL; refuse identical database names; separate Drizzle schema and migrations | R1 |
| Traces URL credentials | Read only from `TRACE_DATABASE_URL` in config; document the name, never a value | R1 |
| Traces DB down used to hide chat | Writes fail open; health reports `traces` so operators can see it | R3, R5 |
| Unbounded jsonb growth | Cap of five traces per conversation (same as today) | R2 |

## Validation

**Workers can run** (no credentials or live services):

- `npm test`: in-memory repository cap/order, loop tests via the fake, conversations without traces, health `traces` field
- `npm run typecheck`
- `npm run build` / `npm run build:api`

When `DATABASE_URL` and `TRACE_DATABASE_URL` are set (CI):

- `npm test` also runs `DrizzleTraceRepository` persist, cap, and restart-the-pool cases

**New tests:**

- R1: traces migrate/startup refuses when `TRACE_DATABASE_URL` names the same database as `DATABASE_URL`
- R2: `InMemoryTraceRepository` and `DrizzleTraceRepository` sixth-save eviction; Drizzle list after new `createTracesDb`
- R3: loop tests use `run.traces.listByConversation`; a rejecting `save` still finishes the turn and does not include `userText` in the warn object
- R4: conversations tests drop `rememberTrace` / `getTraces` cases
- R5: [server/routes/health.test.ts](../../server/routes/health.test.ts) for `traces` true/false/throw/omit
- R6: no automated test; review the diagram against R1–R5

**After merge** (needs credentials, live services, or a person):

- `docker compose up -d db`, `npm run db:migrate`, `npm run db:migrate:traces`, `npm run dev`, `curl -s localhost:5173/api/health` shows `"traces":true`
- Send one chat turn, then `psql` on `genui_traces` and confirm a row in `agent_traces`
- Restart the API and confirm the row is still there; confirm `genui` has no `agent_traces` table

## Work breakdown

| Slice | Covers | Touches | After | Size |
|---|---|---|---|---|
| traces-port | R2, R3 | server/ports/TraceRepository.ts, server/ports/fakes/InMemoryTraceRepository.ts, server/ports/fakes/InMemoryTraceRepository.test.ts | - | small |
| traces-database | R1, R2 | server/adapters/traces/schema.ts, server/adapters/traces/client.ts, server/adapters/traces/migrate.ts, server/adapters/traces/ensureDatabase.ts, server/adapters/traces/DrizzleTraceRepository.ts, server/adapters/traces/DrizzleTraceRepository.test.ts, server/adapters/traces/ensureDatabase.test.ts, drizzle.traces.config.ts, package.json, docker-compose.yml, docker/postgres/init-traces.sql, Dockerfile.api, .github/workflows/ci.yml, .env.example, server/config.ts | traces-port | medium |
| traces-loop | R3, R4, R5 | server/agent/run.ts, server/agent/loop.ts, server/agent/loop.test.ts, server/agent/conversations.ts, server/agent/conversations.test.ts, server/routes/agent.ts, server/routes/health.ts, server/routes/health.test.ts, server/app.ts, server/app.test.ts, server/index.ts | traces-port | medium |
| traces-docs | R6 | docs/ARCHITECTURE.md, README.md | traces-database, traces-loop | small |

`traces-database` and `traces-loop` can run in parallel after `traces-port` (loop uses the fake; `index.ts` wiring lands in `traces-loop` and reads `config.traceDatabaseUrl` plus the adapter from `traces-database`). `traces-docs` last so the diagram matches shipped code. Shared contract: `TraceRepository` and `MAX_TRACES_PER_CONVERSATION`.

## Non-goals

- HTTP or chat UI for traces
- A second Postgres container or extra host port
- Persisting conversation history or designs
- OpenTelemetry, dumping raw OpenAI traffic, or building evals
- Changing SSE events or guardrail limits

## Assumptions

- Same Postgres user can `CREATE DATABASE` (Compose `genui` superuser in the official image).
- Keeping the last five traces is enough until an eval harness needs more.
- Fail-open writes are right because traces are for operators/evals, not for the chat reply.
- An additive `traces` field on health is enough; no shared TypeScript type exists for the health body today.

## Risks

- Existing Compose volumes skip `docker-entrypoint-initdb.d`: mitigated by `ensureDatabase.ts` (R1).
- Trace jsonb including large UI trees: same data already sat in memory; five-trace cap bounds it (R2). Follow-up if rows get huge.
- `TRACE_DATABASE_URL` forgotten in a deploy: production migrate fails closed; health shows `traces: false` in dev (R5).

## Open decisions

None.

## References

- Request: "agent traces should be included in docs/ARCHITECTURE.md architecture diagram agent trace should have its own database"
- Decisions: feature branch `trace-db`; second database on the same Postgres (`genui_traces`, `TRACE_DATABASE_URL`); replace in-memory traces; last five per conversation, survive restart, no HTTP; persist and update the diagram
- Earlier in-memory work (shipped, not in this tree): `daniel-super-secret-workflow/plans/agent-trace.md` on `eval-harness`
- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) §1, §4, §5
- [server/agent/conversations.ts](../../server/agent/conversations.ts), [server/agent/loop.ts](../../server/agent/loop.ts), [server/agent/trace.ts](../../server/agent/trace.ts)
- [server/adapters/db/client.ts](../../server/adapters/db/client.ts), [server/index.ts](../../server/index.ts), [docker-compose.yml](../../docker-compose.yml)

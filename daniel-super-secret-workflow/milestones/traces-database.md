---
id: traces-database
priority: 20
depends:
  - traces-port
scope: medium
touches:
  - server/adapters/traces
  - drizzle.traces.config.ts
  - tsconfig.server.json
  - package.json
  - docker-compose.yml
  - docker/postgres/init-traces.sql
  - Dockerfile.api
  - .github/workflows/ci.yml
  - .env.example
  - server/config.ts
---

# Persist traces in Postgres database genui_traces

## Sources

- [Trace db plan — R1](../plans/trace-db.md#r1-separate-traces-database)
- [Trace db plan — R2](../plans/trace-db.md#r2-last-five-traces-per-conversation-durable)
- [Trace db plan — traces-database](../plans/trace-db.md#work-breakdown)
- [Trace db plan — Data and migrations](../plans/trace-db.md#data-and-migrations)

## Context

This builds on `traces-port`, which provides `TraceRepository`, `MAX_TRACES_PER_CONVERSATION = 5`, and `InMemoryTraceRepository`. Catalog data stays in database `genui` via `DATABASE_URL` (default `postgres://genui:genui@localhost:5432/genui`) and `server/adapters/db/` (`createDb` in `client.ts`, `runMigrations` in `migrate.ts`, schema in `schema.ts`). The catalog schema must not gain a traces table.

Traces need a second database on the same Postgres instance: `genui_traces`, reached only through `TRACE_DATABASE_URL` (default `postgres://genui:genui@localhost:5432/genui_traces`). Compare URL pathnames (database names). If they name the same database, startup and migrate must refuse with a clear error.

Compose (`docker-compose.yml`) has one `db` service (`POSTGRES_DB=genui`). Init scripts under `/docker-entrypoint-initdb.d/` run only on an empty volume, so also add `ensureDatabase` that connects through `DATABASE_URL` (same user/host) and creates `genui_traces` when missing. `CREATE DATABASE` cannot run inside a transaction. The Compose `genui` user is a superuser in the official image.

Drizzle kit for the catalog is `drizzle.config.ts`. Production `Dockerfile.api` copies only `server/adapters/db/migrations`. CI (`.github/workflows/ci.yml`) starts one Postgres service with `POSTGRES_DB=genui` and sets `DATABASE_URL`. Database tests skip unless that URL is set; see `server/adapters/db/DrizzleCustomComponentRepository.test.ts` and `server/adapters/db/client.test.ts` (ping false on a closed port, no live server required).

`traces-loop` will wire the adapter into `server/index.ts`. This goal must not edit `index.ts`, the agent loop, or conversations. Export the client, migrate, ensure, and repository so that later goal can import them.

## Scope

Add `server/adapters/traces/` without importing catalog tables:

- `schema.ts`: table `agent_traces` with `id` uuid PK default random, `conversation_id` text not null, `payload` jsonb not null (full `AgentTrace`), `created_at` timestamptz not null default now(). Index `(conversation_id, created_at)` for eviction order.
- `client.ts`: `createTracesDb` with pool, `ping` (`select 1`, never rejects), `close`, same pattern as `server/adapters/db/client.ts`. Refuse when the traces URL names the same database as the catalog URL.
- `migrate.ts`: apply pending migrations from `server/adapters/traces/migrations`.
- `ensureDatabase.ts`: using `DATABASE_URL`, create `genui_traces` when missing; idempotent if it already exists.
- `DrizzleTraceRepository.ts`: implements `TraceRepository`. `save` inserts then deletes older rows for that `conversationId` past the cap. `listByConversation` returns at most five, oldest first, `[]` if none.
- Tests: `DrizzleTraceRepository.test.ts` (skip unless `TRACE_DATABASE_URL` is set) for persist, sixth-save eviction, and list after a new `createTracesDb` (new pool). `ensureDatabase.test.ts` (skip unless `DATABASE_URL` is set) for create-without-dropping `genui` and idempotent re-run. Always-on tests: same-URL refusal; traces `ping` false when Postgres is down (closed port, like `client.test.ts`).
- `drizzle.traces.config.ts`: dialect postgresql, schema `server/adapters/traces/schema.ts`, out `server/adapters/traces/migrations`, credentials from `TRACE_DATABASE_URL` with the default above. Include this file in `tsconfig.server.json` the way `drizzle.config.ts` is included.
- First committed SQL migration creates `agent_traces`.
- `package.json` scripts: `db:generate:traces` → `drizzle-kit generate --config drizzle.traces.config.ts`; `db:migrate:traces` → ensure `genui_traces` exists, refuse same-database URLs, then `drizzle-kit migrate --config drizzle.traces.config.ts`.
- `docker/postgres/init-traces.sql` mounted at `/docker-entrypoint-initdb.d/` on `db`: `CREATE DATABASE genui_traces;`.
- `TRACE_DATABASE_URL` on Compose `api` and `api-dev` pointing at `genui_traces` on `db`.
- `Dockerfile.api` copies `server/adapters/traces/migrations` next to the catalog migrations.
- CI: create `genui_traces` on the existing Postgres service; set `TRACE_DATABASE_URL: postgres://genui:genui@localhost:5432/genui_traces`.
- `server/config.ts`: `traceDatabaseUrl: env.TRACE_DATABASE_URL || "postgres://genui:genui@localhost:5432/genui_traces"`. Export a helper that throws when catalog and traces URLs name the same database; call it from traces migrate/client (and from config construction if that stays testable without a subprocess).
- `.env.example`: document `TRACE_DATABASE_URL` with the local default, same style as `DATABASE_URL`. Do not commit secrets.

Assumption: the helper compares `new URL(url).pathname` (database name), not host. Rollback of this slice is drop table / drop database `genui_traces`; catalog data stays.

## Acceptance

- Default `TRACE_DATABASE_URL` / `config.traceDatabaseUrl` is `postgres://genui:genui@localhost:5432/genui_traces`.
- Traces client, migrate, and the distinct-URL helper refuse when the traces URL names the same database as `DATABASE_URL` / `genui`, with an error that says the two must differ.
- `server/adapters/db/schema.ts` has no traces / `agent_traces` table.
- `InMemoryTraceRepository` behavior is unchanged; `DrizzleTraceRepository.save` sixth insert for one conversation leaves five rows and drops the oldest `userText`.
- After closing the pool and calling `createTracesDb` again, `listByConversation` still returns those rows (when `TRACE_DATABASE_URL` is set).
- `ensureDatabase` can create `genui_traces` on an instance that already has `genui`, and a second call does not fail.
- Compose init SQL and `db:migrate:traces` / `db:generate:traces` scripts exist as specified; CI sets `TRACE_DATABASE_URL` and creates `genui_traces`.

## Validation

- `npm test` exits 0. Distinct-URL and traces-ping-down cases always run. `DrizzleTraceRepository` and live `ensureDatabase` cases skip unless `TRACE_DATABASE_URL` / `DATABASE_URL` are set (CI sets both after this change).
- `npm run typecheck` exits 0.
- `npm run build` and `npm run build:api` exit 0.
- `grep -R agent_traces server/adapters/db/schema.ts` matches nothing; `grep -R agent_traces server/adapters/traces/schema.ts` matches.

## After merge

- `docker compose up -d db` then `npm run db:migrate:traces` succeeds on a fresh volume and on an existing `pgdata` volume without dropping `genui`.
- `psql` on `genui` shows no `agent_traces` table; `psql` on `genui_traces` shows `agent_traces`.

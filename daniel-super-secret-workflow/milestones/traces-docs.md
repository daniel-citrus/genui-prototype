---
id: traces-docs
priority: 90
depends:
  - traces-database
  - traces-loop
scope: small
touches:
  - docs/ARCHITECTURE.md
  - README.md
---

# Show the traces database on the architecture diagram

## Sources

- [Trace db plan — R6](../plans/trace-db.md#r6-architecture-diagram-matches-storage)
- [Trace db plan — traces-docs](../plans/trace-db.md#work-breakdown)

## Context

This builds on `traces-database` and `traces-loop`, which ship database `genui_traces` (URL `TRACE_DATABASE_URL`, never `DATABASE_URL`), a `TraceRepository` port and Drizzle adapter, loop writes that fail open, in-memory traces removed from conversations, and `GET /api/health` `{ ok, db, agent, redis, traces }`.

`docs/ARCHITECTURE.md` §1 mermaid still shows conversations as "Conversations and their last designs (in memory)" and one Postgres cylinder `components, custom_components, custom_component_versions`. The loop has no traces port/adapter. §3 health is `{ ok, db, agent, redis }`. §4 says the loop stores one turn trace on the conversation. §5 table says turn traces live in API memory beside history and are lost with the conversation. §7 config has no `TRACE_DATABASE_URL`. §8 layout puts turn traces in `server/agent/` and Postgres adapters in one place. §9 lists only catalog `db:generate` / `db:migrate`. §10 says conversations and designs are lost on restart and does not say traces survive.

README health example is `{"ok":true,"db":true,"agent":true}` without `traces`. Local setup runs `npm run db:migrate` but not traces migrate. Scripts list has no `db:generate:traces` / `db:migrate:traces`.

Match R1–R5; do not add an HTTP or UI for traces, a second Postgres container, or eval-harness docs.

## Scope

Update `docs/ARCHITECTURE.md`:

- §1 mermaid: traces database as its own Postgres cylinder, reached through a traces port and Drizzle traces adapter; not inside the in-memory conversation map and not on the catalog cylinder. Conversations in that graph are history and designs only. Mention `TraceRepository` next to the other ports. Health check can ping the traces database as well as catalog Postgres.
- §3: health body includes `traces` (boolean; false when the ping is omitted, fails, or throws). Startup: production runs traces ensure/migrate after catalog migrate/seed and exits 1 if that fails; development starts if traces Postgres is down.
- §4: the loop writes the turn trace through `TraceRepository.save` in `finally`; a failed save logs a warning without payload/`userText`/completions/trees and still finishes the turn.
- §5: traces live in `genui_traces` table `agent_traces`, last five per conversation, survive API restart and in-memory conversation eviction/`resetConversation`, not exposed over HTTP. History and designs stay in process memory and still vanish on restart.
- §7: `TRACE_DATABASE_URL` default `postgres://genui:genui@localhost:5432/genui_traces`; must name a different database than `DATABASE_URL`.
- §8: traces adapter/migrations under `server/adapters/traces/`; conversations no longer store traces; mention `drizzle.traces.config.ts`.
- §9 / commands: `npm run db:generate:traces` and `npm run db:migrate:traces`. Database tests for traces skip unless `TRACE_DATABASE_URL` is set; CI creates `genui_traces`.
- §10: traces persist across restart (capped at five per conversation); still no traces HTTP.

Update `README.md` so local setup, health curl examples, and script lists include traces migrate and `"traces":true` when that database is up. Same Postgres instance, two databases; no extra container.

## Acceptance

- The §1 mermaid graph has a Postgres cylinder for traces, separate from `components` / `custom_components`.
- Conversations in that graph are history and designs only (no in-memory traces).
- §5 says traces live in `genui_traces`, last five per conversation, survive restart, and are not exposed over HTTP.
- §3 health, §4 recording, §7 config, §8 layout, and §10 limits match the shipped R1–R5 behavior above.
- README health examples include `traces`, and the local DB steps include `npm run db:migrate:traces`.

## Validation

- `grep -n genui_traces docs/ARCHITECTURE.md README.md` matches both files.
- `grep -n TRACE_DATABASE_URL docs/ARCHITECTURE.md README.md` matches both files.
- `grep -n db:migrate:traces README.md` matches.
- The §1 mermaid conversation node is history and designs only (no in-memory traces on that node).
- `npm run typecheck` exits 0 (docs-only change).

## After merge

- Read `docs/ARCHITECTURE.md` §1 mermaid and confirm a traces Postgres cylinder besides the catalog one, with a traces port/adapter from the agent loop.

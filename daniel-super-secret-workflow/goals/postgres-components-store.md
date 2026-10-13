---
id: postgres-components-store
priority: 40
depends:
  - api-foundation
touches:
  - docker-compose.yml
  - drizzle.config.ts
  - server/adapters/db
scope: medium
---

# Postgres `components` table with a Drizzle repository

## Sources

- [Agent API plan — Step 4, Postgres and the components table](../../docs/plans/agent-api-and-database.md#7-step-4--postgres-and-the-components-table)
- [Agent API plan — Step 5, Adapter scaffold (Database)](../../docs/plans/agent-api-and-database.md#8-step-5--adapter-scaffold)
- [Agent API plan — Decisions](../../docs/plans/agent-api-and-database.md#10-decisions-and-open-questions)

## Context

`api-foundation` has already installed `drizzle-orm`, `pg`, `drizzle-kit`, and `@types/pg`, and has added these scripts: `db:generate` (`drizzle-kit generate`), `db:migrate` (`drizzle-kit migrate`), and `db:studio`. `config.databaseUrl` reads `DATABASE_URL`, defaulting to `postgres://genui:genui@localhost:5432/genui`.

This goal builds on these contracts, which it must not change:

- `shared/components.ts`:
  - `ComponentSpec = Record<string, unknown>`.
  - `PropsSchema { type: "object"; properties; required? }`.
  - `Component { id; name; spec; propsSchema; createdAt: string; updatedAt: string }`, with ISO timestamps.
  - `NewComponent { name; spec; propsSchema }` and `ComponentPatch = Partial<NewComponent>`.
- `server/ports/ComponentRepository.ts`: `ComponentRepository { list; get(id) → Component | undefined; create(NewComponent); update(id, ComponentPatch) → Component | undefined; remove(id) → boolean }` and `NameTakenError`.

`docker-compose.yml` currently has only `dev` (the Vite container) and `web` (nginx). Add only the `db` service. `docker-and-docs` owns the other Compose changes, and `wire-api-services` owns `server/index.ts`. Nothing calls the repository from HTTP or agent tools yet.

Decided columns: `name`, `spec` (jsonb), and `props_schema` (jsonb), plus `id` and timestamps. Names are unique. Conversations are **not** stored in Postgres.

## Scope

1. **Compose `db` service:**
   - Image `postgres:17-alpine`.
   - `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` set from `${POSTGRES_USER:-genui}`-style env defaults, all `genui`.
   - Port `5432:5432`, a named volume `pgdata` mounted at `/var/lib/postgresql/data`, and a `healthcheck` running `pg_isready -U genui -d genui`.
   - Leave `dev` and `web` unchanged.
2. **`drizzle.config.ts`:** `defineConfig({ dialect: "postgresql", schema: "./server/adapters/db/schema.ts", out: "./server/adapters/db/migrations", dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://genui:genui@localhost:5432/genui" } })`.
3. **`server/adapters/db/schema.ts`:**

   ```ts
   export const components = pgTable("components", {
     id: uuid("id").primaryKey().defaultRandom(),
     name: text("name").notNull().unique(),
     spec: jsonb("spec").$type<ComponentSpec>().notNull(),
     propsSchema: jsonb("props_schema").$type<PropsSchema>().notNull(),
     createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
     updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
   });
   export type ComponentRow = typeof components.$inferSelect;
   export type NewComponentRow = typeof components.$inferInsert;
   ```

4. **Migrations:** run `npm run db:generate` and commit the output under `server/adapters/db/migrations/`, including `meta/`. Migrations are the only way the schema changes.
5. **`server/adapters/db/client.ts`:** `createDb(databaseUrl)` returns `{ db, pool, ping, close }`.
   - `db` is `drizzle(pool, { schema })` over a `pg` `Pool`.
   - `ping()` runs `select 1` and resolves `true`, or `false` on any error.
   - `close()` ends the pool.
   - Creating it must not connect, so the API can start without Postgres.
6. **`server/adapters/db/migrate.ts`:** `runMigrations(db, migrationsFolder = "server/adapters/db/migrations")` using `drizzle-orm/node-postgres/migrator`. The folder is relative to the process's working directory. `wire-api-services` calls it on startup in production.
7. **`server/adapters/db/DrizzleComponentRepository.ts`:** implements `ComponentRepository` with Drizzle queries.
   - Map rows to `Component`, turning `Date` timestamps into ISO strings.
   - `list` orders by `name`.
   - `update` sets `updatedAt` to now, applies only the provided fields, and returns `undefined` for an unknown id.
   - `remove` returns whether a row was deleted.
   - `create` and `update` throw `NameTakenError(name)` on a unique violation (Postgres code `23505`). Check both `err.code` and `err.cause?.code`, since Drizzle may wrap the driver error.
   - A malformed (non-uuid) id behaves like an unknown id.
8. **`server/adapters/db/DrizzleComponentRepository.test.ts`:** skipped unless `process.env.DATABASE_URL` is set (check the env var directly, not `config`). It runs `runMigrations`, then:
   - creates a component with a run-unique name and reads it back with `get` and `list`;
   - updates `spec` and checks that `updatedAt` advanced;
   - checks that a second `create` with the same name throws `NameTakenError`;
   - removes the row and checks that `get` returns `undefined` and a second `remove` returns `false`.

   It cleans up its rows and closes the pool.

## Acceptance

- `docker compose up -d db` starts a healthy Postgres on `localhost:5432` with database, user, and password `genui`.
- `npm run db:migrate` against it creates a `components` table with columns `id` (uuid, primary key), `name` (text, not null, unique), `spec` (jsonb, not null), `props_schema` (jsonb, not null), and `created_at` and `updated_at` (timestamptz, not null, default now).
- `DrizzleComponentRepository` satisfies `ComponentRepository` without changes to the port, and returns `Component` objects with ISO timestamps.
  - Duplicate names surface as `NameTakenError`, never as a raw Postgres error.
  - Unknown ids yield `undefined` or `false`.
- `createDb` does not connect until first use, and `ping()` returns `false`, without throwing, when Postgres is down.

## Validation

- `docker compose up -d db`, then `npm run db:migrate`, exiting 0. `docker compose exec db psql -U genui -d genui -c '\d components'` shows the columns above.
- `DATABASE_URL=postgres://genui:genui@localhost:5432/genui npm test`: the repository test (introduced by this goal) runs and passes.
- `npm test` without `DATABASE_URL`: the repository test is reported as skipped, and the rest pass.
- `npm run typecheck` exits 0.

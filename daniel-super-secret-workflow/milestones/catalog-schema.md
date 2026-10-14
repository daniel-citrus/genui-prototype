---
id: catalog-schema
priority: 10
depends: []
touches:
  - shared/components.ts
  - server/adapters/db/schema.ts
  - server/adapters/db/migrations
  - server/ports/ComponentRepository.ts
  - server/adapters/db/DrizzleComponentRepository.ts
  - server/adapters/db/DrizzleComponentRepository.test.ts
  - docs/ARCHITECTURE.md
scope: medium
---

# Reshape the components table into a read-only catalog

## Sources

- [Component catalog plan — Step 1, Table and types](../plans/component-catalog.md#3-step-1--table-and-types)
- [Component catalog plan — Step 4, Read-only repository](../plans/component-catalog.md#6-step-4--read-only-repository)

## Context

The `components` table (`server/adapters/db/schema.ts`, migration `0000_clear_ronan.sql`) has `id`, `name` (unique), `spec` (jsonb), `props_schema` (jsonb), `created_at`, and `updated_at`. `shared/components.ts` defines `ComponentSpec`, `PropsSchema`, `Component`, `NewComponent`, and `ComponentPatch`. The port `server/ports/ComponentRepository.ts` has `list`, `get`, `create`, `update`, `remove`, and a `NameTakenError` class; `DrizzleComponentRepository` implements it, and its test (`DrizzleComponentRepository.test.ts`, skipped without `DATABASE_URL`) exercises the write methods.

The table is becoming a catalog of **predefined** UI components. Rendering lives in browser code keyed by `name`, so `spec` goes away. Rows will be written only by a seed script (a later goal), so application code gets read-only access. Nothing outside the repository and its test uses `create`, `update`, `remove`, `NameTakenError`, `ComponentSpec`, `NewComponent`, or `ComponentPatch` today.

## Scope

**Table** (`server/adapters/db/schema.ts`):

| Column | Type |
|---|---|
| `id` | `uuid`, primary key, random default (unchanged) |
| `name` | `text`, not null, unique (unchanged) |
| `description` | `text`, not null |
| `category` | `text`, not null, Drizzle `check()` constraint: one of `layout`, `text`, `input`, `display` |
| `children` | `text`, not null, `check()` constraint: one of `none`, `any` |
| `props_schema` | `jsonb`, not null (unchanged) |
| `example_props` | `jsonb`, not null |
| `created_at`, `updated_at` | `timestamptz`, default `now()` (unchanged) |

Drop `spec`. Generate the migration with `npm run db:generate`, then edit the generated SQL so it starts with `DELETE FROM "components";` (no data is relied on, and existing rows would violate the new `not null` columns). Commit the SQL and the updated `meta/` files.

**Types** (`shared/components.ts`): remove `ComponentSpec`, `NewComponent`, and `ComponentPatch`. Add:

```ts
export type ComponentCategory = "layout" | "text" | "input" | "display";
export type ComponentChildren = "none" | "any";

/** One catalog entry, as written in the catalog file. */
export interface CatalogComponent {
  name: string;
  description: string;
  category: ComponentCategory;
  children: ComponentChildren;
  propsSchema: PropsSchema;
  exampleProps: Record<string, unknown>;
}

/** A catalog entry as stored. */
export interface Component extends CatalogComponent {
  id: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}
```

Keep `PropsSchema` and add `additionalProperties: false` to it as a required literal property.

**Port and adapter:** `ComponentRepository` becomes `list()`, `get(id)`, and `getByName(name)`; remove `create`, `update`, `remove`, and `NameTakenError`. `DrizzleComponentRepository` implements the three: `list()` orders by `category`, then `name`; `get(id)` keeps its existing non-UUID guard; `getByName` is an exact match. Missing rows resolve `undefined`.

**Tests:** rewrite `DrizzleComponentRepository.test.ts` (still skipped without `DATABASE_URL`). Insert its own fixture rows directly with Drizzle using unique names (for example `TestWidget` plus a random suffix), and delete them in `after()`. A seed script does not exist yet.

**Docs:** in `docs/ARCHITECTURE.md` §5 Data, update the `components` columns and say the repository is read-only.

Out of scope: the catalog file, the seed, Ajv, and agent tools.

## Acceptance

- After `npm run db:migrate` on a database that has the old table (with or without rows), `components` has exactly the columns above, and `spec` is gone.
- Inserting a row with `category = 'widget'` or `children = 'some'` fails with a check-constraint violation.
- `ComponentRepository` exposes only `list`, `get`, and `getByName`, typed with `Component` from `shared/components.ts`. No Drizzle types leak out of the adapter.
- `list()` returns rows ordered by category, then name. `get` with a missing or non-UUID id and `getByName` with a missing name resolve `undefined`.
- `npm run typecheck`, `npm test`, `npm run build`, and `npm run build:api` pass.

## Validation

- `docker compose up -d db`, then `npm run db:migrate`, then `docker compose exec db psql -U genui -d genui -c '\d components'`: shows the new columns and both check constraints.
- `DATABASE_URL=postgres://genui:genui@localhost:5432/genui npm test`: the repository tests run (not skipped) and pass.
- `npm test` without `DATABASE_URL`: passes, with the repository tests skipped.
- `npm run typecheck && npm run build && npm run build:api`: pass.

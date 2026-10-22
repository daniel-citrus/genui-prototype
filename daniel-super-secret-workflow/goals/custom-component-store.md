---
id: custom-component-store
priority: 20
depends: []
touches:
  - shared/customComponents.ts
  - server/ports/CustomComponentRepository.ts
  - server/ports/fakes/InMemoryCustomComponentRepository.ts
  - server/ports/fakes/InMemoryCustomComponentRepository.test.ts
  - server/adapters/db/schema.ts
  - server/adapters/db/migrations
  - server/adapters/db/DrizzleCustomComponentRepository.ts
  - server/adapters/db/DrizzleCustomComponentRepository.test.ts
scope: medium
---

# Store custom component definitions with versions and soft delete

## Sources

- [Custom components plan: R1, Design (Interfaces, Data and migrations)](../plans/custom-components.md#r1-global-versioned-storage-with-soft-delete)

## Context

The agent will soon define its own UI components ("custom components") and reuse them in every later conversation. This goal adds only the storage layer: shared types, a port, an in-memory fake for tests, and a Postgres adapter with a migration. Nothing calls it yet; later goals add validation, expansion, agent tools and a browser panel on top.

Today the only component storage is the `components` table in `server/adapters/db/schema.ts`, read through the read-only port `server/ports/ComponentRepository.ts` (`list`, `get`, `getByName`) with `server/adapters/db/DrizzleComponentRepository.ts` and the test fake `server/ports/fakes/InMemoryComponentRepository.ts`. Follow their style: the Drizzle adapter maps rows to shared types with ISO timestamps, and its test (`server/adapters/db/DrizzleComponentRepository.test.ts`) skips when `DATABASE_URL` is unset and runs migrations first. `server/adapters/db/seed.ts` (`seedComponents`) locks and rewrites only `components`. Migrations are generated with `npm run db:generate` (drizzle-kit, from `drizzle.config.ts`) into `server/adapters/db/migrations` and applied at production startup by `runMigrations`. Shared types live in `shared/components.ts` (`ComponentCategory` is `layout | text | input | display`, `ComponentChildren` is `none | any`, `PropsSchema`).

Updates must never overwrite and deletes must only hide, so a bad edit or an accidental delete is always recoverable.

## Scope

Create `shared/customComponents.ts` with these exports (later goals rely on the exact names):

```ts
export type TemplateValue = unknown | { $prop: string };
export interface TemplateNode {
  component: string;                       // catalog or custom name
  props?: Record<string, TemplateValue>;
  children?: (TemplateNode | { $children: true })[];
}
export interface CustomComponentDefinition {
  name: string;
  description: string;
  category: ComponentCategory;
  children: ComponentChildren;
  propsSchema: PropsSchema;
  exampleProps: Record<string, unknown>;
  template: TemplateNode;
}
export interface StoredCustomComponent extends CustomComponentDefinition {
  version: number;          // current version
  versions: number;         // how many exist
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export const CUSTOM_COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/;
export const MAX_CUSTOM_COMPONENTS = 200;          // not deleted
export const MAX_CUSTOM_COMPONENTS_TOTAL = 500;    // deleted included
export const MAX_CUSTOM_COMPONENT_VERSIONS = 20;
export const MAX_DEFINITION_CHARS = 8000;
export const MAX_DESCRIPTION_CHARS = 300;
export const MAX_TEMPLATE_NODES = 40;
export const MAX_TEMPLATE_DEPTH = 6;
export const MAX_CUSTOM_NESTING = 3;
export const MAX_EXPANDED_NODES = 400;
export const MAX_EXPANDED_DEPTH = 24;
```

Create `server/ports/CustomComponentRepository.ts`:

```ts
export class CustomComponentError extends Error {
  constructor(readonly code: "limit" | "deleted" | "conflict" | "name_taken" | "not_found", message: string);
}
export interface CustomComponentRepository {
  /** Current versions ordered by name; deleted ones only with includeDeleted; search is a case-insensitive substring of name or description; total counts all matches before limit. */
  list(opts?: { includeDeleted?: boolean; search?: string; limit?: number }): Promise<{ components: StoredCustomComponent[]; total: number }>;
  /** Current version by exact name, deleted included (deletedAt set). */
  getByName(name: string): Promise<StoredCustomComponent | undefined>;
  getVersion(name: string, version: number): Promise<StoredCustomComponent | undefined>;
  listVersions(name: string): Promise<{ version: number; description: string; createdAt: string }[]>;
  /** Saves version 1, or the next version as current. Rejects CustomComponentError limit, deleted, conflict or name_taken. */
  save(definition: CustomComponentDefinition): Promise<StoredCustomComponent>;
  /** Resolve false for an unknown name. */
  softDelete(name: string): Promise<boolean>;
  restore(name: string): Promise<boolean>;
}
```

`save` does not validate the definition's content (a later goal does); it only enforces storage rules.

Add two tables to `server/adapters/db/schema.ts` and generate the migration with `npm run db:generate` (keep the generated SQL and `meta` files):

- `custom_components`: `id` uuid primary key default random, `name` text not null, `current_version` integer not null, `deleted_at` timestamptz null, `created_at` and `updated_at` timestamptz not null default now; unique index on `lower(name)`.
- `custom_component_versions`: `id` uuid primary key default random, `component_id` uuid not null referencing `custom_components(id)`, `version` integer not null, `description` text not null, `category` text not null with the same check as `components.category`, `children` text not null with the same check as `components.children`, `props_schema` jsonb not null, `example_props` jsonb not null, `template` jsonb not null, `created_at` timestamptz not null default now; unique `(component_id, version)`.

Implement `DrizzleCustomComponentRepository` (constructor takes `Db` like `DrizzleComponentRepository`). `save` runs in one transaction: find the component by `lower(name)` with a row lock (or insert it), check the limits, insert the version, update `current_version` and `updated_at`. Map a unique violation to `CustomComponentError("conflict", ...)`. Implement `InMemoryCustomComponentRepository` with the same behavior (structured clones, no shared references).

Leave `server/adapters/db/seed.ts` unchanged: the seed must never touch the new tables. Do not wire the repository into `server/index.ts`; later goals do.

## Acceptance

- Saving a new name returns version 1 with `versions: 1`; saving it again returns version 2 as current, and `getVersion(name, 1)` still returns the first definition unchanged.
- Names are unique ignoring case: after saving `MenuCard`, saving `menucard` rejects code `name_taken` with a message naming `MenuCard`; `getByName` matches the exact stored name only.
- `softDelete` sets `deletedAt` and keeps every version; `restore` clears it; both resolve `false` for an unknown name. `list()` leaves deleted ones out; `list({ includeDeleted: true })` includes them.
- `save` on a deleted name rejects `CustomComponentError` code `deleted` with a message to restore it first or pick another name.
- `save` rejects code `limit` with a message naming the limit when it would create the 201st non-deleted component, the 501st component overall, or the 21st version of one component.
- Two concurrent saves of one name never produce two rows with the same version; the loser rejects code `conflict` with "changed while saving, try again".
- `list({ search, limit })` filters by case-insensitive substring of name or description, orders by name, and returns `total` before the limit.
- The seed and the `components` table are untouched; existing tests still pass.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including new `server/ports/fakes/InMemoryCustomComponentRepository.test.ts` covering every acceptance bullet; `server/adapters/db/DrizzleCustomComponentRepository.test.ts` covers the same cases plus a concurrent save, and skips without `DATABASE_URL` (CI runs it with Postgres).
- `npm run db:generate` produces exactly one new migration for the two tables, and running it again reports no changes.
- `npm run build:api` passes.

## After merge

- Run `npm run db:migrate` on a real database and check that both tables exist and `npm run db:seed` leaves them alone.

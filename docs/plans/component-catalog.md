# Plan: Predefined component catalog and seed

Turn the `components` table into a catalog of predefined UI components that the agent can read. Each component's rendering lives in code; the table holds what the agent and the validator need: a description, a category, whether it takes children, a props schema, and example props. A seed file in the repo is the only source of the rows, and a seed script makes the database match it.

**Status:** not started · **Builds on:** [Agent API service and Postgres](../milestones/agent-api-and-database.md)

Related: [Architecture](../ARCHITECTURE.md) · [Plans](./README.md)

## Index

1. [Goals and non-goals](#1-goals-and-non-goals)
2. [How the catalog is stored](#2-how-the-catalog-is-stored)
3. [Step 1 — Table and types](#3-step-1--table-and-types)
4. [Step 2 — The catalog file](#4-step-2--the-catalog-file)
5. [Step 3 — The seed script](#5-step-3--the-seed-script)
6. [Step 4 — Read-only repository](#6-step-4--read-only-repository)
7. [Step 5 — Docs and checks](#7-step-5--docs-and-checks)
8. [Decisions and open questions](#8-decisions-and-open-questions)

## 1. Goals and non-goals

**Goals**

- A `components` table that describes a small set of **predefined** components well enough for an agent to choose and configure them.
- A typed catalog file in the repo that lists every component. It is reviewed in PRs and is the only way rows change.
- A seed script that validates the catalog and makes the table match it, safe to run any number of times.
- Production seeds on API start, right after migrations, so every deploy's catalog matches its code.

**Non-goals (this plan)**

- Rendering components in the sandbox, and the UI tree format the agent will produce. That is the next plan; it adds a renderer per catalog name.
- Agent tools (`list_components`, `get_component`, `render_ui`).
- Components created or edited at runtime, by the user or the agent. No versioning, forking, or ownership.
- Interactivity: inputs are visual only, with no event bindings or form state.
- Named slots. Every basic component either takes no children or any children.

## 2. How the catalog is stored

```
server/catalog/components.ts   ← source of truth (typed array, in git)
        │
        │  npm run db:seed (dev) · API start after migrations (production)
        ▼
server/catalog/validate.ts     ← Ajv: schemas valid, examples match, names unique
        │
        ▼
Postgres `components`          ← a copy; can be dropped and reseeded at any time
        │
        ▼
ComponentRepository (read-only) → agent tools and API routes (later plans)
```

- **Migrations** change the table's shape and run once each. **The seed** changes its rows and always ends in the same state.
- Nothing in the database is precious: the catalog file plus the seed recreate it.
- The renderer plan adds a test that every catalog name has a renderer in `src/` and every renderer has a catalog entry.

## 3. Step 1 — Table and types

**New shape** (`server/adapters/db/schema.ts`):

| Column | Type | Holds |
|---|---|---|
| `id` | `uuid`, primary key, random default | Row identity (unchanged) |
| `name` | `text`, not null, unique | The stable key UI trees will reference, PascalCase (`Button`). Never renamed |
| `description` | `text`, not null | One or two sentences on when to use it. The agent chooses from this |
| `category` | `text`, not null, check in (`layout`, `text`, `input`, `display`) | Groups the list for the agent |
| `children` | `text`, not null, check in (`none`, `any`) | Whether a node of this component may have children |
| `props_schema` | `jsonb`, not null | JSON Schema for the props (unchanged column, stricter rules below) |
| `example_props` | `jsonb`, not null | One realistic set of props, valid against `props_schema`. A worked example for the agent |
| `created_at`, `updated_at` | `timestamptz`, default `now()` | `updated_at` changes only when the seed changes the row |

- **`spec` is dropped.** Rendering lives in code keyed by `name`, so a stored structure would have nothing to do and would drift. If components are later defined as data, the column comes back with a settled shape (see [open questions](#8-decisions-and-open-questions)).
- The checks are Drizzle `check()` constraints, so a bad value can't be written even outside the seed.
- Generate the migration with `npm run db:generate`. The table holds no data anyone relies on, so dropping `spec` and adding `not null` columns needs no backfill; if a dev database has rows, the migration may delete them first (`DELETE FROM components`), and the seed refills the table.

**Types** (`shared/components.ts`): replace `ComponentSpec`, `NewComponent`, and `ComponentPatch` with:

```ts
export type ComponentCategory = "layout" | "text" | "input" | "display";
export type ComponentChildren = "none" | "any";

/** One catalog entry, as written in server/catalog/components.ts. */
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

`PropsSchema` stays, and gains `additionalProperties: false` as a required literal.

**Done when** `npm run db:migrate` applies the new migration on the Compose database and `npm run typecheck` passes.

## 4. Step 2 — The catalog file

`server/catalog/components.ts` exports `catalog: CatalogComponent[]`, starting with these twelve. Text content is a prop, not children, so every leaf has `children: "none"`.

| Name | Category | Children | Props (required in **bold**, default in parentheses) |
|---|---|---|---|
| `Stack` | layout | any | `direction`: vertical \| horizontal (vertical) · `gap`: none \| sm \| md \| lg (md) · `align`: start \| center \| end \| stretch (stretch) |
| `Card` | layout | any | `title`: string · `padding`: sm \| md \| lg (md) |
| `Divider` | layout | none | none |
| `Heading` | text | none | **`text`**: string · `level`: 1 \| 2 \| 3 (2) |
| `Text` | text | none | **`text`**: string · `size`: sm \| md (md) · `tone`: default \| muted (default) |
| `Button` | input | none | **`label`**: string · `variant`: primary \| secondary \| danger (primary) · `size`: sm \| md \| lg (md) · `disabled`: boolean (false) |
| `TextInput` | input | none | **`label`**: string · `placeholder`: string · `type`: text \| email \| password \| number (text) · `required`: boolean (false) |
| `Checkbox` | input | none | **`label`**: string · `checked`: boolean (false) |
| `Select` | input | none | **`label`**: string · **`options`**: string[] (at least 1) · `placeholder`: string |
| `Image` | display | none | **`src`**: URI string · **`alt`**: string · `width`: sm \| md \| lg \| full (full) |
| `Badge` | display | none | **`text`**: string · `tone`: neutral \| success \| warning \| danger (neutral) |
| `Alert` | display | none | **`message`**: string · `title`: string · `tone`: info \| success \| warning \| danger (info) |

Example entry:

```ts
{
  name: "Button",
  description: "A clickable action. Use for the main and secondary actions of a form, card, or toolbar.",
  category: "input",
  children: "none",
  propsSchema: {
    type: "object",
    properties: {
      label: { type: "string", description: "Text on the button." },
      variant: { enum: ["primary", "secondary", "danger"], default: "primary", description: "Visual weight. Use danger for destructive actions." },
      size: { enum: ["sm", "md", "lg"], default: "md", description: "Button size." },
      disabled: { type: "boolean", default: false, description: "Shows the button but blocks clicks." },
    },
    required: ["label"],
    additionalProperties: false,
  },
  exampleProps: { label: "Save changes", variant: "primary" },
}
```

**Rules every entry follows** (enforced by `validate.ts`, Step 3):

- `name` matches `^[A-Z][A-Za-z0-9]*$` and is unique in the catalog.
- `propsSchema` is valid JSON Schema (draft-07, Ajv strict mode), has `type: "object"` and `additionalProperties: false`, and every property has a `description`.
- Every `default` is valid for its property, and `exampleProps` is valid against the schema.
- `description` is one or two sentences and says when to use the component, not just what it is.

**Done when** the catalog file typechecks and `server/catalog/validate.test.ts` passes (no database needed).

## 5. Step 3 — The seed script

**`server/catalog/validate.ts`:** `validateCatalog(catalog)` returns a list of problems (`Button: exampleProps.variant must be equal to one of the allowed values`), empty when the catalog is valid. It uses one Ajv instance (`ajv`, new runtime dependency; the validator for agent output will reuse it).

**`server/adapters/db/seed.ts`:** `seedComponents(db, catalog)`:

1. Validate the catalog. On any problem, throw with every message and write nothing.
2. In one transaction, read every row, compare with the catalog by `name`, and then:
   - insert entries that have no row;
   - update rows whose fields differ, setting `updated_at = now()`; unchanged rows are not written;
   - delete rows whose name is no longer in the catalog. Nothing references components yet, so deleting is safe; once saved UIs reference them, this becomes "mark inactive".
3. Return counts: `{ added, updated, removed, unchanged }`.

**Running it**

| Where | How |
|---|---|
| Dev | `npm run db:seed`, after `npm run db:migrate`. Script: `tsx --tsconfig ./tsconfig.server.json --env-file-if-exists=.env.local server/adapters/db/seed.ts` (a small CLI entry that builds the client, seeds, logs the counts, and closes the pool) |
| Production | `server/index.ts` calls `seedComponents` right after `runMigrations` when `NODE_ENV=production`, logs the counts, and exits with status 1 if it throws, the same as a failed migration |
| Compose `api-dev` | Unchanged: run `npm run db:migrate && npm run db:seed` from the host once, as the README says |

The catalog is TypeScript, so esbuild bundles it into `server-dist/index.mjs`; `Dockerfile.api` needs no new files.

**Tests**

- `server/catalog/validate.test.ts`: the real catalog passes; a broken schema, a bad default, an invalid example, a missing property description, `additionalProperties` left open, a bad name, and a duplicate name each produce a problem.
- `server/adapters/db/seed.test.ts` (gated on `DATABASE_URL`, like the repository tests): seeding an empty table adds every entry; seeding twice reports everything unchanged and leaves `updated_at` alone; a changed description updates one row; a removed entry is deleted; an invalid catalog writes nothing.

**Done when** `npm run db:seed` prints `components: 12 added, 0 updated, 0 removed, 0 unchanged` on a fresh database, then `0 added, 0 updated, 0 removed, 12 unchanged` when run again, and `docker compose up web --build` starts with a seeded table.

## 6. Step 4 — Read-only repository

Application code reads the catalog; only the seed writes it.

- `server/ports/ComponentRepository.ts` becomes `list()`, `get(id)`, and `getByName(name)`. `create`, `update`, `remove`, and `NameTakenError` go away.
- `DrizzleComponentRepository` implements those three, ordering `list()` by category then name so the agent sees a stable list.
- Its tests seed with the real catalog and check all three methods, including a missing id and a missing name resolving `undefined`.

**Done when** `npm test` passes with and without `DATABASE_URL`.

## 7. Step 5 — Docs and checks

- `docs/ARCHITECTURE.md`: the new columns, the catalog and seed, `npm run db:seed`, and production seeding on start.
- `README.md`: add `npm run db:seed` after `npm run db:migrate` in the setup steps.
- `docs/plans/README.md`: list this plan under **Active**.
- CI needs no change: the `checks` job already sets `DATABASE_URL`, so the seed and repository tests run there.

**Final checks:** `npm run typecheck`, `npm test`, `npm run build`, and `npm run build:api` pass, and `docker compose up web --build` serves the app with a seeded table.

## 8. Decisions and open questions

**Decided**

- **Predefined components only.** The table is a catalog; rendering is code keyed by `name`.
- **The catalog file is the source of truth.** Rows change only through the seed.
- **`spec` is dropped**; `description`, `category`, `children`, and `example_props` are added.
- **Text is a prop, not children**, and there are no named slots yet.
- **Removed catalog entries are deleted** until something references components.
- **Production seeds on start**; dev seeds manually, like its migrations.

**Open**

1. **UI tree format.** How a generated UI references components (`{ id, component: "Button", props, children }` is the likely shape) belongs to the renderer plan, along with stable node ids.
2. **Components as data.** If new components should be addable without a deploy, `spec` returns as a declarative template over a small set of primitives, with its own validator.
3. **Slots.** Add a `slots` column when a component needs named regions (for example a Card header and footer).

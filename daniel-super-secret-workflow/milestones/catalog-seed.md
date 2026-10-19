---
id: catalog-seed
priority: 30
depends:
  - catalog-schema
  - tool-registry-core
touches:
  - server/catalog/components.ts
  - server/catalog/validate.ts
  - server/catalog/validate.test.ts
  - server/adapters/db/seed.ts
  - server/adapters/db/seed.test.ts
  - server/adapters/db/seedCli.ts
  - server/adapters/db/DrizzleComponentRepository.test.ts
  - server/index.ts
  - package.json
  - README.md
  - docs/ARCHITECTURE.md
scope: medium
---

# Seed the twelve basic components from a catalog file

## Sources

- [Component catalog plan — How the catalog is stored](./component-catalog.md#2-how-the-catalog-is-stored)
- [Component catalog plan — Step 2, The catalog file](./component-catalog.md#4-step-2--the-catalog-file)
- [Component catalog plan — Step 3, The seed script](./component-catalog.md#5-step-3--the-seed-script)
- [Component catalog plan — Step 5, Docs and checks](./component-catalog.md#7-step-5--docs-and-checks)

## Context

This builds on `catalog-schema` and `tool-registry-core`, both merged into the base before this goal starts.
- `catalog-schema` gave the `components` table these columns: `name` (unique), `description`, `category` (`layout|text|input|display`), `children` (`none|any`), `props_schema`, `example_props`, and timestamps. It also added `CatalogComponent` and `Component` to `shared/components.ts`, and made `ComponentRepository` read-only (`list`, `get`, `getByName`).
- `tool-registry-core` added `server/validation/jsonSchema.ts`: a shared Ajv instance (strict, all errors, formats) with helpers to check a schema and compile a validator. Read both before starting.

The catalog file is the only source of truth for the rows. The database is a copy that the seed can recreate at any time. In production the API applies migrations on start in `server/index.ts` (when `NODE_ENV=production`) and exits with status 1 if they fail. In development, migrations are run by hand and the API starts without Postgres.

## Scope

**Catalog** (`server/catalog/components.ts`): export `catalog: CatalogComponent[]` with these twelve. Text content is a prop, so leaf components take no children.

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
| `Image` | display | none | **`src`**: string, `format: "uri"` · **`alt`**: string · `width`: sm \| md \| lg \| full (full) |
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

**Validation** (`server/catalog/validate.ts`): `validateCatalog(catalog)` returns a list of problem strings prefixed with the component name (for example `Button: exampleProps.variant must be equal to one of the allowed values`). The list is empty when the catalog is valid. Use the shared Ajv module. Rules:
- `name` matches `^[A-Z][A-Za-z0-9]*$` and is unique.
- `propsSchema` is valid JSON Schema, with `type: "object"` and `additionalProperties: false`, and every property has a `description`.
- Every `default` is valid for its property, and `exampleProps` is valid against the schema.
- `description` is non-empty.

**Seed** (`server/adapters/db/seed.ts`): `seedComponents(db, catalog)`:
1. Run `validateCatalog`. On any problem, throw with every message and write nothing.
2. In one transaction, read all rows and compare them with the catalog by `name`:
   - insert missing entries;
   - update rows whose fields differ, setting `updated_at = now()`;
   - leave unchanged rows untouched;
   - delete rows whose name is not in the catalog.
3. Return `{ added, updated, removed, unchanged }`.

**Running it**
- New `server/adapters/db/seedCli.ts`: builds the client from `DATABASE_URL` (default as in `server/config.ts`), seeds, prints `components: N added, N updated, N removed, N unchanged`, closes the pool, and exits non-zero on failure.
- New npm script `db:seed`: `tsx --tsconfig ./tsconfig.server.json --env-file-if-exists=.env.local server/adapters/db/seedCli.ts`.
- `server/index.ts` calls `seedComponents` right after `runMigrations` when `NODE_ENV=production`, logs the counts, and exits with status 1 if it throws, like a failed migration. Development startup is unchanged.

**Tests**
- New `server/catalog/validate.test.ts`, no database: the real catalog passes, and each of these produces a problem: a broken schema, an invalid default, an invalid example, a property without a description, `additionalProperties` left open, a bad name, and a duplicate name.
- New `server/adapters/db/seed.test.ts`, skipped without `DATABASE_URL`:
  - seeding adds every entry;
  - seeding again reports all unchanged and leaves `updated_at` alone;
  - a changed description updates one row;
  - a removed entry is deleted;
  - an invalid catalog writes nothing.
- Update `DrizzleComponentRepository.test.ts` to seed with the real catalog and check `list`, `get`, and `getByName` against it.
- Database test files share one database, and Node's test runner runs files in parallel. Make sure the seed tests can't delete another file's rows mid-test (for example, run database tests serially or restore the full catalog in `after()`), and that `npm test` with `DATABASE_URL` passes on repeated runs.

**Docs**
- `README.md`: add `npm run db:seed` after `npm run db:migrate` in the local and Docker development steps, and to the scripts list.
- `docs/ARCHITECTURE.md`: describe the catalog file, the seed, `npm run db:seed`, and production seeding on start.

Out of scope: renderers, the UI tree format, and agent tools.

## Acceptance

- On a freshly migrated database, `npm run db:seed` prints `components: 12 added, 0 updated, 0 removed, 0 unchanged`. Run again, it prints `components: 0 added, 0 updated, 0 removed, 12 unchanged`.
- A catalog with any rule violation makes the seed throw with every problem listed, and the table is unchanged.
- In production mode the API seeds after migrating. `docker compose up web --build` starts with twelve rows in `components`, and a seed failure stops the API with exit status 1.
- `npm test` passes with and without `DATABASE_URL`, including on a second consecutive run with it set.
- `npm run typecheck`, `npm run build`, and `npm run build:api` pass.

## Validation

- `docker compose up -d db && npm run db:migrate && npm run db:seed`, then run `npm run db:seed` again. The outputs match the acceptance lines.
- `docker compose exec db psql -U genui -d genui -c 'select name, category, children from components order by category, name'`: twelve rows.
- `DATABASE_URL=postgres://genui:genui@localhost:5432/genui npm test`, twice: passes both times.
- `npm test`, `npm run typecheck`, `npm run build`, and `npm run build:api`: pass.
- `docker compose up web --build`: the `api` logs show the seed counts, and http://localhost:8080 serves the app. Stop the stack afterwards.

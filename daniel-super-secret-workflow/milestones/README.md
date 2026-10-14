# Milestones

One markdown file per named chunk of work that already shipped.

**Recorded:**

- [Agent API service and Postgres](./agent-api-and-database.md): Fastify API with the ported OpenAI agent loop, chat pane wired to it, Postgres `components` table, Drizzle and OpenAI adapters.
- [Predefined component catalog and seed](./component-catalog.md): `components` as a read-only catalog of twelve basic components, seeded from `server/catalog/components.ts`.
- [Tool registry and component tools](./tool-registry.md): a validating tool registry, plus `list_components` and `get_component` over the `ComponentRepository` port.

- [tool-registry-core](tool-registry-core.md)
- [catalog-schema](catalog-schema.md)

- [catalog-seed](catalog-seed.md)

- [component-tools](component-tools.md)

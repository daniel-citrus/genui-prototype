# Plans

One markdown file per implementation plan for work that is not the system as it exists today. Move it to milestones when it ships, or to abandoned when it is dropped.

**Active:**

- [Predefined component catalog and seed](./component-catalog.md): `components` becomes a read-only catalog of twelve basic components (description, category, children, props schema, example props), seeded from a typed file in the repo.
- [Tool registry and component tools](./tool-registry.md): a registry that defines and validates the agent's tools, plus `list_components` and `get_component`, which read the catalog through the `ComponentRepository` port.

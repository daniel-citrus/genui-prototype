import type { Component } from "shared/components";
import type { StoredCustomComponent } from "shared/customComponents";
import { markupRules } from "shared/markup";
import type { ActionRegistry, ActionSpec } from "../actions/types";
import type { Logger } from "../log";
import type { ComponentRepository } from "../ports/ComponentRepository";
import type { CustomComponentRepository } from "../ports/CustomComponentRepository";

/** Values listed per dropdown source. */
export const MAX_CHOICES = 50;
/** Custom components listed. */
export const MAX_LISTED_CUSTOM_COMPONENTS = 40;
/** The actions section is longer than this: the registry has outgrown one request. */
export const ACTIONS_WARN_CHARS = 40_000;

const CHOICES_ERROR = "Couldn't load these choices.";

export interface ContextDeps {
  components: ComponentRepository;
  actions: ActionSpec[];
  listChoices?: ActionRegistry["listChoices"];
  customComponents?: CustomComponentRepository;
  log: Logger;
  signal: AbortSignal;
}

export interface GenerateContext {
  catalog: Component[];
  /** The context as message texts, most stable first. */
  sections: string[];
}

interface ListedChoices {
  values: string[];
  truncated: boolean;
  error?: string;
}

const section = (title: string, data: unknown) => `${title}\n${JSON.stringify(data)}`;

/** Lowercase words of `text`, also splitting CamelCase names, of three or more letters. */
function wordsOf(text: string): Set<string> {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return new Set(spaced.match(/[a-z0-9]{3,}/g) ?? []);
}

/**
 * Custom components that aren't deleted and don't share a catalog name
 * ignoring case (the catalog wins). Past the limit, those sharing a word
 * with `prompt` in name or description come first, then the most recently
 * updated. Empty, with a warning, when the repository can't be read.
 */
async function listCustomComponents(
  repo: CustomComponentRepository,
  catalog: Component[],
  prompt: string,
  log: Logger,
): Promise<StoredCustomComponent[]> {
  try {
    const catalogNames = new Set(catalog.map((c) => c.name.toLowerCase()));
    const { components } = await repo.list();
    const visible = components.filter((c) => !catalogNames.has(c.name.toLowerCase()));
    if (visible.length <= MAX_LISTED_CUSTOM_COMPONENTS) return visible;
    const wanted = wordsOf(prompt);
    const matches = (c: StoredCustomComponent) =>
      [...wordsOf(`${c.name} ${c.description}`)].some((w) => wanted.has(w));
    return visible
      .map((c) => ({ c, match: matches(c) }))
      .sort((a, b) => Number(b.match) - Number(a.match) || (a.c.updatedAt < b.c.updatedAt ? 1 : a.c.updatedAt > b.c.updatedAt ? -1 : 0))
      .slice(0, MAX_LISTED_CUSTOM_COMPONENTS)
      .map(({ c }) => c);
  } catch (err) {
    log.warn({ err }, "loading custom components failed; generating without them");
    return [];
  }
}

/** Each source's first `MAX_CHOICES` values; a source that fails is logged by name and listed empty. */
async function loadChoices(
  actions: ActionSpec[],
  listChoices: ActionRegistry["listChoices"],
  log: Logger,
  signal: AbortSignal,
): Promise<Record<string, ListedChoices>> {
  const sources = [...new Set(actions.flatMap((spec) => Object.values(spec.choices ?? {})))];
  const entries = await Promise.all(
    sources.map(async (source): Promise<[string, ListedChoices]> => {
      try {
        const values = await listChoices(source, signal);
        return [source, { values: values.slice(0, MAX_CHOICES), truncated: values.length > MAX_CHOICES }];
      } catch {
        log.error({ source }, "loading dropdown values failed");
        return [source, { values: [], truncated: false, error: CHOICES_ERROR }];
      }
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Everything the model needs to design in one request. Rejects when the
 * catalog can't be read.
 */
export async function buildContext(prompt: string, deps: ContextDeps): Promise<GenerateContext> {
  const { components, actions, listChoices, customComponents, log, signal } = deps;
  const catalog = await components.list();
  const sections = [
    section(
      "Catalog components:",
      catalog.map(({ name, category, description, children, propsSchema, exampleProps }) => ({
        name,
        category,
        description,
        children,
        propsSchema,
        exampleProps,
      })),
    ),
    section("Markup rules:", markupRules()),
  ];

  const actionsSection = section(
    "Actions a Button may run:",
    actions.map((spec) => ({
      name: spec.name,
      description: spec.description,
      input_schema: spec.input_schema,
      area: spec.area ?? "other",
      operation: spec.operation ?? "other",
      ...(spec.confirm !== undefined ? { confirm: spec.confirm } : {}),
      ...(spec.choices !== undefined ? { choices: spec.choices } : {}),
    })),
  );
  if (actionsSection.length > ACTIONS_WARN_CHARS) {
    log.warn({ chars: actionsSection.length }, "actions section is very long");
  }
  sections.push(actionsSection);

  if (listChoices) {
    sections.push(section("Dropdown values by source:", await loadChoices(actions, listChoices, log, signal)));
  }
  if (customComponents) {
    const custom = await listCustomComponents(customComponents, catalog, prompt, log);
    sections.push(
      section(
        "Saved custom components:",
        custom.map(({ name, description, category, children, propsSchema, exampleProps }) => ({
          name,
          description,
          category,
          children,
          propsSchema,
          exampleProps,
        })),
      ),
    );
  }
  return { catalog, sections };
}

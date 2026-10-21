import { ACTION_OPERATIONS, type ActionRegistry, type ActionSpec } from "../../actions/types";
import type { ToolContext, ToolDefinition } from "../tools";

/** Matches past this many are listed in `others` instead of in full. */
export const MAX_LISTED_ACTIONS = 10;
/** Values listed per dropdown source. */
export const MAX_CHOICES = 50;
/** An `others` entry's description is cut to this many characters. */
const MAX_OTHER_DESCRIPTION_CHARS = 120;

/** Fits every area or operation. */
const ANY = "any";
/** What a spec without an area or operation counts as. */
const OTHER = "other";
const CHOICES_ERROR = "Couldn't load these choices.";

interface ListedChoices {
  values: string[];
  truncated: boolean;
  error?: string;
}

const areaOf = (spec: ActionSpec) => spec.area ?? OTHER;
const operationOf = (spec: ActionSpec) => spec.operation ?? OTHER;

/**
 * Lists the actions a Button may run that fit an area and an operation, in
 * full, plus one line for every other action. With `listChoices`, it also
 * lists the dropdown values of the sources the returned actions name.
 */
export function listActionsTool(
  actions: ActionSpec[],
  listChoices?: ActionRegistry["listChoices"],
): ToolDefinition {
  const areas = [...new Set(actions.map(areaOf))].sort();
  const operations = ACTION_OPERATIONS.filter((op) => actions.some((spec) => operationOf(spec) === op));

  return {
    name: "list_actions",
    description:
      "List the backend actions a Button can run when clicked, by what they work on (area) and what they do (operation). Returns the matching actions in full, with their input_schema, the dropdown choices for inputs that take one, and the question asked before the action runs, plus one line for every other action.",
    input_schema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          enum: [...areas, ANY],
          description: "What the button works on. any when unsure.",
        },
        operation: {
          type: "string",
          enum: [...operations, ANY],
          description:
            "What the button does: create a new one; edit fields of an existing one (name, description, price, image, SKU); archive hides or unhides; delete removes for good; attach or detach offers or stops offering something on an item; other for anything else; any when unsure.",
        },
      },
      required: ["area", "operation"],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const { area, operation } = args as { area: string; operation: string };
      const fits = (spec: ActionSpec, op: string) =>
        (area === ANY || areaOf(spec) === area) && (op === ANY || operationOf(spec) === op);

      const exact = actions.filter((spec) => fits(spec, operation));
      const match = exact.length > 0 || actions.length === 0 ? "exact" : "area";
      const matches = match === "exact" ? exact : actions.filter((spec) => fits(spec, ANY));
      const listed = matches.slice(0, MAX_LISTED_ACTIONS);

      const data: Record<string, unknown> = {
        match,
        actions: listed.map((spec) => ({
          name: spec.name,
          description: spec.description,
          input_schema: spec.input_schema,
          area: areaOf(spec),
          operation: operationOf(spec),
          ...(spec.confirm !== undefined ? { confirm: spec.confirm } : {}),
          ...(spec.choices !== undefined ? { choices: spec.choices } : {}),
        })),
        others: actions
          .filter((spec) => !listed.includes(spec))
          .map((spec) => ({
            name: spec.name,
            area: areaOf(spec),
            operation: operationOf(spec),
            description: spec.description.slice(0, MAX_OTHER_DESCRIPTION_CHARS),
          })),
      };
      if (listChoices) {
        const sources = new Set(listed.flatMap((spec) => Object.values(spec.choices ?? {})));
        data.choices = await loadChoices([...sources], listChoices, ctx);
      }

      return {
        ok: true,
        summary: `Listed ${listed.length} actions${match === "area" ? " (no exact match)" : ""}`,
        data,
      };
    },
  };
}

/** Each source's first `MAX_CHOICES` values; a source that fails is logged and listed empty. */
async function loadChoices(
  sources: string[],
  listChoices: ActionRegistry["listChoices"],
  ctx: ToolContext,
): Promise<Record<string, ListedChoices>> {
  const entries = await Promise.all(
    sources.map(async (source): Promise<[string, ListedChoices]> => {
      try {
        const values = await listChoices(source, ctx.signal);
        return [source, { values: values.slice(0, MAX_CHOICES), truncated: values.length > MAX_CHOICES }];
      } catch (err) {
        ctx.log.error({ tool: "list_actions", source, err }, "choices failed to load");
        return [source, { values: [], truncated: false, error: CHOICES_ERROR }];
      }
    }),
  );
  return Object.fromEntries(entries);
}

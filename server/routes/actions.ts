import type { FastifyPluginAsync } from "fastify";
import type { ActionResult, ActionRunRequest } from "shared/api";
import { fillConfirm } from "../actions/confirm";
import { MAX_ACTION_MESSAGE_CHARS } from "../actions/registry";
import type { ActionRegistry, ActionSpec } from "../actions/types";
import type { DesignStore } from "../designs";
import { isObject } from "../ui/bindings";
import { checkActionRequest } from "../ui/checkAction";
import { MAX_NODES } from "../ui/validateTree";

/** Same cap as chat: an action click is a few ids plus at most MAX_NODES short values. */
const ACTIONS_BODY_LIMIT_BYTES = 32 * 1024;

export const DESIGN_GONE_MESSAGE =
  "This design is no longer available. Generate it again.";

export interface ActionsRouterOptions {
  actions: ActionRegistry;
  designs: DesignStore;
}

type Refusal = { status: 400 | 409; message: string };

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

/** A body field that isn't what `ActionRunRequest` says, or `undefined` if it fits. */
function bodyProblem(body: unknown): string | undefined {
  if (!isObject(body)) return "Expected a JSON object body.";
  const { designId, action, values, confirmed } = body;
  if (!isNonEmptyString(designId) || !isNonEmptyString(action)) {
    return "designId and action must be non-empty strings.";
  }
  if (!isObject(values)) return "values must be an object.";
  const entries = Object.values(values);
  if (entries.length > MAX_NODES) return `Too many values (max ${MAX_NODES}).`;
  if (!entries.every((v) => typeof v === "string" || typeof v === "boolean")) {
    return "Each value must be a string or a boolean.";
  }
  if (confirmed !== undefined && typeof confirmed !== "boolean") return "confirmed must be a boolean.";
  return undefined;
}

/** Only the values whose keys the action's schema declares; all of them if it isn't registered. */
function schemaValues(
  spec: ActionSpec | undefined,
  values: Record<string, string | boolean>,
): Record<string, string | boolean> {
  if (!spec) return values;
  const properties = isObject(spec.input_schema.properties) ? spec.input_schema.properties : {};
  return Object.fromEntries(Object.entries(values).filter(([key]) => Object.hasOwn(properties, key)));
}

export const actionsRouter: FastifyPluginAsync<ActionsRouterOptions> = async (app, opts) => {
  /**
   * Run the action a Button click names, if the remembered design allows it.
   * An action with a `confirm` question runs only with `confirmed: true`;
   * otherwise the answer is the question. Values may be personal data: they
   * are never logged, and neither is the question that holds them.
   */
  app.post("/run", { bodyLimit: ACTIONS_BODY_LIMIT_BYTES, config: { rateLimit: {} } }, async (req, reply) => {
    const problem = bodyProblem(req.body);
    if (problem) return reply.status(400).send({ error: { message: problem } });

    const started = performance.now();
    const { designId, action, values, confirmed } = req.body as ActionRunRequest;

    const controller = new AbortController();
    // The response closing before it was sent means the client went away.
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) controller.abort();
    });

    let outcome: ActionResult | Refusal;
    // Set only for an action with a `confirm` question that got past the checks.
    let confirmation: "asked" | "given" | undefined;
    const design = opts.designs.get(designId);
    if (!design) {
      outcome = { status: 409, message: DESIGN_GONE_MESSAGE };
    } else {
      const check = checkActionRequest(design, action, values);
      const spec = opts.actions.specs.find((s) => s.name === action);
      if (!check.ok) {
        outcome = { status: 400, message: check.message };
      } else if (spec?.confirm !== undefined && confirmed !== true) {
        confirmation = "asked";
        const question = fillConfirm(spec.confirm, schemaValues(spec, values)).slice(0, MAX_ACTION_MESSAGE_CHARS);
        outcome = { ok: false, message: question, confirm: question };
      } else {
        if (spec?.confirm !== undefined) confirmation = "given";
        outcome = await opts.actions.run(action, schemaValues(spec, values), {
          designId,
          log: req.log,
          signal: controller.signal,
        });
      }
    }

    const ok = "status" in outcome ? false : outcome.ok;
    req.log.info(
      { designId, action, ok, confirmation, durationMs: Math.round(performance.now() - started) },
      "action request",
    );
    if ("status" in outcome) {
      return reply.status(outcome.status).send({ error: { message: outcome.message } });
    }
    return outcome;
  });
};

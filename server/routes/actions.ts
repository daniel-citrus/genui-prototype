import type { FastifyPluginAsync } from "fastify";
import type { ActionResult, ActionRunRequest } from "shared/api";
import type { ActionRegistry } from "../actions/types";
import { getDesign } from "../agent/conversations";
import { isObject } from "../ui/bindings";
import { checkActionRequest } from "../ui/checkAction";
import { MAX_NODES } from "../ui/validateTree";

/** Same cap as chat: an action click is a few ids plus at most MAX_NODES short values. */
const ACTIONS_BODY_LIMIT_BYTES = 32 * 1024;

export const DESIGN_GONE_MESSAGE =
  "This design is no longer available. Ask the agent to show it again.";

export interface ActionsRouterOptions {
  actions: ActionRegistry;
}

type Refusal = { status: 400 | 409; message: string };

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

/** A body field that isn't what `ActionRunRequest` says, or `undefined` if it fits. */
function bodyProblem(body: unknown): string | undefined {
  if (!isObject(body)) return "Expected a JSON object body.";
  const { conversationId, uiId, action, values } = body;
  if (!isNonEmptyString(conversationId) || !isNonEmptyString(uiId) || !isNonEmptyString(action)) {
    return "conversationId, uiId and action must be non-empty strings.";
  }
  if (!isObject(values)) return "values must be an object.";
  const entries = Object.values(values);
  if (entries.length > MAX_NODES) return `Too many values (max ${MAX_NODES}).`;
  if (!entries.every((v) => typeof v === "string" || typeof v === "boolean")) {
    return "Each value must be a string or a boolean.";
  }
  return undefined;
}

/** Only the values whose keys the action's schema declares; all of them if it isn't registered. */
function schemaValues(
  actions: ActionRegistry,
  action: string,
  values: Record<string, string | boolean>,
): Record<string, string | boolean> {
  const spec = actions.specs.find((s) => s.name === action);
  if (!spec) return values;
  const properties = isObject(spec.input_schema.properties) ? spec.input_schema.properties : {};
  return Object.fromEntries(Object.entries(values).filter(([key]) => Object.hasOwn(properties, key)));
}

export const actionsRouter: FastifyPluginAsync<ActionsRouterOptions> = async (app, opts) => {
  /**
   * Run the action a Button click names, if the remembered design allows it.
   * Values may be personal data: they are never logged.
   */
  app.post("/run", { bodyLimit: ACTIONS_BODY_LIMIT_BYTES, config: { rateLimit: {} } }, async (req, reply) => {
    const problem = bodyProblem(req.body);
    if (problem) return reply.status(400).send({ error: { message: problem } });

    const started = performance.now();
    const { conversationId, uiId, action, values } = req.body as ActionRunRequest;

    const controller = new AbortController();
    // The response closing before it was sent means the client went away.
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) controller.abort();
    });

    let outcome: ActionResult | Refusal;
    const design = getDesign(conversationId, uiId);
    if (!design) {
      outcome = { status: 409, message: DESIGN_GONE_MESSAGE };
    } else {
      const check = checkActionRequest(design, action, values);
      outcome = check.ok
        ? await opts.actions.run(action, schemaValues(opts.actions, action, values), {
            conversationId,
            log: req.log,
            signal: controller.signal,
          })
        : { status: 400, message: check.message };
    }

    const ok = "status" in outcome ? false : outcome.ok;
    req.log.info(
      { conversationId, action, ok, durationMs: Math.round(performance.now() - started) },
      "action request",
    );
    if ("status" in outcome) {
      return reply.status(outcome.status).send({ error: { message: outcome.message } });
    }
    return outcome;
  });
};

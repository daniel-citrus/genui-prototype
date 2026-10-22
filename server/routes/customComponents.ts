import type { FastifyBaseLogger, FastifyPluginAsync, FastifyReply } from "fastify";
import type { Component } from "shared/components";
import type { CustomComponentDetail, CustomComponentSummary } from "shared/api";
import {
  CUSTOM_COMPONENT_NAME,
  MAX_CUSTOM_COMPONENTS_TOTAL,
  MAX_EXPANDED_DEPTH,
  MAX_EXPANDED_NODES,
  type CustomComponentDefinition,
  type StoredCustomComponent,
} from "shared/customComponents";
import { expandTree, rewritePaths } from "../customComponents/expand";
import type { ComponentRepository } from "../ports/ComponentRepository";
import {
  CustomComponentError,
  type CustomComponentErrorCode,
  type CustomComponentRepository,
} from "../ports/CustomComponentRepository";
import { isObject } from "../ui/bindings";
import { limitErrors, validateUiTree } from "../ui/validateTree";

/** The largest body is `{ "version": n }`. */
const BODY_LIMIT_BYTES = 1024;
const ROUTE = { bodyLimit: BODY_LIMIT_BYTES, config: { rateLimit: {} } };

export const UNAVAILABLE_MESSAGE = "Custom components are unavailable";

const REFUSAL_STATUS: Record<CustomComponentErrorCode, 404 | 409> = {
  not_found: 404,
  limit: 409,
  deleted: 409,
  conflict: 409,
  name_taken: 409,
};

export interface CustomComponentsRouterOptions {
  customComponents: CustomComponentRepository;
  /** The catalog previews are expanded into. */
  components: ComponentRepository;
}

type NameParams = { Params: { name: string } };

const send = (reply: FastifyReply, status: number, message: string) =>
  reply.status(status).send({ error: { message } });

const notFound = (reply: FastifyReply, name: string) =>
  send(reply, 404, `There is no custom component named "${name}".`);

/** A body that isn't `{ version: integer ≥ 1 }`, or `undefined` if it fits. */
function revertProblem(body: unknown): string | undefined {
  if (!isObject(body) || Object.keys(body).some((key) => key !== "version")) {
    return 'Expected a JSON object body with only "version".';
  }
  const { version } = body;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return "version must be an integer of at least 1.";
  }
  return undefined;
}

/** The definition fields of a stored version. */
function definitionOf(stored: StoredCustomComponent): CustomComponentDefinition {
  const { name, description, category, children, propsSchema, exampleProps, template } = stored;
  return { name, description, category, children, propsSchema, exampleProps, template };
}

/**
 * `component` with its example props, expanded and checked like a design, or
 * null with the problems. A deleted component previews like any other, so the
 * person can see what a restore brings back.
 */
async function preview(
  component: StoredCustomComponent,
  catalog: Component[],
  repository: CustomComponentRepository,
): Promise<Pick<CustomComponentDetail, "preview" | "previewErrors">> {
  const root = { ...component, deletedAt: null };
  const expansion = await expandTree(
    { component: component.name, props: component.exampleProps },
    {
      catalog,
      resolve: (name) => (name === component.name ? Promise.resolve(root) : repository.getByName(name)),
    },
  );
  const errors = [...expansion.errors];
  if (expansion.tree) {
    const check = validateUiTree(expansion.tree, catalog, undefined, undefined, {
      designChecks: false,
      maxNodes: MAX_EXPANDED_NODES,
      maxDepth: MAX_EXPANDED_DEPTH,
    });
    errors.push(...rewritePaths(check.errors, expansion.origins));
  }
  if (expansion.tree && errors.length === 0) return { preview: expansion.tree, previewErrors: [] };
  return { preview: null, previewErrors: limitErrors(errors) };
}

/**
 * A refusal's status and message, or 503 for anything else. Only the cause's
 * type, code and message are logged: a failed query's error holds its
 * parameters, which may be a definition.
 */
function fail(reply: FastifyReply, log: FastifyBaseLogger, err: unknown) {
  if (err instanceof CustomComponentError) return send(reply, REFUSAL_STATUS[err.code], err.message);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  const failure =
    cause instanceof Error
      ? { type: cause.name, code: (cause as { code?: unknown }).code, message: cause.message }
      : { type: typeof cause };
  log.error({ failure }, "custom components repository failed");
  return send(reply, 503, UNAVAILABLE_MESSAGE);
}

/**
 * The Components panel's view of custom components: list, read with a
 * preview, delete, restore and revert. Creating and editing stay with the
 * agent, so no route takes a definition.
 */
export const customComponentsRouter: FastifyPluginAsync<CustomComponentsRouterOptions> = async (app, opts) => {
  const repository = opts.customComponents;

  app.addHook("preHandler", async (req, reply) => {
    const { name } = req.params as { name?: string };
    if (name !== undefined && !CUSTOM_COMPONENT_NAME.test(name)) {
      return send(reply, 400, "name must start with a capital letter and use only letters and digits.");
    }
  });

  /** Every component, deleted ones included, by name. */
  app.get("/", ROUTE, async (req, reply) => {
    try {
      const { components } = await repository.list({ includeDeleted: true, limit: MAX_CUSTOM_COMPONENTS_TOTAL });
      const summaries: CustomComponentSummary[] = components.map(
        ({ name, description, category, version, versions, updatedAt, deletedAt }) => ({
          name,
          description,
          category,
          version,
          versions,
          updatedAt,
          deletedAt,
        }),
      );
      return { components: summaries };
    } catch (err) {
      return fail(reply, req.log, err);
    }
  });

  app.get<NameParams>("/:name", ROUTE, async (req, reply) => {
    const { name } = req.params;
    try {
      const component = await repository.getByName(name);
      if (!component) return notFound(reply, name);
      const [versions, catalog] = await Promise.all([repository.listVersions(name), opts.components.list()]);
      const detail: CustomComponentDetail = { component, versions, ...(await preview(component, catalog, repository)) };
      return detail;
    } catch (err) {
      return fail(reply, req.log, err);
    }
  });

  app.delete<NameParams>("/:name", ROUTE, async (req, reply) => {
    const { name } = req.params;
    try {
      if (!(await repository.softDelete(name))) return notFound(reply, name);
      return reply.status(204).send();
    } catch (err) {
      return fail(reply, req.log, err);
    }
  });

  app.post<NameParams>("/:name/restore", ROUTE, async (req, reply) => {
    const { name } = req.params;
    try {
      if (!(await repository.restore(name))) return notFound(reply, name);
      return reply.status(204).send();
    } catch (err) {
      return fail(reply, req.log, err);
    }
  });

  /** Saves a copy of an earlier version as the new current one. */
  app.post<NameParams>("/:name/revert", ROUTE, async (req, reply) => {
    const problem = revertProblem(req.body);
    if (problem) return send(reply, 400, problem);
    const { name } = req.params;
    const { version } = req.body as { version: number };
    try {
      const chosen = await repository.getVersion(name, version);
      if (!chosen) return send(reply, 404, `"${name}" has no version ${version}.`);
      const saved = await repository.save(definitionOf(chosen));
      return { version: saved.version };
    } catch (err) {
      return fail(reply, req.log, err);
    }
  });
};

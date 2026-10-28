import type { FastifyPluginAsync } from "fastify";
import { MAX_PROMPT_CHARS, type GenerateFailure, type GenerateSuccess } from "shared/generate";
import { randomUUID } from "node:crypto";
import type { ActionRegistry } from "../actions/types";
import type { DesignStore } from "../designs";
import { CustomComponentsUnavailableError } from "../generate/checkDesign";
import { generateComponent } from "../generate/generate";
import type { ComponentLlm } from "../ports/ComponentLlm";
import type { ComponentRepository } from "../ports/ComponentRepository";
import type { CustomComponentRepository } from "../ports/CustomComponentRepository";
import { isObject } from "../ui/bindings";

/** A prompt is at most 4,000 characters; the body stays well under this. */
const GENERATE_BODY_LIMIT_BYTES = 32 * 1024;

/** Longest a generation may take, repairs included. */
export const GENERATE_TIMEOUT_MS = 90000;

export interface GenerateRouterOptions {
  /** The model behind the generator. Without it, the route reports it isn't configured. */
  llm?: ComponentLlm;
  components?: ComponentRepository;
  customComponents?: CustomComponentRepository;
  actions: ActionRegistry;
  designs: DesignStore;
  /** Default `GENERATE_TIMEOUT_MS`. */
  timeoutMs?: number;
}

const fail = (message: string) => ({ error: { message } });

export const generateRouter: FastifyPluginAsync<GenerateRouterOptions> = async (app, opts) => {
  /**
   * Design a UI from a prompt and remember it under a new id. The prompt, the
   * design and the notes may hold personal data: only counts are logged.
   */
  app.post("/", { bodyLimit: GENERATE_BODY_LIMIT_BYTES, config: { rateLimit: {} } }, async (req, reply) => {
    if (!isObject(req.body)) return reply.status(400).send(fail("Expected a JSON object body."));
    const prompt = typeof req.body.prompt === "string" ? req.body.prompt.trim() : "";
    if (!prompt) return reply.status(400).send(fail("prompt is required."));
    if (prompt.length > MAX_PROMPT_CHARS) {
      return reply.status(400).send(fail(`Prompt is too long (max ${MAX_PROMPT_CHARS} characters).`));
    }
    if (!opts.llm || !opts.components) {
      return reply.status(503).send(fail("The generator is not configured: set OPENAI_API_KEY."));
    }

    const started = performance.now();
    const controller = new AbortController();
    // The response closing before it was sent means the client went away.
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(opts.timeoutMs ?? GENERATE_TIMEOUT_MS)]);

    const logGenerated = (fields: {
      designId?: string;
      ok: boolean;
      attempts: number;
      problems: number;
      promptTokens: number;
      cachedPromptTokens: number;
      completionTokens: number;
    }) => req.log.info({ ...fields, durationMs: Math.round(performance.now() - started) }, "design generated");

    let result;
    try {
      result = await generateComponent(prompt, {
        llm: opts.llm,
        components: opts.components,
        actions: opts.actions.specs,
        listChoices: opts.actions.listChoices,
        customComponents: opts.customComponents,
        log: req.log,
        signal,
      });
    } catch (err) {
      logGenerated({ ok: false, attempts: 0, problems: 0, promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0 });
      if (controller.signal.aborted) return reply;
      if (err instanceof CustomComponentsUnavailableError) {
        return reply.status(503).send(fail("Custom components are unavailable."));
      }
      return reply.status(502).send(fail("The model request failed."));
    }

    const attempts = result.attempts.length;
    const counts = {
      attempts,
      promptTokens: result.attempts.reduce((sum, a) => sum + (a.usage?.promptTokens ?? 0), 0),
      cachedPromptTokens: result.attempts.reduce((sum, a) => sum + (a.usage?.cachedPromptTokens ?? 0), 0),
      completionTokens: result.attempts.reduce((sum, a) => sum + (a.usage?.completionTokens ?? 0), 0),
    };
    if (!result.ok) {
      logGenerated({ ok: false, problems: result.problems.length, ...counts });
      const body: GenerateFailure = {
        ok: false,
        error: "The design still had problems after 3 tries.",
        problems: result.problems,
        attempts,
      };
      return reply.status(422).send(body);
    }

    const id = randomUUID();
    opts.designs.remember(id, result.tree);
    logGenerated({ designId: id, ok: true, problems: 0, ...counts });
    const body: GenerateSuccess = { ok: true, id, tree: result.tree, notes: result.notes, attempts };
    return body;
  });
};

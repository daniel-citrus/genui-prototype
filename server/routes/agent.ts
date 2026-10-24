import type { FastifyPluginAsync } from "fastify";
import { MAX_MESSAGE_CHARS, type AgentChatRequest, type AgentEvent } from "shared/api";
import type { AgentLlm } from "../ports/AgentLlm";
import type { TraceRepository } from "../ports/TraceRepository";
import type { ToolRegistry } from "../agent/tools";
import { runAgent } from "../agent/loop";
import { forgetConversation } from "../agent/conversations";
import type { AgentRun } from "../agent/run";

/** Chat bodies are a short message plus ids; 4,000 four-byte characters is about 16 KB of JSON. */
const CHAT_BODY_LIMIT_BYTES = 32 * 1024;

export interface AgentRouterOptions {
  /** The model behind the agent. Without it, `/chat` reports it isn't configured. */
  llm?: AgentLlm;
  tools: ToolRegistry;
  traces: TraceRepository;
}

export const agentRouter: FastifyPluginAsync<AgentRouterOptions> = async (app, opts) => {
  /** Stream a turn. SSE: one JSON `AgentEvent` per `data:` line. */
  app.post<{ Body: AgentChatRequest }>("/chat", { bodyLimit: CHAT_BODY_LIMIT_BYTES, config: { rateLimit: {} } }, async (req, reply) => {
    const { conversationId, message, resume } = req.body ?? {};
    if (
      typeof conversationId !== "string" ||
      !conversationId ||
      typeof message !== "string" ||
      !message.trim()
    ) {
      return reply
        .status(400)
        .send({ error: { message: "conversationId and message are required" } });
    }

    const text = message.trim();
    if (text.length > MAX_MESSAGE_CHARS) {
      return reply.status(400).send({
        error: { message: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).` },
      });
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    const controller = new AbortController();
    // The *response* closing means the client went away (Stop, navigation,
    // network). `req.raw` 'close' fires as soon as the POST body is consumed,
    // which is far too early.
    res.on("close", () => {
      if (!controller.signal.aborted) controller.abort();
    });

    const emit = (event: AgentEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      if (!opts.llm) {
        emit({
          type: "error",
          message: "The agent is not configured: set OPENAI_API_KEY.",
        });
        return;
      }
      const run: AgentRun = {
        emit,
        conversationId,
        signal: controller.signal,
        tools: opts.tools,
        log: req.log,
        traces: opts.traces,
        resume: Boolean(resume),
      };
      await runAgent(text, conversationId, run, opts.llm);
      emit({ type: "done" });
    } catch (err) {
      if (!controller.signal.aborted) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "The agent hit an error.",
        });
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  /** Forget a conversation's history and designs, whether or not it exists. */
  app.delete<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId",
    { config: { rateLimit: {} } },
    async (req, reply) => {
      const { conversationId } = req.params;
      await forgetConversation(conversationId);
      req.log.info({ conversationId }, "conversation forgotten");
      return reply.code(204).send();
    },
  );
};

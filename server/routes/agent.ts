import type { FastifyPluginAsync } from "fastify";
import type { AgentChatRequest, AgentEvent } from "shared/api";
import type { AgentLlm } from "../ports/AgentLlm";
import type { ToolRegistry } from "../agent/tools";
import { runAgent } from "../agent/loop";
import type { AgentRun } from "../agent/run";

export interface AgentRouterOptions {
  /** The model behind the agent. Without it, `/chat` reports it isn't configured. */
  llm?: AgentLlm;
  tools: ToolRegistry;
}

export const agentRouter: FastifyPluginAsync<AgentRouterOptions> = async (app, opts) => {
  /** Stream a turn. SSE: one JSON `AgentEvent` per `data:` line. */
  app.post<{ Body: AgentChatRequest }>("/chat", { config: { rateLimit: {} } }, async (req, reply) => {
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
        signal: controller.signal,
        tools: opts.tools,
        log: req.log,
        resume: Boolean(resume),
      };
      await runAgent(message.trim(), conversationId, run, opts.llm);
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
};

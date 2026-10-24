import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENERATE_UI_TOOL, MAX_PROMPT_CHARS } from "shared/generate";
import { buildApp } from "../app";
import { emptyToolRegistry } from "../agent/tools";
import { catalog } from "../catalog/components";
import { createDesignStore } from "../designs";
import type { ComponentLlm, LlmReply } from "../ports/ComponentLlm";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { InMemoryCustomComponentRepository } from "../ports/fakes/InMemoryCustomComponentRepository";
import { InMemoryTraceRepository } from "../ports/fakes/InMemoryTraceRepository";

const heading = { component: "Heading", props: { text: "Hello", level: 1 } };
const good = JSON.stringify({ tree: heading, notes: "All set." });
const bad = JSON.stringify({ tree: { component: "Nope" }, notes: "" });

type Script = (string | Partial<LlmReply> | Error)[];

/** A fake model that plays `replies` in order. */
function scripted(replies: Script) {
  let calls = 0;
  const llm: ComponentLlm = {
    async complete() {
      const next = replies[calls++];
      if (next === undefined) throw new Error("no more scripted replies");
      if (next instanceof Error) throw next;
      if (typeof next === "string") return { content: next, truncated: false };
      return { content: null, truncated: false, ...next };
    },
  };
  return { llm, calls: () => calls };
}

async function build(opts: {
  llm?: ComponentLlm;
  max?: number;
  logLines?: string[];
  timeoutMs?: number;
  customComponents?: InMemoryCustomComponentRepository;
} = {}) {
  const designs = createDesignStore({ max: 10 });
  const app = await buildApp({
    tools: emptyToolRegistry,
    componentLlm: opts.llm,
    components: new InMemoryComponentRepository(catalog),
    customComponents: opts.customComponents,
    designs,
    generateTimeoutMs: opts.timeoutMs,
    rateLimit: { max: opts.max ?? 1000 },
    logLevel: opts.logLines ? "info" : undefined,
    logStream: opts.logLines && { write: (line) => void opts.logLines?.push(line) },
    traces: new InMemoryTraceRepository(),
  });
  return { app, designs };
}

const post = (app: Awaited<ReturnType<typeof build>>["app"], payload: unknown, remoteAddress = "10.0.0.1") =>
  app.inject({
    method: "POST",
    url: "/api/generate",
    headers: { "content-type": "application/json" },
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    remoteAddress,
  });

describe("POST /api/generate", () => {
  it("answers 200 with the design and remembers it under its id", async () => {
    const { llm } = scripted([{ content: good }]);
    const { app, designs } = await build({ llm });
    const res = await post(app, { prompt: "say hello" });
    await app.close();
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.match(body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(body.tree, heading);
    assert.equal(body.notes, "All set.");
    assert.equal(body.attempts, 1);
    assert.deepEqual(designs.get(body.id), heading);
  });

  it("repairs a bad first design and reports the attempts", async () => {
    const { llm } = scripted([bad, good]);
    const { app } = await build({ llm });
    const res = await post(app, { prompt: "x" });
    await app.close();
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().attempts, 2);
  });

  it("answers 422 with the problems when the design never passes", async () => {
    const { llm } = scripted([bad, bad, bad]);
    const { app } = await build({ llm });
    const res = await post(app, { prompt: "x" });
    await app.close();
    assert.equal(res.statusCode, 422);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "The design still had problems after 3 tries.");
    assert.equal(body.attempts, 3);
    assert.ok(Array.isArray(body.problems) && body.problems.length > 0);
  });

  it("answers 400 for a body that is not a usable prompt", async () => {
    const { llm, calls } = scripted([]);
    const { app } = await build({ llm });
    const a = app;
    const cases: unknown[] = ["[]", "null", '"text"', "{not json", "{}", { prompt: 5 }, { prompt: "   " }];
    for (const payload of cases) {
      const res = await post(a, payload);
      assert.equal(res.statusCode, 400, JSON.stringify(payload));
      assert.equal(typeof res.json().error.message, "string");
    }
    const long = await post(a, { prompt: "a".repeat(MAX_PROMPT_CHARS + 1) });
    assert.equal(long.statusCode, 400);
    assert.equal(long.json().error.message, `Prompt is too long (max ${MAX_PROMPT_CHARS} characters).`);
    await a.close();
    assert.equal(calls(), 0);
  });

  it("counts the prompt length after trimming", async () => {
    const { llm } = scripted([good]);
    const { app } = await build({ llm });
    const res = await post(app, { prompt: `  ${"a".repeat(MAX_PROMPT_CHARS)}  ` });
    await app.close();
    assert.equal(res.statusCode, 200);
  });

  it("answers 413 for a body over 32 KB", async () => {
    const { app } = await build({ llm: scripted([]).llm });
    const a = app;
    const res = await post(a, { prompt: "a".repeat(33 * 1024) });
    await a.close();
    assert.equal(res.statusCode, 413);
  });

  it("answers 429 with Retry-After past the limit, counted apart from actions", async () => {
    const { llm } = scripted([good, good, good]);
    const { app } = await build({ llm, max: 2 });
    const a = app;
    assert.equal((await post(a, { prompt: "x" })).statusCode, 200);
    assert.equal((await post(a, { prompt: "x" })).statusCode, 200);
    const limited = await post(a, { prompt: "x" });
    assert.equal(limited.statusCode, 429);
    assert.ok(limited.headers["retry-after"]);
    const action = await a.inject({
      method: "POST",
      url: "/api/actions/run",
      payload: { designId: "gone", action: "a", values: {} },
      remoteAddress: "10.0.0.1",
    });
    assert.equal(action.statusCode, 409);
    await a.close();
  });

  it("answers 503 when no model is configured", async () => {
    const { app } = await build();
    const a = app;
    const res = await post(a, { prompt: "x" });
    await a.close();
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.message, "The generator is not configured: set OPENAI_API_KEY.");
  });

  it("answers 502 without details when the model call fails", async () => {
    const { llm } = scripted([new Error("secret upstream detail")]);
    const { app } = await build({ llm });
    const a = app;
    const res = await post(a, { prompt: "x" });
    await a.close();
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.includes("secret"), false);
    assert.equal(res.json().error.message, "The model request failed.");
  });

  it("answers 502 when the model call outlasts the timeout", async () => {
    const llm: ComponentLlm = {
      complete: ({ signal }) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    };
    const { app } = await build({ llm, timeoutMs: 20 });
    const a = app;
    const res = await post(a, { prompt: "x" });
    await a.close();
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.message, "The model request failed.");
  });

  it("answers 503 when custom components are unavailable", async () => {
    const down = new InMemoryCustomComponentRepository();
    down.getByName = down.list = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const design = JSON.stringify({ tree: { component: "MenuItemCard", props: {} }, notes: "" });
    const { llm } = scripted([design]);
    const { app } = await build({ llm, customComponents: down });
    const a = app;
    const res = await post(a, { prompt: "x" });
    await a.close();
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.message, "Custom components are unavailable.");
  });

  it("aborts the model call and starts no further attempt when the client disconnects", async () => {
    let calls = 0;
    let started!: () => void;
    const modelStarted = new Promise<void>((r) => (started = r));
    let aborted = false;
    const llm: ComponentLlm = {
      complete: ({ signal }) => {
        calls++;
        started();
        return new Promise((_, reject) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(signal.reason);
          }),
        );
      },
    };
    const { app } = await build({ llm });
    const a = app;
    await a.listen({ port: 0, host: "127.0.0.1" });
    const address = a.server.address();
    assert.ok(address && typeof address === "object");
    const controller = new AbortController();
    const request = fetch(`http://127.0.0.1:${address.port}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "x" }),
      signal: controller.signal,
    }).catch(() => undefined);
    await modelStarted;
    controller.abort();
    await request;
    for (let i = 0; i < 50 && !aborted; i++) await new Promise((r) => setTimeout(r, 10));
    await a.close();
    assert.equal(aborted, true);
    assert.equal(calls, 1);
  });

  it("accepts a body valid for GENERATE_UI_TOOL and ignores an extra key", async () => {
    assert.equal(GENERATE_UI_TOOL.name, "generate_ui");
    assert.ok(GENERATE_UI_TOOL.description.length <= 600);
    const { properties, required, additionalProperties, type } = GENERATE_UI_TOOL.parameters;
    assert.equal(type, "object");
    assert.deepEqual(required, ["prompt"]);
    assert.equal(additionalProperties, false);
    assert.deepEqual(Object.keys(properties as object), ["prompt"]);
    assert.equal((properties as { prompt: { maxLength: number } }).prompt.maxLength, 4000);
    const { llm } = scripted([good, good]);
    const { app } = await build({ llm });
    const a = app;
    assert.equal((await post(a, { prompt: "a heading" })).statusCode, 200);
    assert.equal((await post(a, { prompt: "a heading", extra: true })).statusCode, 200);
    await a.close();
  });

  it("logs one `design generated` line with counts and never the prompt or output", async () => {
    const marker = "MARKER-7f3a9";
    const logLines: string[] = [];
    const reply = JSON.stringify({ tree: { component: "Heading", props: { text: marker, level: 1 } }, notes: marker });
    const { llm } = scripted([{ content: reply, usage: { promptTokens: 7, completionTokens: 3 } }]);
    const { app } = await build({ llm, logLines });
    const a = app;
    const res = await post(a, { prompt: `show ${marker}` });
    await a.close();
    assert.equal(res.statusCode, 200);

    const lines = logLines.flatMap((chunk) => chunk.split("\n")).filter(Boolean);
    assert.equal(lines.some((line) => line.includes(marker)), false);
    const generated = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e.msg === "design generated");
    assert.equal(generated.length, 1);
    const [entry] = generated;
    assert.equal(entry.designId, res.json().id);
    assert.equal(entry.ok, true);
    assert.equal(entry.attempts, 1);
    assert.equal(entry.problems, 0);
    assert.equal(entry.promptTokens, 7);
    assert.equal(entry.completionTokens, 3);
    assert.equal(typeof entry.durationMs, "number");
  });
});

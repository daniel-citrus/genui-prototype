import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { AgentTrace } from "../agent/trace";
import { config } from "../config";
import type { EvalCase, EvalCaseResult } from "./types";
import { loadCases } from "./loadCases";
import { main } from "./cli";
import { evalLogDirName } from "./writeLog";

const committedCasesDir = join(dirname(fileURLToPath(import.meta.url)), "cases");

const committedCases: EvalCase[] = [
  {
    id: "catalog-layout",
    prompt:
      "Show a Card titled Specials. Inside it put a Heading that says Today's drinks and a Text line under the heading. Group them with a Stack.",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolSucceeded: "render_ui" },
      { uiComponent: "Stack" },
      { uiComponent: "Card" },
      { uiComponent: "Heading" },
      { uiComponent: "Text" },
    ],
  },
  {
    id: "define-and-use-custom",
    prompt:
      "Define a reusable custom component named PromoBanner: a Card whose children are a Heading and a Text. Then show PromoBanner.",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolSucceeded: "define_component" },
      { toolSucceeded: "render_ui" },
      { uiComponent: "PromoBanner" },
    ],
  },
  {
    id: "delete-custom",
    prompt:
      "Define a custom component named TempNotice that is a Card with a Heading. Then delete TempNotice. You do not need to show it.",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolSucceeded: "define_component" },
      { toolSucceeded: "delete_component" },
    ],
  },
  {
    id: "echo-form",
    prompt:
      "Show a form with a text field and a button that runs the demo echo action with what I type",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolCalled: "list_actions" },
      { toolSucceeded: "render_ui" },
      { uiButtonAction: "demo_echo" },
      { uiNamedInput: "text" },
    ],
  },
  {
    id: "menu-create-item",
    prompt: "Show a form to add a new drink to the café menu.",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolCalled: "list_actions" },
      { toolSucceeded: "render_ui" },
      { uiButtonAction: "menu_create_item" },
      { uiNamedInput: "name" },
      { uiNamedInput: "size" },
      { uiNamedInput: "price" },
    ],
  },
  {
    id: "menu-delete-category",
    prompt:
      "Show a form to delete a menu category. Say that the person will be asked to confirm before it runs.",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolCalled: "list_actions" },
      { toolSucceeded: "render_ui" },
      { uiButtonAction: "menu_delete_category" },
      { uiNamedInput: "category" },
    ],
  },
  {
    id: "mockup-no-action",
    prompt:
      "Show a mockup signup form with an email field, a password field, and a Create account button. The button must not run a server action.",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolNotCalled: "list_actions" },
      { toolSucceeded: "render_ui" },
      { uiComponent: "TextInput" },
      { uiComponent: "Button" },
    ],
  },
  {
    id: "off-topic-refusal",
    prompt: "What's the weather in Paris tomorrow?",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolNotCalled: "list_components" },
      { toolNotCalled: "list_actions" },
      { toolNotCalled: "render_ui" },
    ],
  },
  {
    id: "simple-heading",
    prompt: "Show a heading that says Hello",
    checks: [
      { endedBy: "reply" },
      { noError: true },
      { toolSucceeded: "render_ui" },
      { uiComponent: "Heading" },
    ],
  },
];

describe("eval cli committed cases", () => {
  it("loads all committed cases sorted by id", () => {
    const cases = loadCases(committedCasesDir);
    assert.deepEqual(cases, committedCases);
  });
});

function sampleTrace(id: string, overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    conversationId: `eval:${id}:test`,
    userText: "",
    endedBy: "stopped",
    steps: 0,
    toolCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    completions: [],
    ...overrides,
  };
}

function okResult(id: string, trace?: AgentTrace): EvalCaseResult {
  return {
    id,
    ok: true,
    failures: [],
    trace: trace ?? sampleTrace(id),
  };
}

function tempLogRoot(): string {
  return mkdtempSync(join(os.tmpdir(), "eval-cli-logs-"));
}

function unusedLogRoot(): string {
  return join(
    os.tmpdir(),
    `eval-cli-logs-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

describe("eval cli main", () => {
  it("refuses when the agent is not available", async () => {
    const logRoot = unusedLogRoot();
    const lines: string[] = [];
    let loadCalled = false;
    let runCalled = false;
    let llmCalled = false;

    const code = await main({
      agentAvailable: false,
      logRoot,
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
      inject: {
        loadCases: () => {
          loadCalled = true;
          return [];
        },
        runEvalCase: async () => {
          runCalled = true;
          return okResult("x");
        },
        createOpenAILlm: () => {
          llmCalled = true;
          return {
            async complete() {
              return { content: null, toolCalls: [] };
            },
          };
        },
      },
    });

    assert.notEqual(code, 0);
    assert.equal(lines.join("\n"), "OPENAI_API_KEY is required to run eval cases.");
    assert.equal(loadCalled, false);
    assert.equal(runCalled, false);
    assert.equal(llmCalled, false);
    assert.equal(existsSync(logRoot), false);
  });

  it("writes one json file per case and prints the log directory path", async () => {
    const logRoot = tempLogRoot();
    const fixedNow = new Date("2026-01-15T12:34:56.789Z");
    const stdout: string[] = [];
    const cases: EvalCase[] = [
      { id: "alpha-case", prompt: "p1", checks: [{ noError: true }] },
      { id: "beta-case", prompt: "p2", checks: [{ endedBy: "reply" }] },
    ];

    const code = await main({
      agentAvailable: true,
      logRoot,
      now: () => fixedNow,
      log: (line) => stdout.push(line),
      error: () => {},
      inject: {
        loadCases: () => cases,
        runEvalCase: async (evalCase) => okResult(evalCase.id),
        createOpenAILlm: () => ({
          async complete() {
            return { content: null, toolCalls: [] };
          },
        }),
      },
    });

    assert.equal(code, 0);
    const dirName = evalLogDirName(fixedNow);
    const dir = join(logRoot, dirName);
    assert.equal(basename(dir), dirName);
    assert.equal(existsSync(join(dir, "alpha-case.json")), true);
    assert.equal(existsSync(join(dir, "beta-case.json")), true);
    assert.equal(stdout.at(-1), `logs ${resolve(dir)}`);
    rmSync(logRoot, { recursive: true, force: true });
  });

  it("returns 1 when the log directory already exists for the same timestamp", async () => {
    const logRoot = tempLogRoot();
    const fixedNow = new Date("2026-01-15T12:34:56.789Z");
    const stderr: string[] = [];
    let runCalled = false;
    let llmCalled = false;

    const inject = {
      loadCases: (): EvalCase[] => [
        { id: "only-case", prompt: "p", checks: [{ noError: true }] },
      ],
      runEvalCase: async () => {
        runCalled = true;
        return okResult("only-case");
      },
      createOpenAILlm: () => {
        llmCalled = true;
        return {
          async complete() {
            return { content: null, toolCalls: [] };
          },
        };
      },
    };

    const first = await main({
      agentAvailable: true,
      logRoot,
      now: () => fixedNow,
      log: () => {},
      error: () => {},
      inject,
    });
    assert.equal(first, 0);
    runCalled = false;
    llmCalled = false;

    const sentinel = "SENTINEL_CREATE_DIR_MESSAGE";
    const second = await main({
      agentAvailable: true,
      logRoot,
      now: () => fixedNow,
      log: () => {},
      error: (line) => stderr.push(line),
      inject: {
        ...inject,
        createEvalLogDir: (_root, _now) => {
          const err = new Error(sentinel) as NodeJS.ErrnoException;
          err.code = "EEXIST";
          throw err;
        },
      },
    });

    assert.equal(second, 1);
    assert.equal(runCalled, false);
    assert.equal(llmCalled, false);
    assert.equal(stderr.join("\n"), "failed to create eval log directory EEXIST");
    assert.doesNotMatch(stderr.join("\n"), new RegExp(sentinel));
    rmSync(logRoot, { recursive: true, force: true });
  });

  it("does not create a log directory when loadCases throws", async () => {
    const logRoot = unusedLogRoot();
    let llmCalled = false;

    await assert.rejects(
      () =>
        main({
          agentAvailable: true,
          logRoot,
          log: () => {},
          error: () => {},
          inject: {
            loadCases: () => {
              throw new Error("load failed");
            },
            createOpenAILlm: () => {
              llmCalled = true;
              return {
                async complete() {
                  return { content: null, toolCalls: [] };
                },
              };
            },
          },
        }),
      /load failed/,
    );

    assert.equal(llmCalled, false);
    assert.equal(existsSync(logRoot), false);
  });

  it("handles an empty case list", async () => {
    const logRoot = tempLogRoot();
    const fixedNow = new Date("2026-02-01T00:00:00.000Z");
    const stdout: string[] = [];
    let runCalled = false;

    const code = await main({
      agentAvailable: true,
      logRoot,
      now: () => fixedNow,
      log: (line) => stdout.push(line),
      error: () => {},
      inject: {
        loadCases: () => [],
        runEvalCase: async () => {
          runCalled = true;
          return okResult("x");
        },
        createOpenAILlm: () => ({
          async complete() {
            return { content: null, toolCalls: [] };
          },
        }),
      },
    });

    assert.equal(code, 0);
    assert.equal(runCalled, false);
    const dir = join(logRoot, evalLogDirName(fixedNow));
    assert.equal(existsSync(dir), true);
    assert.deepEqual(stdout, [`logs ${resolve(dir)}`]);
    rmSync(logRoot, { recursive: true, force: true });
  });

  it("keeps sentinels in json logs but not on stdout or stderr", async () => {
    const logRoot = tempLogRoot();
    const fixedNow = new Date("2026-04-01T10:00:00.000Z");
    const promptSentinel = "PROMPT_SENTINEL_XYZ";
    const completionSentinel = "COMPLETION_SENTINEL_XYZ";
    const toolArgsSentinel = "TOOL_ARGS_SENTINEL_XYZ";
    const uiSentinel = "UI_TREE_SENTINEL_XYZ";
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await main({
      agentAvailable: true,
      logRoot,
      now: () => fixedNow,
      log: (line) => stdout.push(line),
      error: (line) => stderr.push(line),
      inject: {
        loadCases: () => [
          { id: "sentinel-case", prompt: promptSentinel, checks: [{ noError: true }] },
        ],
        runEvalCase: async () => ({
          id: "sentinel-case",
          ok: true,
          failures: [],
          trace: sampleTrace("sentinel-case", {
            completions: [
              {
                allowTools: true,
                content: completionSentinel,
                truncated: false,
                toolCalls: [
                  {
                    call: {
                      id: "tc1",
                      name: "render_ui",
                      args: { markup: toolArgsSentinel },
                    },
                    result: { ok: true, summary: "rendered" },
                    ui: {
                      id: "ui1",
                      tree: { component: "Text", props: { text: uiSentinel } },
                    },
                  },
                ],
              },
            ],
          }),
        }),
        createOpenAILlm: () => ({
          async complete() {
            return { content: null, toolCalls: [] };
          },
        }),
      },
    });

    assert.equal(code, 0);
    assert.equal(stdout[0], "pass sentinel-case");
    const combinedOut = `${stdout.join("\n")}\n${stderr.join("\n")}`;
    for (const sentinel of [
      promptSentinel,
      completionSentinel,
      toolArgsSentinel,
      uiSentinel,
    ]) {
      assert.doesNotMatch(combinedOut, new RegExp(sentinel));
    }
    const json = readFileSync(
      join(logRoot, evalLogDirName(fixedNow), "sentinel-case.json"),
      "utf8",
    );
    for (const sentinel of [
      promptSentinel,
      completionSentinel,
      toolArgsSentinel,
      uiSentinel,
    ]) {
      assert.match(json, new RegExp(sentinel));
    }
    rmSync(logRoot, { recursive: true, force: true });
  });

  it("logs timeout results from the aborted signal trace", async () => {
    const logRoot = tempLogRoot();
    const fixedNow = new Date("2026-05-01T10:00:00.000Z");
    const stdout: string[] = [];
    const timeoutTrace = sampleTrace("timeout-case", { steps: 3 });

    const code = await main({
      agentAvailable: true,
      logRoot,
      now: () => fixedNow,
      log: (line) => stdout.push(line),
      error: () => {},
      inject: {
        loadCases: () => [
          { id: "timeout-case", prompt: "p", checks: [{ noError: true }] },
        ],
        timeoutSignal: () => AbortSignal.abort(),
        runEvalCase: async () => ({
          id: "timeout-case",
          ok: false,
          failures: [{ check: { noError: true }, reason: "original failure" }],
          trace: timeoutTrace,
        }),
        createOpenAILlm: () => ({
          async complete() {
            return { content: null, toolCalls: [] };
          },
        }),
      },
    });

    assert.equal(code, 1);
    assert.match(stdout[0], /case timed out after 180 seconds/);
    const body = JSON.parse(
      readFileSync(
        join(logRoot, evalLogDirName(fixedNow), "timeout-case.json"),
        "utf8",
      ),
    );
    assert.equal(body.ok, false);
    assert.equal(body.failures[0].reason, "case timed out after 180 seconds");
    assert.deepEqual(body.trace, timeoutTrace);
    rmSync(logRoot, { recursive: true, force: true });
  });

  it("continues after a log write failure and returns 1", async () => {
    const logRoot = tempLogRoot();
    const stderr: string[] = [];
    const stdout: string[] = [];
    const sentinel = "WRITE_FAIL_SENTINEL";
    let runCount = 0;

    const code = await main({
      agentAvailable: true,
      logRoot,
      log: (line) => stdout.push(line),
      error: (line) => stderr.push(line),
      inject: {
        loadCases: () => [
          { id: "first-case", prompt: "p1", checks: [{ noError: true }] },
          { id: "second-case", prompt: "p2", checks: [{ noError: true }] },
        ],
        runEvalCase: async (evalCase) => {
          runCount += 1;
          return okResult(evalCase.id);
        },
        writeEvalCaseLog: (_dir, log) => {
          if (log.id === "first-case") {
            const err = new Error(sentinel) as NodeJS.ErrnoException;
            err.code = "EIO";
            throw err;
          }
        },
        createOpenAILlm: () => ({
          async complete() {
            return { content: null, toolCalls: [] };
          },
        }),
      },
    });

    assert.equal(code, 1);
    assert.equal(runCount, 2);
    assert.equal(stderr.join("\n"), "log failed first-case EIO");
    assert.deepEqual(stdout.slice(0, 2), ["pass first-case", "pass second-case"]);
    assert.doesNotMatch(stderr.join("\n"), new RegExp(sentinel));
    rmSync(logRoot, { recursive: true, force: true });
  });

  it("reports missing trace without writing a file", async () => {
    const logRoot = tempLogRoot();
    const stderr: string[] = [];
    const fixedNow = new Date("2026-03-01T08:00:00.000Z");

    const code = await main({
      agentAvailable: true,
      logRoot,
      now: () => fixedNow,
      log: () => {},
      error: (line) => stderr.push(line),
      inject: {
        loadCases: () => [
          { id: "no-trace", prompt: "p", checks: [{ noError: true }] },
          { id: "has-trace", prompt: "p2", checks: [{ noError: true }] },
        ],
        runEvalCase: async (evalCase) => {
          if (evalCase.id === "no-trace") {
            return {
              id: "no-trace",
              ok: true,
              failures: [],
              trace: undefined as unknown as AgentTrace,
            };
          }
          return okResult("has-trace");
        },
        createOpenAILlm: () => ({
          async complete() {
            return { content: null, toolCalls: [] };
          },
        }),
      },
    });

    assert.equal(code, 1);
    assert.equal(stderr[0], "log failed no-trace missing-trace");
    const dir = join(logRoot, evalLogDirName(fixedNow));
    assert.equal(existsSync(join(dir, "no-trace.json")), false);
    assert.equal(existsSync(join(dir, "has-trace.json")), true);
    rmSync(logRoot, { recursive: true, force: true });
  });

  it("does not leak the OpenAI api key into logs or terminal output", async () => {
    const logRoot = tempLogRoot();
    const fixedNow = new Date("2026-06-01T10:00:00.000Z");
    const secretKey = "sk-test-secret-key-12345";
    const stdout: string[] = [];
    const stderr: string[] = [];
    let capturedKey = "";
    const previousKey = config.openai.apiKey;
    config.openai.apiKey = secretKey;

    try {
      const code = await main({
        agentAvailable: true,
        logRoot,
        now: () => fixedNow,
        log: (line) => stdout.push(line),
        error: (line) => stderr.push(line),
        inject: {
          loadCases: () => [{ id: "key-case", prompt: "p", checks: [{ noError: true }] }],
          runEvalCase: async () => okResult("key-case"),
          createOpenAILlm: (opts) => {
            capturedKey = opts.apiKey;
            return {
              async complete() {
                return { content: null, toolCalls: [] };
              },
            };
          },
        },
      });

      assert.equal(capturedKey, secretKey);
      assert.equal(code, 0);
      const json = readFileSync(
        join(logRoot, evalLogDirName(fixedNow), "key-case.json"),
        "utf8",
      );
      const parsed = JSON.parse(json) as Record<string, unknown>;
      assert.equal(parsed.apiKey, undefined);
      assert.equal(parsed.systemPrompt, undefined);
      const combined = `${stdout.join("\n")}\n${stderr.join("\n")}\n${json}`;
      assert.doesNotMatch(combined, new RegExp(secretKey));
    } finally {
      config.openai.apiKey = previousKey;
      rmSync(logRoot, { recursive: true, force: true });
    }
  });
});

describe("eval cli gitignore", () => {
  it("ignores eval-logs/", () => {
    const gitignore = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../.gitignore"),
      "utf8",
    );
    assert.match(gitignore, /^eval-logs\/$/m);
  });
});

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { Generation } from "../generate/generate";
import type { ComponentLlm } from "../ports/ComponentLlm";
import { main, parseCliArgs, type CliMainOptions } from "./cli";
import type { EvalCase, EvalCaseResult } from "./types";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tree = { component: "Heading", props: { text: "Hi" } } as const;
const attempt = (problems: string[] = []) => ({ content: "{}", truncated: false, problems });
const designed = (attempts: number): Generation => ({
  ok: true,
  tree,
  notes: "Done.",
  attempts: Array.from({ length: attempts }, () => attempt()),
});

const cases: EvalCase[] = [
  { id: "alpha", prompt: "first", checks: [{ uiComponent: "Heading" }] },
  { id: "beta", prompt: "second", checks: [{ uiComponent: "Card" }] },
];

function run(args: string[], results: (c: EvalCase, n: number) => EvalCaseResult, over: Partial<CliMainOptions> = {}) {
  const logRoot = mkdtempSync(join(os.tmpdir(), "eval-cli-"));
  dirs.push(logRoot);
  const out: string[] = [];
  const err: string[] = [];
  const counts = new Map<string, number>();
  const llms: unknown[] = [];
  const done = main({
    argv: args,
    agentAvailable: true,
    logRoot,
    now: () => new Date("2026-10-24T01:02:03.004Z"),
    log: (l) => out.push(l),
    error: (l) => err.push(l),
    inject: {
      loadCases: () => cases,
      createOpenAIComponentLlm: (opts) => {
        llms.push(opts);
        return {} as ComponentLlm;
      },
      runEvalCase: async (c) => {
        const n = (counts.get(c.id) ?? 0) + 1;
        counts.set(c.id, n);
        return results(c, n);
      },
    },
    ...over,
  });
  return { done, out, err, logRoot, llms };
}

const pass = (c: EvalCase, attempts = 1): EvalCaseResult => ({ id: c.id, ok: true, failures: [], generation: designed(attempts) });
const failBeta = (c: EvalCase): EvalCaseResult =>
  c.id === "beta"
    ? { id: c.id, ok: false, failures: [{ check: c.checks[0]!, reason: 'uiComponent "Card": component not found in the tree' }], generation: designed(2) }
    : pass(c);

describe("parseCliArgs", () => {
  it("defaults to one run of every case and accepts 1 to 10", () => {
    assert.deepEqual(parseCliArgs([]), { ok: true, repeat: 1, cases: [] });
    assert.deepEqual(parseCliArgs(["--repeat", "10"]), { ok: true, repeat: 10, cases: [] });
  });

  it("collects each --case once, alongside --repeat", () => {
    assert.deepEqual(parseCliArgs(["--case", "b", "--repeat", "2", "--case=a", "--case", "b"]), { ok: true, repeat: 2, cases: ["b", "a"] });
  });

  it("refuses --case without an id", () => {
    for (const bad of [["--case"], ["--case="], ["--case", "--repeat", "2"]]) {
      assert.deepEqual(parseCliArgs(bad), { ok: false, error: "--case needs a case id" }, bad.join(" "));
    }
  });

  it("refuses bad repeats, unknown options and positionals", () => {
    for (const bad of [["--repeat", "0"], ["--repeat", "11"], ["--repeat", "x"], ["--repeat"]]) {
      assert.deepEqual(parseCliArgs(bad), { ok: false, error: "--repeat must be a whole number from 1 to 10" });
    }
    assert.deepEqual(parseCliArgs(["--nope"]), { ok: false, error: "unknown option --nope" });
    assert.deepEqual(parseCliArgs(["x"]), { ok: false, error: "unexpected argument x" });
  });
});

describe("main", () => {
  it("prints pass, first-try and logs lines and exits 0", async () => {
    const { done, out, logRoot, llms } = run([], (c) => pass(c));
    assert.equal(await done, 0);
    assert.equal(out[0], "pass alpha");
    assert.equal(out[1], "pass beta");
    assert.equal(out[2], "first-try 2/2");
    assert.match(out[3]!, /^usage 2 calls, 0 prompt tokens \(0 cached\), 0 completion tokens, \d+\.\ds$/);
    assert.match(out[4]!, /^logs .*2026-10-24T01-02-03\.004Z$/);
    assert.equal(out.length, 5);
    assert.ok(existsSync(join(logRoot, "2026-10-24T01-02-03.004Z", "alpha.json")));
    assert.equal(llms.length, 1);
    assert.ok(!("systemPrompt" in (llms[0] as object)));
  });

  it("prints a fail line with reasons and attempts, and exits 1", async () => {
    const { done, out } = run([], failBeta);
    assert.equal(await done, 1);
    assert.equal(out[1], 'fail beta uiComponent "Card": component not found in the tree; attempts: 2');
    assert.equal(out[2], "first-try 1/2");
  });

  it("counts only passes on the first attempt as first-try", async () => {
    const { done, out } = run([], (c) => pass(c, c.id === "alpha" ? 2 : 1));
    await done;
    assert.ok(out.includes("first-try 1/2"));
  });

  it("with --repeat prints labels, rates, first-try and numbered logs", async () => {
    const { done, out, logRoot } = run(["--repeat", "2"], (c, n) => (c.id === "beta" && n === 2 ? failBeta(c) : pass(c)));
    assert.equal(await done, 1);
    assert.deepEqual(out.slice(0, 4), ["pass alpha [1/2]", "pass alpha [2/2]", "pass beta [1/2]", out[3]]);
    assert.match(out[3]!, /^fail beta \[2\/2\] /);
    assert.deepEqual(out.slice(4, 7), ["rate alpha 2/2", "rate beta 1/2", "first-try 3/4"]);
    assert.ok(existsSync(join(logRoot, "2026-10-24T01-02-03.004Z", "beta.2.json")));
  });

  it("sums model calls and tokens across cases", async () => {
    const used = (c: EvalCase): EvalCaseResult => {
      const call = { ...attempt(), usage: { promptTokens: 100, cachedPromptTokens: 60, completionTokens: 10 } };
      return { id: c.id, ok: true, failures: [], generation: { ok: true, tree, notes: "", attempts: [call, call] } };
    };
    const { done, out } = run([], used);
    await done;
    assert.match(out[3]!, /^usage 4 calls, 400 prompt tokens \(240 cached\), 40 completion tokens, \d+\.\ds$/);
  });

  it("writes a log with attempts, duration, tree and notes", async () => {
    const { done, logRoot } = run([], failBeta);
    await done;
    const dir = join(logRoot, "2026-10-24T01-02-03.004Z");
    const ok = JSON.parse(readFileSync(join(dir, "alpha.json"), "utf8"));
    assert.deepEqual(ok.tree, tree);
    assert.equal(ok.notes, "Done.");
    assert.equal(ok.attempts.length, 1);
    assert.equal(typeof ok.durationMs, "number");
    assert.equal(ok.prompt, "first");
    const bad = JSON.parse(readFileSync(join(dir, "beta.json"), "utf8"));
    assert.equal(bad.ok, false);
    assert.equal(bad.attempts.length, 2);
    assert.equal(bad.failures[0].reason, 'uiComponent "Card": component not found in the tree');
  });

  it("logs a generation that gave up with attempts but no tree", async () => {
    const gaveUp: Generation = { ok: false, problems: ["bad"], attempts: [attempt(["bad"]), attempt(["bad"]), attempt(["bad"])] };
    const { done, out, logRoot } = run([], (c) => ({ id: c.id, ok: false, failures: [{ reason: "generation failed: 1 problems" }], generation: gaveUp }));
    assert.equal(await done, 1);
    assert.equal(out[0], "fail alpha generation failed: 1 problems; attempts: 3");
    const log = JSON.parse(readFileSync(join(logRoot, "2026-10-24T01-02-03.004Z", "alpha.json"), "utf8"));
    assert.equal(log.attempts.length, 3);
    assert.equal("tree" in log, false);
  });

  it("with --case runs only the named cases", async () => {
    const { done, out, logRoot } = run(["--case", "beta"], (c) => pass(c));
    assert.equal(await done, 0);
    assert.equal(out[0], "pass beta");
    assert.equal(out[1], "first-try 1/1");
    assert.deepEqual(readdirSync(join(logRoot, "2026-10-24T01-02-03.004Z")), ["beta.json"]);
  });

  it("refuses an unknown --case before running anything", async () => {
    let ran = 0;
    const { done, out, err, logRoot } = run(["--case", "alpha", "--case", "nope", "--case", "gone"], (c) => {
      ran++;
      return pass(c);
    });
    assert.equal(await done, 1);
    assert.deepEqual(err, ["unknown case nope, gone"]);
    assert.deepEqual(out, []);
    assert.equal(ran, 0);
    assert.deepEqual(readdirSync(logRoot), []);
  });

  it("prints a run error once, and a seed error with no attempts", async () => {
    const results = (c: EvalCase): EvalCaseResult =>
      c.id === "alpha"
        ? { id: c.id, ok: false, failures: [{ reason: "generation error: TypeError" }], error: "generation error: TypeError" }
        : { id: c.id, ok: false, failures: [], error: "seed Tag: bad template" };
    const { done, out, logRoot } = run([], results);
    assert.equal(await done, 1);
    assert.equal(out[0], "fail alpha generation error: TypeError");
    assert.equal(out[1], "fail beta error: seed Tag: bad template");
    assert.match(out[3]!, /^usage 0 calls, /);
    const log = JSON.parse(readFileSync(join(logRoot, "2026-10-24T01-02-03.004Z", "beta.json"), "utf8"));
    assert.equal(log.error, "seed Tag: bad template");
    assert.deepEqual(log.attempts, []);
  });

  it("reports a timed out case", async () => {
    const logRoot = mkdtempSync(join(os.tmpdir(), "eval-cli-"));
    dirs.push(logRoot);
    const out: string[] = [];
    const code = await main({
      agentAvailable: true,
      logRoot,
      log: (l) => out.push(l),
      error: () => {},
      inject: {
        loadCases: () => [cases[0]!],
        createOpenAIComponentLlm: () => ({}) as ComponentLlm,
        timeoutSignal: () => AbortSignal.abort(),
        runEvalCase: async (c) => ({ id: c.id, ok: true, failures: [], generation: designed(1) }),
      },
    });
    assert.equal(code, 1);
    assert.equal(out[0], "fail alpha case timed out after 180 seconds; attempts: 1");
    assert.equal(out[1], "first-try 0/1");
  });

  it("keeps the abort error of a case that timed out mid-call", async () => {
    const aborted = "generation error: AbortError";
    const { done, out } = run([], (c) => pass(c), {
      inject: {
        loadCases: () => [cases[0]!],
        createOpenAIComponentLlm: () => ({}) as ComponentLlm,
        timeoutSignal: () => AbortSignal.abort(),
        runEvalCase: async (c) => ({ id: c.id, ok: false, failures: [{ reason: aborted }], error: aborted }),
      },
    });
    assert.equal(await done, 1);
    assert.equal(out[0], `fail alpha case timed out after 180 seconds; error: ${aborted}`);
  });

  const used = { promptTokens: 100, cachedPromptTokens: 60, completionTokens: 10 };
  const partial = [
    { ...attempt(["bad"]), usage: used },
    { ...attempt(), repairPrompt: "That reply has problems:\n- bad\nReply again.", usage: used },
  ];

  it("logs and counts the attempts made before a generation error", async () => {
    const failed = "generation error: TypeError";
    const { done, out, logRoot } = run([], (c) => ({ id: c.id, ok: false, failures: [{ reason: failed }], attempts: partial, error: failed }));
    assert.equal(await done, 1);
    assert.equal(out[0], `fail alpha ${failed}; attempts: 2`);
    assert.match(out[3]!, /^usage 4 calls, 400 prompt tokens \(240 cached\), 40 completion tokens, /);
    const log = JSON.parse(readFileSync(join(logRoot, "2026-10-24T01-02-03.004Z", "alpha.json"), "utf8"));
    assert.deepEqual(log.attempts, partial);
    assert.equal(log.error, failed);
  });

  it("logs and counts the attempts of a case that timed out during a repair", async () => {
    const aborted = "generation error: AbortError";
    const { done, out, logRoot } = run([], (c) => pass(c), {
      inject: {
        loadCases: () => [cases[0]!],
        createOpenAIComponentLlm: () => ({}) as ComponentLlm,
        timeoutSignal: () => AbortSignal.abort(),
        runEvalCase: async (c) => ({ id: c.id, ok: false, failures: [{ reason: aborted }], attempts: partial, error: aborted }),
      },
    });
    assert.equal(await done, 1);
    assert.equal(out[0], `fail alpha case timed out after 180 seconds; attempts: 2; error: ${aborted}`);
    assert.match(out[2]!, /^usage 2 calls, 200 prompt tokens \(120 cached\), 20 completion tokens, /);
    const log = JSON.parse(readFileSync(join(logRoot, "2026-10-24T01-02-03.004Z", "alpha.json"), "utf8"));
    assert.deepEqual(log.failures, [{ reason: "case timed out after 180 seconds" }]);
    assert.deepEqual(log.attempts, partial);
    assert.equal(log.error, aborted);
  });

  it("refuses without an API key, and on bad arguments", async () => {
    const noKey = run([], (c) => pass(c), { agentAvailable: false });
    assert.equal(await noKey.done, 1);
    assert.deepEqual(noKey.err, ["OPENAI_API_KEY is required to run eval cases."]);
    const bad = run(["--repeat", "99"], (c) => pass(c));
    assert.equal(await bad.done, 1);
    assert.deepEqual(bad.err, ["--repeat must be a whole number from 1 to 10"]);
  });

  it("prints a bad case file's problem on one line and exits 1 before running anything", async () => {
    let ran = 0;
    const { done, out, err, logRoot } = run([], (c) => pass(c), {
      inject: {
        loadCases: () => {
          throw new Error("bad.json: unknown field \"extra\"");
        },
        createOpenAIComponentLlm: () => ({}) as ComponentLlm,
        runEvalCase: async (c) => {
          ran++;
          return pass(c);
        },
      },
    });
    assert.equal(await done, 1);
    assert.deepEqual(err, ['failed to load eval cases: bad.json: unknown field "extra"']);
    assert.deepEqual(out, []);
    assert.equal(ran, 0);
    assert.deepEqual(readdirSync(logRoot), []);
  });

  it("exits 1 before running any case when the log directory can't be made", async () => {
    let ran = 0;
    const failMkdir = (err: Error) =>
      run([], (c) => pass(c), {
        inject: {
          loadCases: () => cases,
          createOpenAIComponentLlm: () => ({}) as ComponentLlm,
          runEvalCase: async (c) => {
            ran++;
            return pass(c);
          },
          createEvalLogDir: () => {
            throw err;
          },
        },
      });
    const exists = failMkdir(Object.assign(new Error("x"), { code: "EEXIST" }));
    assert.equal(await exists.done, 1);
    assert.deepEqual(exists.err, ["failed to create eval log directory EEXIST"]);
    const odd = failMkdir(Object.assign(new Error("x"), { code: "../not a code" }));
    assert.equal(await odd.done, 1);
    assert.deepEqual(odd.err, ["failed to create eval log directory Error"]);
    assert.equal(ran, 0);
  });

  it("exits 1 and says so when a log can't be written, still running every case", async () => {
    const { done, out, err } = run([], (c) => pass(c), {
      inject: {
        loadCases: () => cases,
        createOpenAIComponentLlm: () => ({}) as ComponentLlm,
        runEvalCase: async (c) => pass(c),
        writeEvalCaseLog: () => {
          throw Object.assign(new Error("x"), { code: "EACCES" });
        },
      },
    });
    assert.equal(await done, 1);
    assert.deepEqual(err, ["log failed alpha EACCES", "log failed beta EACCES"]);
    assert.deepEqual(out.slice(0, 2), ["pass alpha", "pass beta"]);
  });
});

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  it("defaults to one run and accepts 1 to 10", () => {
    assert.deepEqual(parseCliArgs([]), { ok: true, repeat: 1 });
    assert.deepEqual(parseCliArgs(["--repeat", "10"]), { ok: true, repeat: 10 });
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

  it("refuses without an API key, and on bad arguments", async () => {
    const noKey = run([], (c) => pass(c), { agentAvailable: false });
    assert.equal(await noKey.done, 1);
    assert.deepEqual(noKey.err, ["OPENAI_API_KEY is required to run eval cases."]);
    const bad = run(["--repeat", "99"], (c) => pass(c));
    assert.equal(await bad.done, 1);
    assert.deepEqual(bad.err, ["--repeat must be a whole number from 1 to 10"]);
  });

  it("exits 1 and says so when a log can't be written", async () => {
    const { done, err } = run([], (c) => pass(c), {
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
    assert.equal(err[0], "log failed alpha EACCES");
  });
});

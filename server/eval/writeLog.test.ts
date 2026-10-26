import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createEvalLogDir, evalLogDirName, writeEvalCaseLog, type EvalCaseLog } from "./writeLog";

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(os.tmpdir(), "eval-log-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const log: EvalCaseLog = {
  id: "heading",
  prompt: "Show a heading",
  checks: [{ uiComponent: "Heading" }],
  ok: true,
  failures: [],
  attempts: [{ content: "{}", truncated: false, usage: { promptTokens: 3, completionTokens: 2 }, problems: [] }],
  tree: { component: "Heading", props: { text: "Hi" } },
  notes: "Done.",
};

describe("evalLogDirName / createEvalLogDir", () => {
  it("names the directory by the timestamp with colons replaced", () => {
    assert.equal(evalLogDirName(new Date("2026-10-24T01:02:03.004Z")), "2026-10-24T01-02-03.004Z");
  });

  it("creates the directory and refuses to reuse it", () => {
    const root = tmp();
    const now = new Date("2026-10-24T01:02:03.004Z");
    const dir = createEvalLogDir(root, now);
    assert.ok(existsSync(dir));
    assert.throws(() => createEvalLogDir(root, now));
  });
});

describe("writeEvalCaseLog", () => {
  it("writes id, prompt, checks, ok, failures, attempts, tree and notes", () => {
    const dir = tmp();
    writeEvalCaseLog(dir, log);
    const written = JSON.parse(readFileSync(join(dir, "heading.json"), "utf8"));
    assert.deepEqual(Object.keys(written), ["id", "prompt", "checks", "ok", "failures", "attempts", "tree", "notes"]);
    assert.deepEqual(written.attempts, log.attempts);
    assert.deepEqual(written.tree, log.tree);
  });

  it("writes error and omits tree and notes for a failed run", () => {
    const dir = tmp();
    const failed: EvalCaseLog = { id: "heading", prompt: "p", checks: [], ok: false, failures: [{ reason: "generation error: Error" }], attempts: [], error: "generation error: Error" };
    writeEvalCaseLog(dir, failed);
    const written = JSON.parse(readFileSync(join(dir, "heading.json"), "utf8"));
    assert.deepEqual(Object.keys(written), ["id", "prompt", "checks", "ok", "failures", "attempts", "error"]);
  });

  it("numbers files by repeat attempt", () => {
    const dir = tmp();
    writeEvalCaseLog(dir, log, 2);
    assert.ok(existsSync(join(dir, "heading.2.json")));
  });

  it("refuses a bad id, a bad attempt number, and overwriting", () => {
    const dir = tmp();
    assert.throws(() => writeEvalCaseLog(dir, { ...log, id: "../x" }), /kebab-case/);
    assert.throws(() => writeEvalCaseLog(dir, log, 11), /from 1 to 10/);
    writeEvalCaseLog(dir, log);
    assert.throws(() => writeEvalCaseLog(dir, log));
  });
});

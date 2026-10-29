import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { MAX_PROMPT_CHARS } from "shared/generate";
import { loadCases } from "./loadCases";

function caseDir(): string {
  return mkdtempSync(join(tmpdir(), "eval-cases-"));
}

function writeCase(dir: string, name: string, body: unknown): void {
  writeFileSync(join(dir, name), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

function loadOne(body: Record<string, unknown>) {
  const dir = caseDir();
  writeCase(dir, "c.json", { id: "c", prompt: "p", checks: [{ uiComponent: "Text" }], ...body });
  return () => loadCases(dir);
}

describe("loadCases", () => {
  it("loads every committed case", () => {
    const cases = loadCases(join(dirname(fileURLToPath(import.meta.url)), "cases"));
    assert.equal(cases.length, 33);
  });

  it("loads valid files sorted by id, not file name", () => {
    const dir = caseDir();
    writeCase(dir, "a.json", { id: "case-b", prompt: "second", checks: [{ maxAttempts: 2 }] });
    writeCase(dir, "b.json", { id: "case-a", prompt: "first", checks: [{ notesMaxWords: 5 }] });
    assert.deepEqual(loadCases(dir).map((c) => c.id), ["case-a", "case-b"]);
  });

  it("reads only .json files", () => {
    const dir = caseDir();
    writeCase(dir, "a.json", { id: "a", prompt: "p", checks: [{ uiText: "a" }] });
    writeFileSync(join(dir, "notes.md"), "{ not a case", "utf8");
    writeFileSync(join(dir, "a.json.bak"), "{ not a case", "utf8");
    assert.deepEqual(loadCases(dir).map((c) => c.id), ["a"]);
  });

  it("accepts every check type", () => {
    const checks = [
      { maxAttempts: 1 },
      { uiComponent: "A" },
      { noUiComponent: "A" },
      { uiButtonAction: "a" },
      { noButtonAction: true },
      { uiNamedInput: "a" },
      { uiText: "a" },
      { uiMarkupTag: "li" },
      { uiProps: { component: "A", props: { b: ["c"] } } },
      { agentComponent: "A" },
      { notesMaxWords: 40 },
      { notesExcludes: "a" },
      { notesMentions: ["a", "b"] },
    ];
    assert.deepEqual(loadOne({ checks })()[0]!.checks, checks);
  });

  for (const check of [
    { endedBy: "reply" },
    { noError: true },
    { toolCalled: "x" },
    { toolNotCalled: "x" },
    { toolSucceeded: "x" },
    { definedWithKey: "x" },
    { replyMaxWords: 40 },
    { replyExcludes: "x" },
  ]) {
    it(`refuses the removed check ${Object.keys(check)[0]}`, () => {
      assert.throws(loadOne({ checks: [check] }), /was removed/);
    });
  }

  it("refuses bad check values", () => {
    for (const maxAttempts of [0, 4, 1.5, "1"]) {
      assert.throws(loadOne({ checks: [{ maxAttempts }] }), /maxAttempts must be an integer from 1 to 3/);
    }
    for (const notesMaxWords of [0, 501, 2.5, "5"]) {
      assert.throws(loadOne({ checks: [{ notesMaxWords }] }), /notesMaxWords must be an integer from 1 to 500/);
    }
    assert.equal(loadOne({ checks: [{ notesMaxWords: 500 }] })().length, 1);
    assert.throws(loadOne({ checks: [{ notesExcludes: "" }] }), /non-empty string/);
    assert.throws(loadOne({ checks: [{ uiComponent: 3 }] }), /uiComponent must be a non-empty string/);
    for (const uiProps of [
      "Select",
      { component: "Select" },
      { component: "", props: { a: 1 } },
      { component: "Select", props: {} },
      { component: "Select", props: [1] },
      { component: "Select", props: { a: 1 }, extra: 1 },
    ]) {
      assert.throws(loadOne({ checks: [{ uiProps }] }), /uiProps must be \{"component"/, JSON.stringify(uiProps));
    }
    for (const notesMentions of ["a", [], [""], ["a", 1]]) {
      assert.throws(loadOne({ checks: [{ notesMentions }] }), /notesMentions must be a non-empty array/);
    }
    assert.throws(loadOne({ checks: ["uiText"] }), /c\.json checks\[0\]: expected a JSON object/);
    assert.throws(loadOne({ checks: [{ uiText: "a" }, null] }), /c\.json checks\[1\]: expected a JSON object/);
    assert.throws(loadOne({ checks: [{ noButtonAction: false }] }), /must be true/);
    assert.throws(loadOne({ checks: [{ bogus: 1 }] }), /unknown field "bogus"/);
    assert.throws(loadOne({ checks: [{ uiText: "a", uiComponent: "B" }] }), /exactly one key/);
    assert.throws(loadOne({ checks: [{}] }), /exactly one of/);
  });

  it("refuses a prompt over MAX_PROMPT_CHARS and accepts one at the limit", () => {
    assert.throws(loadOne({ prompt: "x".repeat(MAX_PROMPT_CHARS + 1) }), /prompt exceeds 4000 characters/);
    assert.equal(loadOne({ prompt: "x".repeat(MAX_PROMPT_CHARS) })().length, 1);
  });

  it("refuses invalid JSON, non-objects, and unknown fields", () => {
    const dir = caseDir();
    writeFileSync(join(dir, "bad.json"), "{ not json", "utf8");
    assert.throws(() => loadCases(dir), /invalid JSON/);
    writeFileSync(join(dir, "bad.json"), "[]", "utf8");
    assert.throws(() => loadCases(dir), /expected a JSON object/);
    assert.throws(loadOne({ extra: 1 }), /unknown field "extra"/);
  });

  it("refuses a bad id, an empty prompt, empty checks and duplicate ids", () => {
    assert.throws(loadOne({ id: 3 }), /id must be a string/);
    assert.throws(loadOne({ id: "Not Kebab" }), /kebab-case/);
    assert.throws(loadOne({ prompt: 5 }), /prompt must be a string/);
    assert.throws(loadOne({ prompt: "" }), /prompt must be non-empty/);
    assert.throws(loadOne({ checks: {} }), /checks must be an array/);
    assert.throws(loadOne({ checks: [] }), /checks must be non-empty/);
    const dir = caseDir();
    writeCase(dir, "a.json", { id: "same", prompt: "p", checks: [{ uiText: "a" }] });
    writeCase(dir, "b.json", { id: "same", prompt: "p", checks: [{ uiText: "a" }] });
    assert.throws(() => loadCases(dir), /duplicate id "same"/);
  });

  it("keeps customComponents and refuses a non-array", () => {
    assert.deepEqual(loadOne({ customComponents: [] })()[0]!.customComponents, []);
    assert.throws(loadOne({ customComponents: {} }), /customComponents must be an array/);
  });
});

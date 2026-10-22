import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { MAX_MESSAGE_CHARS } from "shared/api";
import { loadCases } from "./loadCases";

function caseDir(): string {
  return mkdtempSync(join(tmpdir(), "eval-cases-"));
}

function writeCase(dir: string, name: string, body: unknown): void {
  writeFileSync(join(dir, name), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

describe("loadCases", () => {
  it("loads valid files sorted by id", () => {
    const dir = caseDir();
    writeCase(dir, "b.json", {
      id: "case-b",
      prompt: "second",
      checks: [{ noError: true }],
    });
    writeCase(dir, "a.json", {
      id: "case-a",
      prompt: "first",
      checks: [{ endedBy: "reply" }],
    });

    const cases = loadCases(dir);
    assert.equal(cases.length, 2);
    assert.deepEqual(
      cases.map((c) => c.id),
      ["case-a", "case-b"],
    );
  });

  it("refuses invalid JSON", () => {
    const dir = caseDir();
    writeFileSync(join(dir, "bad.json"), "{ not json", "utf8");
    assert.throws(() => loadCases(dir), /invalid JSON/);
  });

  it("refuses non-object root", () => {
    const dir = caseDir();
    writeFileSync(join(dir, "bad.json"), "[]", "utf8");
    assert.throws(() => loadCases(dir), /expected a JSON object/);
  });

  it("refuses missing id", () => {
    const dir = caseDir();
    writeCase(dir, "bad.json", { prompt: "hi", checks: [{ noError: true }] });
    assert.throws(() => loadCases(dir), /id must be a string/);
  });

  it("refuses empty id", () => {
    const dir = caseDir();
    writeCase(dir, "bad.json", { id: "", prompt: "hi", checks: [{ noError: true }] });
    assert.throws(() => loadCases(dir), /id must be kebab-case/);
  });

  it("refuses non-kebab id", () => {
    const dir = caseDir();
    writeCase(dir, "bad.json", { id: "Bad_Case", prompt: "hi", checks: [{ noError: true }] });
    assert.throws(() => loadCases(dir), /id must be kebab-case/);
  });

  it("refuses empty prompt", () => {
    const dir = caseDir();
    writeCase(dir, "bad.json", { id: "ok", prompt: "", checks: [{ noError: true }] });
    assert.throws(() => loadCases(dir), /prompt must be non-empty/);
  });

  it("refuses prompt longer than MAX_MESSAGE_CHARS", () => {
    const dir = caseDir();
    writeCase(dir, "bad.json", {
      id: "ok",
      prompt: "a".repeat(MAX_MESSAGE_CHARS + 1),
      checks: [{ noError: true }],
    });
    assert.throws(() => loadCases(dir), /prompt exceeds/);
  });

  it("refuses empty checks", () => {
    const dir = caseDir();
    writeCase(dir, "bad.json", { id: "ok", prompt: "hi", checks: [] });
    assert.throws(() => loadCases(dir), /checks must be non-empty/);
  });

  it("refuses unknown check key", () => {
    const dir = caseDir();
    writeCase(dir, "bad.json", {
      id: "ok",
      prompt: "hi",
      checks: [{ mystery: true }],
    });
    assert.throws(() => loadCases(dir), /unknown field "mystery"/);
  });

  it("refuses two keys on one check", () => {
    const dir = caseDir();
    writeCase(dir, "bad.json", {
      id: "ok",
      prompt: "hi",
      checks: [{ noError: true, toolCalled: "render_ui" }],
    });
    assert.throws(() => loadCases(dir), /exactly one key/);
  });

  it("refuses noError other than true", () => {
    const dir = caseDir();
    writeCase(dir, "bad.json", {
      id: "ok",
      prompt: "hi",
      checks: [{ noError: false }],
    });
    assert.throws(() => loadCases(dir), /noError must be true/);
  });

  it("refuses extra case field", () => {
    const dir = caseDir();
    writeCase(dir, "bad.json", {
      id: "ok",
      prompt: "hi",
      checks: [{ noError: true }],
      tags: ["x"],
    });
    assert.throws(() => loadCases(dir), /unknown field "tags"/);
  });

  it("refuses extra check field", () => {
    const dir = caseDir();
    writeCase(dir, "bad.json", {
      id: "ok",
      prompt: "hi",
      checks: [{ noError: true, note: "x" }],
    });
    assert.throws(() => loadCases(dir), /unknown field "note"/);
  });

  it("refuses duplicate id across files", () => {
    const dir = caseDir();
    writeCase(dir, "one.json", { id: "dup", prompt: "a", checks: [{ noError: true }] });
    writeCase(dir, "two.json", { id: "dup", prompt: "b", checks: [{ noError: true }] });
    assert.throws(() => loadCases(dir), /duplicate id "dup"/);
  });

  it("throws when any file in the directory is invalid", () => {
    const dir = caseDir();
    writeCase(dir, "good.json", { id: "good", prompt: "hi", checks: [{ noError: true }] });
    writeCase(dir, "bad.json", { id: "", prompt: "hi", checks: [{ noError: true }] });
    assert.throws(() => loadCases(dir), /id must be kebab-case/);
  });
});

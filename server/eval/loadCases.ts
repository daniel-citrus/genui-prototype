import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_MESSAGE_CHARS } from "shared/api";
import type { EndedBy } from "../agent/trace";
import type { EvalCase, EvalCheck } from "./types";

const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CASE_KEYS = ["id", "prompt", "checks"] as const;
const CHECK_KEYS = [
  "endedBy",
  "noError",
  "toolCalled",
  "toolNotCalled",
  "toolSucceeded",
  "uiComponent",
  "uiButtonAction",
  "uiNamedInput",
  "uiText",
  "uiMarkupTag",
  "agentComponent",
  "noButtonAction",
  "replyMaxWords",
  "replyExcludes",
] as const;

const ENDED_BY: ReadonlySet<string> = new Set([
  "reply",
  "max_steps",
  "tool_budget",
  "token_budget",
  "stopped",
]);

function assertPlainObject(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context}: expected a JSON object`);
  }
  return value as Record<string, unknown>;
}

function refuseExtraKeys(obj: Record<string, unknown>, allowed: readonly string[], context: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new Error(`${context}: unknown field "${key}"`);
    }
  }
}

function parseCheck(raw: unknown, context: string): EvalCheck {
  const obj = assertPlainObject(raw, context);
  refuseExtraKeys(obj, CHECK_KEYS, context);

  const present = CHECK_KEYS.filter((key) => key in obj);
  if (present.length === 0) {
    throw new Error(`${context}: check must have exactly one of ${CHECK_KEYS.join(", ")}`);
  }
  if (present.length > 1) {
    throw new Error(`${context}: check must have exactly one key, got ${present.join(", ")}`);
  }

  const key = present[0];
  switch (key) {
    case "endedBy": {
      const value = obj.endedBy;
      if (typeof value !== "string" || !ENDED_BY.has(value)) {
        throw new Error(`${context}: endedBy must be one of ${[...ENDED_BY].join(", ")}`);
      }
      return { endedBy: value as EndedBy };
    }
    case "noError":
      if (obj.noError !== true) {
        throw new Error(`${context}: noError must be true`);
      }
      return { noError: true };
    case "noButtonAction":
      if (obj.noButtonAction !== true) {
        throw new Error(`${context}: noButtonAction must be true`);
      }
      return { noButtonAction: true };
    case "replyMaxWords": {
      const value = obj.replyMaxWords;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 500) {
        throw new Error(`${context}: replyMaxWords must be an integer from 1 to 500`);
      }
      return { replyMaxWords: value };
    }
    case "toolCalled":
    case "toolNotCalled":
    case "toolSucceeded":
    case "uiComponent":
    case "uiButtonAction":
    case "uiNamedInput":
    case "uiText":
    case "uiMarkupTag":
    case "agentComponent":
    case "replyExcludes": {
      const value = obj[key];
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${context}: ${key} must be a non-empty string`);
      }
      return { [key]: value } as EvalCheck;
    }
    default:
      throw new Error(`${context}: unknown check key`);
  }
}

function parseCase(raw: unknown, fileLabel: string): EvalCase {
  const obj = assertPlainObject(raw, fileLabel);
  refuseExtraKeys(obj, CASE_KEYS, fileLabel);

  if (typeof obj.id !== "string") {
    throw new Error(`${fileLabel}: id must be a string`);
  }
  if (!KEBAB_ID.test(obj.id)) {
    throw new Error(`${fileLabel}: id must be kebab-case`);
  }

  if (typeof obj.prompt !== "string") {
    throw new Error(`${fileLabel}: prompt must be a string`);
  }
  if (obj.prompt.length === 0) {
    throw new Error(`${fileLabel}: prompt must be non-empty`);
  }
  if (obj.prompt.length > MAX_MESSAGE_CHARS) {
    throw new Error(`${fileLabel}: prompt exceeds ${MAX_MESSAGE_CHARS} characters`);
  }

  if (!Array.isArray(obj.checks)) {
    throw new Error(`${fileLabel}: checks must be an array`);
  }
  if (obj.checks.length === 0) {
    throw new Error(`${fileLabel}: checks must be non-empty`);
  }

  const checks = obj.checks.map((check, i) => parseCheck(check, `${fileLabel} checks[${i}]`));

  return { id: obj.id, prompt: obj.prompt, checks };
}

export function loadCases(dir: string): EvalCase[] {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();

  const cases: EvalCase[] = [];
  const seenIds = new Map<string, string>();

  for (const name of names) {
    const path = join(dir, name);
    const fileLabel = name;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`${fileLabel}: invalid JSON (${detail})`);
    }

    const evalCase = parseCase(raw, fileLabel);
    const prev = seenIds.get(evalCase.id);
    if (prev !== undefined) {
      throw new Error(`duplicate id "${evalCase.id}" in ${fileLabel} (also in ${prev})`);
    }
    seenIds.set(evalCase.id, fileLabel);
    cases.push(evalCase);
  }

  cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return cases;
}

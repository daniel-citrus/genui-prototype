import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PROMPT_CHARS } from "shared/generate";
import type { CustomComponentDefinition } from "shared/customComponents";
import { MAX_ATTEMPTS } from "../generate/generate";
import { isObject } from "../ui/bindings";
import type { EvalCase, EvalCheck } from "./types";

const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CASE_KEYS = ["id", "prompt", "checks", "customComponents"] as const;
const CHECK_KEYS = [
  "maxAttempts",
  "uiComponent",
  "noUiComponent",
  "uiButtonAction",
  "noButtonAction",
  "uiNamedInput",
  "uiText",
  "uiMarkupTag",
  "uiProps",
  "agentComponent",
  "notesMaxWords",
  "notesExcludes",
  "notesMentions",
] as const;

const REMOVED_CHECK_KEYS = [
  "endedBy",
  "noError",
  "toolCalled",
  "toolNotCalled",
  "toolSucceeded",
  "definedWithKey",
  "replyMaxWords",
  "replyExcludes",
];

function assertPlainObject(value: unknown, context: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error(`${context}: expected a JSON object`);
  }
  return value;
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
  for (const key of REMOVED_CHECK_KEYS) {
    if (key in obj) throw new Error(`${context}: check "${key}" was removed`);
  }
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
    case "noButtonAction":
      if (obj.noButtonAction !== true) {
        throw new Error(`${context}: noButtonAction must be true`);
      }
      return { noButtonAction: true };
    case "maxAttempts": {
      const value = obj.maxAttempts;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_ATTEMPTS) {
        throw new Error(`${context}: maxAttempts must be an integer from 1 to ${MAX_ATTEMPTS}`);
      }
      return { maxAttempts: value };
    }
    case "notesMaxWords": {
      const value = obj.notesMaxWords;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 500) {
        throw new Error(`${context}: notesMaxWords must be an integer from 1 to 500`);
      }
      return { notesMaxWords: value };
    }
    case "uiProps": {
      const value = obj.uiProps;
      if (
        !isObject(value) ||
        Object.keys(value).some((field) => field !== "component" && field !== "props") ||
        typeof value.component !== "string" ||
        value.component.length === 0 ||
        !isObject(value.props) ||
        Object.keys(value.props).length === 0
      ) {
        throw new Error(`${context}: uiProps must be {"component": "<Name>", "props": {...}} with at least one prop`);
      }
      return { uiProps: { component: value.component, props: value.props } };
    }
    case "notesMentions": {
      const value = obj.notesMentions;
      if (!Array.isArray(value) || value.length === 0 || !value.every((text) => typeof text === "string" && text.length > 0)) {
        throw new Error(`${context}: notesMentions must be a non-empty array of non-empty strings`);
      }
      return { notesMentions: value as string[] };
    }
    case "uiComponent":
    case "uiButtonAction":
    case "uiNamedInput":
    case "uiText":
    case "uiMarkupTag":
    case "agentComponent":
    case "noUiComponent":
    case "notesExcludes": {
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
  if (obj.prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`${fileLabel}: prompt exceeds ${MAX_PROMPT_CHARS} characters`);
  }

  if (!Array.isArray(obj.checks)) {
    throw new Error(`${fileLabel}: checks must be an array`);
  }
  if (obj.checks.length === 0) {
    throw new Error(`${fileLabel}: checks must be non-empty`);
  }

  const checks = obj.checks.map((check, i) => parseCheck(check, `${fileLabel} checks[${i}]`));

  const evalCase: EvalCase = { id: obj.id, prompt: obj.prompt, checks };
  if (obj.customComponents !== undefined) {
    if (!Array.isArray(obj.customComponents)) {
      throw new Error(`${fileLabel}: customComponents must be an array`);
    }
    evalCase.customComponents = obj.customComponents as CustomComponentDefinition[];
  }
  return evalCase;
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

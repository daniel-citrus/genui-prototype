import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { UiNode } from "shared/ui";
import type { GenerationAttempt } from "../generate/generate";
import type { EvalCheck, CheckFailure } from "./types";

const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface EvalCaseLog {
  id: string;
  prompt: string;
  checks: EvalCheck[];
  ok: boolean;
  failures: CheckFailure[];
  /** Every model call made, with its raw reply; empty when generation never ran. */
  attempts: GenerationAttempt[];
  /** Wall time of the case, model calls included. */
  durationMs?: number;
  tree?: UiNode;
  notes?: string;
  error?: string;
}

export function evalLogDirName(now: Date): string {
  return now.toISOString().replaceAll(":", "-");
}

export function createEvalLogDir(root: string, now: Date): string {
  mkdirSync(root, { recursive: true });
  const dir = join(root, evalLogDirName(now));
  mkdirSync(dir);
  return dir;
}

function buildLogRecord(log: EvalCaseLog): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: log.id,
    prompt: log.prompt,
    checks: log.checks,
    ok: log.ok,
    failures: log.failures,
  };
  record.attempts = log.attempts;
  if (log.durationMs !== undefined) record.durationMs = log.durationMs;
  if (log.tree !== undefined) record.tree = log.tree;
  if (log.notes !== undefined) record.notes = log.notes;
  if (log.error !== undefined) record.error = log.error;
  return record;
}

export function writeEvalCaseLog(dir: string, log: EvalCaseLog, attempt?: number): void {
  if (!KEBAB_ID.test(log.id)) {
    throw new Error("eval log id must be kebab-case");
  }

  if (attempt !== undefined && !(Number.isInteger(attempt) && attempt >= 1 && attempt <= 10)) {
    throw new Error("eval log attempt must be a whole number from 1 to 10");
  }

  const fileName = attempt === undefined ? `${log.id}.json` : `${log.id}.${attempt}.json`;
  const filePath = join(dir, fileName);
  const resolvedDir = resolve(dir);
  const resolvedFile = resolve(filePath);
  const rel = relative(resolvedDir, resolvedFile);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("eval log path escapes the directory");
  }

  const body = `${JSON.stringify(buildLogRecord(log), null, 2)}\n`;
  writeFileSync(resolvedFile, body, { flag: "wx", encoding: "utf8" });
}

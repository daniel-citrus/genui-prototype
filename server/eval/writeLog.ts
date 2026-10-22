import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AgentTrace, EndedBy } from "../agent/trace";
import type { EvalCheck, CheckFailure } from "./types";

const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface EvalCaseLog {
  id: string;
  prompt: string;
  checks: EvalCheck[];
  ok: boolean;
  failures: CheckFailure[];
  endedBy?: EndedBy;
  error?: string;
  trace: AgentTrace;
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
  if (log.endedBy !== undefined) {
    record.endedBy = log.endedBy;
  }
  if (log.error !== undefined) {
    record.error = log.error;
  }
  record.trace = log.trace;
  return record;
}

export function writeEvalCaseLog(dir: string, log: EvalCaseLog): void {
  if (!KEBAB_ID.test(log.id)) {
    throw new Error("eval log id must be kebab-case");
  }

  const filePath = join(dir, `${log.id}.json`);
  const resolvedDir = resolve(dir);
  const resolvedFile = resolve(filePath);
  const rel = relative(resolvedDir, resolvedFile);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("eval log path escapes the directory");
  }

  const body = `${JSON.stringify(buildLogRecord(log), null, 2)}\n`;
  writeFileSync(resolvedFile, body, { flag: "wx", encoding: "utf8" });
}

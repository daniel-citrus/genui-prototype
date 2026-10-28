import { parseArgs } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createOpenAIComponentLlm } from "../adapters/openai/OpenAIComponentLlm";
import { agentAvailable, config } from "../config";
import { loadCases } from "./loadCases";
import { runEvalCase } from "./runner";
import type { EvalCaseResult } from "./types";
import {
  createEvalLogDir,
  writeEvalCaseLog,
  type EvalCaseLog,
} from "./writeLog";

const CASE_TIMEOUT_MS = 180_000;

const defaultCasesDir = join(dirname(fileURLToPath(import.meta.url)), "cases");

export type CliArgs = { ok: true; repeat: number } | { ok: false; error: string };

export type CliMainOptions = {
  argv?: string[];
  agentAvailable?: boolean;
  casesDir?: string;
  logRoot?: string;
  now?: () => Date;
  log?: (line: string) => void;
  error?: (line: string) => void;
  inject?: {
    loadCases?: typeof loadCases;
    runEvalCase?: typeof runEvalCase;
    createOpenAIComponentLlm?: typeof createOpenAIComponentLlm;
    createEvalLogDir?: typeof createEvalLogDir;
    writeEvalCaseLog?: typeof writeEvalCaseLog;
    timeoutSignal?: () => AbortSignal;
  };
};

const REPEAT_ERROR = "--repeat must be a whole number from 1 to 10";

export function parseCliArgs(argv: string[]): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { repeat: { type: "string" } },
      strict: true,
      allowPositionals: true,
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      const name = /'?(--?[^\s',]+)/.exec((err as Error).message)?.[1] ?? "option";
      return { ok: false, error: `unknown option ${name}` };
    }
    return { ok: false, error: REPEAT_ERROR };
  }
  if (parsed.positionals.length > 0) {
    return { ok: false, error: `unexpected argument ${parsed.positionals[0]}` };
  }
  const value = parsed.values.repeat;
  if (value === undefined) return { ok: true, repeat: 1 };
  const repeat = /^\d+$/.test(value) ? Number(value) : 0;
  if (repeat < 1 || repeat > 10) return { ok: false, error: REPEAT_ERROR };
  return { ok: true, repeat };
}

function attemptCount(result: EvalCaseResult): number | undefined {
  return result.generation?.attempts.length;
}

interface UsageTotals {
  calls: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  durationMs: number;
}

function addUsage(totals: UsageTotals, result: EvalCaseResult, durationMs: number): void {
  for (const attempt of result.generation?.attempts ?? []) {
    totals.calls++;
    totals.promptTokens += attempt.usage?.promptTokens ?? 0;
    totals.cachedPromptTokens += attempt.usage?.cachedPromptTokens ?? 0;
    totals.completionTokens += attempt.usage?.completionTokens ?? 0;
  }
  totals.durationMs += durationMs;
}

function formatUsage(t: UsageTotals): string {
  const seconds = (t.durationMs / 1000).toFixed(1);
  return `usage ${t.calls} calls, ${t.promptTokens} prompt tokens (${t.cachedPromptTokens} cached), ${t.completionTokens} completion tokens, ${seconds}s`;
}

function formatResult(result: EvalCaseResult, label = ""): string {
  if (result.ok) return `pass ${result.id}${label}`;
  const parts = result.failures.map((f) => f.reason);
  const attempts = attemptCount(result);
  if (attempts !== undefined) parts.push(`attempts: ${attempts}`);
  if (result.error !== undefined && !parts.includes(result.error)) parts.push(`error: ${result.error}`);
  return `fail ${result.id}${label} ${parts.join("; ")}`;
}

function timeoutResult(id: string, partial: EvalCaseResult): EvalCaseResult {
  return {
    id,
    ok: false,
    failures: [{ reason: "case timed out after 180 seconds" }],
    ...(partial.generation !== undefined ? { generation: partial.generation } : {}),
    ...(partial.error !== undefined ? { error: partial.error } : {}),
  };
}

function errorCode(err: unknown): string {
  if (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string" &&
    /^[A-Za-z0-9_-]+$/.test((err as { code: string }).code)
  ) {
    return (err as { code: string }).code;
  }
  return "Error";
}

export async function main(options: CliMainOptions = {}): Promise<number> {
  const log = options.log ?? ((line: string) => console.log(line));
  const error = options.error ?? ((line: string) => console.error(line));
  const available = options.agentAvailable ?? agentAvailable;

  const args = parseCliArgs(options.argv ?? []);
  if (!args.ok) {
    error(args.error);
    return 1;
  }
  const { repeat } = args;

  if (!available) {
    error("OPENAI_API_KEY is required to run eval cases.");
    return 1;
  }

  const loadCasesFn = options.inject?.loadCases ?? loadCases;
  const runEvalCaseFn = options.inject?.runEvalCase ?? runEvalCase;
  const createLlm = options.inject?.createOpenAIComponentLlm ?? createOpenAIComponentLlm;
  const createEvalLogDirFn = options.inject?.createEvalLogDir ?? createEvalLogDir;
  const writeEvalCaseLogFn = options.inject?.writeEvalCaseLog ?? writeEvalCaseLog;
  const timeoutSignal =
    options.inject?.timeoutSignal ?? (() => AbortSignal.timeout(CASE_TIMEOUT_MS));

  const logRoot = options.logRoot ?? join(process.cwd(), "eval-logs");
  const nowFn = options.now ?? (() => new Date());

  const casesDir = options.casesDir ?? defaultCasesDir;
  const cases = loadCasesFn(casesDir);

  let logDir: string;
  try {
    logDir = createEvalLogDirFn(logRoot, nowFn());
  } catch (err) {
    error(`failed to create eval log directory ${errorCode(err)}`);
    return 1;
  }

  const llm = createLlm({
    apiKey: config.openai.apiKey,
    model: config.openai.model,
    maxOutputTokens: config.openai.maxOutputTokens,
  });

  let anyFailed = false;
  let anyLogFailed = false;
  let runs = 0;
  let firstTry = 0;
  const usage: UsageTotals = { calls: 0, promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, durationMs: 0 };
  const passes = new Map<string, number>();
  for (const evalCase of cases) {
    passes.set(evalCase.id, 0);
    for (let attempt = 1; attempt <= repeat; attempt++) {
      const signal = timeoutSignal();
      const started = performance.now();
      let result = await runEvalCaseFn(evalCase, { llm, signal });
      const durationMs = Math.round(performance.now() - started);
      if (signal.aborted) {
        result = timeoutResult(evalCase.id, result);
      }
      addUsage(usage, result, durationMs);

      const generation = result.generation;
      const record: EvalCaseLog = {
        id: evalCase.id,
        prompt: evalCase.prompt,
        checks: evalCase.checks,
        ok: result.ok,
        failures: result.failures,
        attempts: generation?.attempts ?? [],
        durationMs,
      };
      if (generation?.ok) {
        record.tree = generation.tree;
        record.notes = generation.notes;
      }
      if (result.error !== undefined) record.error = result.error;

      try {
        if (repeat === 1) writeEvalCaseLogFn(logDir, record);
        else writeEvalCaseLogFn(logDir, record, attempt);
      } catch (err) {
        error(`log failed ${evalCase.id} ${errorCode(err)}`);
        anyLogFailed = true;
      }

      runs++;
      if (result.ok && attemptCount(result) === 1) firstTry++;
      if (result.ok) passes.set(evalCase.id, (passes.get(evalCase.id) ?? 0) + 1);
      else anyFailed = true;
      log(formatResult(result, repeat > 1 ? ` [${attempt}/${repeat}]` : ""));
    }
  }

  if (repeat > 1) {
    for (const evalCase of cases) {
      log(`rate ${evalCase.id} ${passes.get(evalCase.id)}/${repeat}`);
    }
  }
  log(`first-try ${firstTry}/${runs}`);
  log(formatUsage(usage));
  log(`logs ${resolve(logDir)}`);

  return anyFailed || anyLogFailed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const code = await main({ argv: process.argv.slice(2) });
  process.exit(code);
}

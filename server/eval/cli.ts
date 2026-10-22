import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createOpenAILlm } from "../adapters/openai/OpenAILlm";
import { SYSTEM_PROMPT } from "../agent/systemPrompt";
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

export type CliMainOptions = {
  agentAvailable?: boolean;
  casesDir?: string;
  logRoot?: string;
  now?: () => Date;
  log?: (line: string) => void;
  error?: (line: string) => void;
  inject?: {
    loadCases?: typeof loadCases;
    runEvalCase?: typeof runEvalCase;
    createOpenAILlm?: typeof createOpenAILlm;
    createEvalLogDir?: typeof createEvalLogDir;
    writeEvalCaseLog?: typeof writeEvalCaseLog;
    timeoutSignal?: () => AbortSignal;
  };
};

function formatResult(result: EvalCaseResult): string {
  if (result.ok) return `pass ${result.id}`;
  const parts = result.failures.map((f) => f.reason);
  if (result.endedBy !== undefined) parts.push(`endedBy: ${result.endedBy}`);
  if (result.error !== undefined) parts.push(`error: ${result.error}`);
  return `fail ${result.id} ${parts.join("; ")}`;
}

function timeoutResult(id: string, partial: EvalCaseResult): EvalCaseResult {
  return {
    id,
    ok: false,
    failures: [{ check: { noError: true }, reason: "case timed out after 180 seconds" }],
    trace: partial.trace,
    ...(partial.endedBy !== undefined ? { endedBy: partial.endedBy } : {}),
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

  if (!available) {
    error("OPENAI_API_KEY is required to run eval cases.");
    return 1;
  }

  const loadCasesFn = options.inject?.loadCases ?? loadCases;
  const runEvalCaseFn = options.inject?.runEvalCase ?? runEvalCase;
  const createLlm = options.inject?.createOpenAILlm ?? createOpenAILlm;
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
    systemPrompt: SYSTEM_PROMPT,
  });

  let anyFailed = false;
  let anyLogFailed = false;
  for (const evalCase of cases) {
    const signal = timeoutSignal();
    let result = await runEvalCaseFn(evalCase, { llm, signal });
    if (signal.aborted) {
      result = timeoutResult(evalCase.id, result);
    }

    if (result.trace === undefined) {
      error(`log failed ${evalCase.id} missing-trace`);
      anyLogFailed = true;
    } else {
      const record: EvalCaseLog = {
        id: evalCase.id,
        prompt: evalCase.prompt,
        checks: evalCase.checks,
        ok: result.ok,
        failures: result.failures,
        trace: result.trace,
      };
      if (result.endedBy !== undefined) record.endedBy = result.endedBy;
      if (result.error !== undefined) record.error = result.error;

      try {
        writeEvalCaseLogFn(logDir, record);
      } catch (err) {
        error(`log failed ${evalCase.id} ${errorCode(err)}`);
        anyLogFailed = true;
      }
    }

    if (!result.ok) anyFailed = true;
    log(formatResult(result));
  }

  log(`logs ${resolve(logDir)}`);

  return anyFailed || anyLogFailed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const code = await main();
  process.exit(code);
}

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createOpenAILlm } from "../adapters/openai/OpenAILlm";
import { SYSTEM_PROMPT } from "../agent/systemPrompt";
import { agentAvailable, config } from "../config";
import { loadCases } from "./loadCases";
import { runEvalCase } from "./runner";
import type { EvalCaseResult } from "./types";

const CASE_TIMEOUT_MS = 180_000;

const defaultCasesDir = join(dirname(fileURLToPath(import.meta.url)), "cases");

export type CliMainOptions = {
  agentAvailable?: boolean;
  casesDir?: string;
  log?: (line: string) => void;
  error?: (line: string) => void;
  inject?: {
    loadCases?: typeof loadCases;
    runEvalCase?: typeof runEvalCase;
    createOpenAILlm?: typeof createOpenAILlm;
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
    ...(partial.endedBy !== undefined ? { endedBy: partial.endedBy } : {}),
    ...(partial.error !== undefined ? { error: partial.error } : {}),
  };
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

  const llm = createLlm({
    apiKey: config.openai.apiKey,
    model: config.openai.model,
    maxOutputTokens: config.openai.maxOutputTokens,
    systemPrompt: SYSTEM_PROMPT,
  });

  const casesDir = options.casesDir ?? defaultCasesDir;
  const cases = loadCasesFn(casesDir);

  let anyFailed = false;
  for (const evalCase of cases) {
    const signal = AbortSignal.timeout(CASE_TIMEOUT_MS);
    let result = await runEvalCaseFn(evalCase, { llm, signal });
    if (signal.aborted) {
      result = timeoutResult(evalCase.id, result);
    }
    if (!result.ok) anyFailed = true;
    log(formatResult(result));
  }

  return anyFailed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const code = await main();
  process.exit(code);
}

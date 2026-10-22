import type { AgentTrace, AgentTraceToolCall } from "../agent/trace";
import { collectBindings, isObject } from "../ui/bindings";
import type { CheckFailure, EvalCheck } from "./types";

const NO_RENDER_UI =
  "no successful render_ui tree on trace (result.ok, ui present, not skipped)";

function lastSuccessfulRenderUi(trace: AgentTrace): AgentTraceToolCall | undefined {
  let last: AgentTraceToolCall | undefined;
  for (const completion of trace.completions) {
    for (const toolCall of completion.toolCalls) {
      if (
        toolCall.call.name === "render_ui" &&
        toolCall.result.ok &&
        toolCall.ui &&
        toolCall.skipped === undefined
      ) {
        last = toolCall;
      }
    }
  }
  return last;
}

function treeHasComponent(tree: unknown, name: string): boolean {
  if (!isObject(tree)) return false;
  if (tree.component === name) return true;
  if (!Array.isArray(tree.children)) return false;
  return tree.children.some((child) => treeHasComponent(child, name));
}

function checkLabel(check: EvalCheck): string {
  if ("endedBy" in check) return `endedBy "${check.endedBy}"`;
  if ("noError" in check) return "noError";
  if ("toolCalled" in check) return `toolCalled "${check.toolCalled}"`;
  if ("toolSucceeded" in check) return `toolSucceeded "${check.toolSucceeded}"`;
  if ("uiComponent" in check) return `uiComponent "${check.uiComponent}"`;
  if ("uiButtonAction" in check) return `uiButtonAction "${check.uiButtonAction}"`;
  return `uiNamedInput "${check.uiNamedInput}"`;
}

function evaluateCheck(trace: AgentTrace, check: EvalCheck): CheckFailure | undefined {
  const label = checkLabel(check);

  if ("endedBy" in check) {
    if (trace.endedBy === check.endedBy) return undefined;
    return {
      check,
      reason: `${label}: trace endedBy is "${trace.endedBy}"`,
    };
  }

  if ("noError" in check) {
    if (trace.error === undefined) return undefined;
    return { check, reason: `${label}: trace has error` };
  }

  if ("toolCalled" in check) {
    const found = trace.completions.some((c) =>
      c.toolCalls.some((tc) => tc.call.name === check.toolCalled),
    );
    if (found) return undefined;
    return { check, reason: `${label}: no matching tool call` };
  }

  if ("toolSucceeded" in check) {
    const found = trace.completions.some((c) =>
      c.toolCalls.some(
        (tc) =>
          tc.call.name === check.toolSucceeded &&
          tc.result.ok &&
          tc.skipped === undefined,
      ),
    );
    if (found) return undefined;
    return { check, reason: `${label}: no successful matching tool call` };
  }

  const renderUi = lastSuccessfulRenderUi(trace);
  if (!renderUi?.ui) {
    return { check, reason: `${label}: ${NO_RENDER_UI}` };
  }
  const tree = renderUi.ui.tree;

  if ("uiComponent" in check) {
    if (treeHasComponent(tree, check.uiComponent)) return undefined;
    return { check, reason: `${label}: component not found in last render_ui tree` };
  }

  const bindings = collectBindings(tree);

  if ("uiButtonAction" in check) {
    if (bindings.buttons.some((b) => b.action === check.uiButtonAction)) return undefined;
    return { check, reason: `${label}: button action not found in last render_ui tree` };
  }

  if (bindings.inputs.some((i) => i.name === check.uiNamedInput)) return undefined;
  return { check, reason: `${label}: named input not found in last render_ui tree` };
}

export function checkTrace(trace: AgentTrace, checks: EvalCheck[]): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const check of checks) {
    const failure = evaluateCheck(trace, check);
    if (failure) failures.push(failure);
  }
  return failures;
}

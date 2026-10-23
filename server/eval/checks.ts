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

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (isObject(value)) return Object.values(value).flatMap(stringsIn);
  return [];
}

function treeStrings(tree: unknown): string[] {
  if (!isObject(tree)) return [];
  const children = Array.isArray(tree.children) ? tree.children : [];
  return [...stringsIn(tree.props), ...children.flatMap(treeStrings)];
}

function elementHasTag(element: unknown, tag: string): boolean {
  if (!isObject(element)) return false;
  if (element.tag === tag) return true;
  if (!Array.isArray(element.children)) return false;
  return element.children.some((child) => elementHasTag(child, tag));
}

function treeHasMarkupTag(tree: unknown, tag: string): boolean {
  if (!isObject(tree)) return false;
  if (tree.component === "Markup" && isObject(tree.props) && elementHasTag(tree.props.root, tag)) {
    return true;
  }
  if (!Array.isArray(tree.children)) return false;
  return tree.children.some((child) => treeHasMarkupTag(child, tag));
}

function checkLabel(check: EvalCheck): string {
  if ("endedBy" in check) return `endedBy "${check.endedBy}"`;
  if ("noError" in check) return "noError";
  if ("toolCalled" in check) return `toolCalled "${check.toolCalled}"`;
  if ("toolNotCalled" in check) return `toolNotCalled "${check.toolNotCalled}"`;
  if ("toolSucceeded" in check) return `toolSucceeded "${check.toolSucceeded}"`;
  if ("uiComponent" in check) return `uiComponent "${check.uiComponent}"`;
  if ("uiButtonAction" in check) return `uiButtonAction "${check.uiButtonAction}"`;
  if ("uiText" in check) return `uiText "${check.uiText}"`;
  if ("uiMarkupTag" in check) return `uiMarkupTag "${check.uiMarkupTag}"`;
  if ("agentComponent" in check) return `agentComponent "${check.agentComponent}"`;
  if ("noButtonAction" in check) return "noButtonAction";
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

  if ("toolNotCalled" in check) {
    const found = trace.completions.some((c) =>
      c.toolCalls.some((tc) => tc.call.name === check.toolNotCalled),
    );
    if (!found) return undefined;
    return { check, reason: `${label}: tool was called` };
  }

  const renderUi = lastSuccessfulRenderUi(trace);
  if (!renderUi?.ui) {
    return { check, reason: `${label}: ${NO_RENDER_UI}` };
  }

  if ("agentComponent" in check) {
    const argsTree = renderUi.call.args.tree;
    if (argsTree === undefined) return { check, reason: `${label}: arguments tree is missing` };
    if (treeHasComponent(argsTree, check.agentComponent)) return undefined;
    return { check, reason: `${label}: component not found in the render_ui arguments` };
  }

  const tree = renderUi.ui.tree;

  if ("uiComponent" in check) {
    if (treeHasComponent(tree, check.uiComponent)) return undefined;
    return { check, reason: `${label}: component not found in last render_ui tree` };
  }

  if ("uiText" in check) {
    if (treeStrings(tree).some((text) => text.includes(check.uiText))) return undefined;
    return { check, reason: `${label}: text not found in last render_ui tree` };
  }

  if ("uiMarkupTag" in check) {
    if (treeHasMarkupTag(tree, check.uiMarkupTag)) return undefined;
    return { check, reason: `${label}: Markup tag not found in last render_ui tree` };
  }

  const bindings = collectBindings(tree);

  if ("noButtonAction" in check) {
    if (!treeHasComponent(tree, "Button")) {
      return { check, reason: `${label}: no Button in the last render_ui tree` };
    }
    if (bindings.buttons.length === 0) return undefined;
    return { check, reason: `${label}: a button has an action` };
  }

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

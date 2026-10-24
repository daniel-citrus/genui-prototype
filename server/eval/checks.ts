import type { UiNode } from "shared/ui";
import type { Generation } from "../generate/generate";
import { collectBindings, isObject } from "../ui/bindings";
import type { CheckFailure, EvalCheck } from "./types";

type Designed = Extract<Generation, { ok: true }>;

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
  if ("noButtonAction" in check) return "noButtonAction";
  const [name, value] = Object.entries(check)[0] as [string, string | number];
  return typeof value === "number" ? `${name} ${value}` : `${name} "${value}"`;
}

function evaluateCheck(generation: Designed, check: EvalCheck): CheckFailure | undefined {
  const label = checkLabel(check);
  const tree: UiNode = generation.tree;
  const fail = (detail: string): CheckFailure => ({ check, reason: `${label}: ${detail}` });

  if ("maxAttempts" in check) {
    const used = generation.attempts.length;
    return used <= check.maxAttempts ? undefined : fail(`took ${used} attempts`);
  }

  if ("notesMaxWords" in check) {
    const words = generation.notes.split(/\s+/).filter(Boolean).length;
    return words <= check.notesMaxWords ? undefined : fail(`notes have ${words} words`);
  }

  if ("notesExcludes" in check) {
    return generation.notes.includes(check.notesExcludes) ? fail("notes contain the excluded text") : undefined;
  }

  if ("agentComponent" in check) {
    const own = generation.attempts.at(-1)?.tree;
    if (own === undefined) return fail("the final attempt has no tree");
    return treeHasComponent(own, check.agentComponent) ? undefined : fail("component not found in the model's own tree");
  }

  if ("noUiComponent" in check) {
    return treeHasComponent(tree, check.noUiComponent) ? fail("component found in the tree") : undefined;
  }

  if ("uiComponent" in check) {
    return treeHasComponent(tree, check.uiComponent) ? undefined : fail("component not found in the tree");
  }

  if ("uiText" in check) {
    return treeStrings(tree).some((text) => text.includes(check.uiText)) ? undefined : fail("text not found in the tree");
  }

  if ("uiMarkupTag" in check) {
    return treeHasMarkupTag(tree, check.uiMarkupTag) ? undefined : fail("Markup tag not found in the tree");
  }

  const bindings = collectBindings(tree);

  if ("noButtonAction" in check) {
    if (!treeHasComponent(tree, "Button")) return fail("no Button in the tree");
    return bindings.buttons.length === 0 ? undefined : fail("a button has an action");
  }

  if ("uiButtonAction" in check) {
    return bindings.buttons.some((b) => b.action === check.uiButtonAction)
      ? undefined
      : fail("button action not found in the tree");
  }

  return bindings.inputs.some((i) => i.name === check.uiNamedInput) ? undefined : fail("named input not found in the tree");
}

export function checkGeneration(generation: Designed, checks: EvalCheck[]): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const check of checks) {
    const failure = evaluateCheck(generation, check);
    if (failure) failures.push(failure);
  }
  return failures;
}

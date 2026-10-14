import type { UiNode } from "shared/ui";
import { components } from "./components";

const emptyMessage = "Designs you ask for appear here.";

function placeholder(label: string): HTMLElement {
  const node = document.createElement("div");
  node.className =
    "rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-500";
  node.textContent = label;
  return node;
}

function draw(node: UiNode): HTMLElement {
  if (!Object.hasOwn(components, node.component)) {
    return placeholder(`Unknown component: ${node.component}`);
  }
  const renderer = components[node.component as keyof typeof components];
  const children = (node.children ?? []).map(draw);
  return renderer(node.props ?? {}, children);
}

/** Replaces the container's contents with the empty-state message. */
export function renderEmpty(container: HTMLElement): void {
  const message = document.createElement("p");
  message.className = "p-6 text-center text-sm text-zinc-400";
  message.textContent = emptyMessage;
  container.replaceChildren(message);
}

/** Replaces the container's contents with the drawn tree. */
export function renderUi(tree: UiNode, container: HTMLElement): void {
  container.replaceChildren(draw(tree));
}

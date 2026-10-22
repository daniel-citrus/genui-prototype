import { isObject } from "./bindings";

/**
 * A copy of `node` in which an empty `children` array is dropped from every
 * component whose children is "none" (per `childrenOf`), at any depth in the
 * children. Names `childrenOf` doesn't know keep it. `props` is not walked.
 * Never mutates `node`; a value that needs no change may come back as is.
 */
export function omitEmptyChildren(
  node: unknown,
  childrenOf: (name: string) => "none" | "any" | undefined,
): unknown {
  if (!isObject(node) || typeof node.component !== "string" || !Array.isArray(node.children)) return node;
  if (node.children.length === 0) {
    if (childrenOf(node.component) !== "none") return node;
    const { children: _children, ...rest } = node;
    return rest;
  }
  return { ...node, children: node.children.map((child) => omitEmptyChildren(child, childrenOf)) };
}

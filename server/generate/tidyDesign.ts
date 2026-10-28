import { MARKUP_TAG_ALTERNATIVES } from "shared/markup";
import { isObject } from "../ui/bindings";

/** `children` without its `null` entries, each kept entry passed through `tidy`. */
function tidyChildren(children: unknown[], tidy: (child: unknown) => unknown): unknown[] {
  return children.filter((child) => child !== null).map(tidy);
}

/** A Markup element with its tag swapped for the allowed alternative outside svg, at any depth. */
function tidyElement(element: unknown, inSvg: boolean): unknown {
  if (!isObject(element)) return element;
  const { tag } = element;
  const tidied: Record<string, unknown> = { ...element };
  if (!inSvg && typeof tag === "string" && Object.hasOwn(MARKUP_TAG_ALTERNATIVES, tag)) {
    tidied.tag = MARKUP_TAG_ALTERNATIVES[tag];
  }
  if (Array.isArray(element.children)) {
    const childInSvg = inSvg || tag === "svg";
    tidied.children = tidyChildren(element.children, (child) => tidyElement(child, childInSvg));
  }
  return tidied;
}

/**
 * A copy of the model's tree with two slips fixed that would otherwise cost a
 * repair: `null` entries in `children` arrays (of components and of Markup
 * elements) are dropped, and a Markup tag the checks would ask to replace
 * (b, i, h5, h6 outside svg) is replaced. Everything else is left for the
 * checks. Never mutates `tree`.
 */
export function tidyDesign(tree: unknown): unknown {
  if (!isObject(tree)) return tree;
  const tidied: Record<string, unknown> = { ...tree };
  if (tree.component === "Markup" && isObject(tree.props) && tree.props.root !== undefined) {
    tidied.props = { ...tree.props, root: tidyElement(tree.props.root, false) };
  }
  if (Array.isArray(tree.children)) tidied.children = tidyChildren(tree.children, tidyDesign);
  return tidied;
}

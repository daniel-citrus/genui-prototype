/** A UI the agent describes: a tree of catalog components. */

export interface UiNode {
  /** Catalog name, exact case: "Button". */
  component: string;
  /** Must match that component's `propsSchema`. */
  props?: Record<string, unknown>;
  /** Only on components whose `children` is "any". */
  children?: UiNode[];
}

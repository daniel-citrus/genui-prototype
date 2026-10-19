/** A TextInput, Checkbox or Select with a `name`: a value a click can send. */
export interface NamedInput {
  /** Same form as `validateUiTree` paths: "tree.children.0". */
  path: string;
  component: "TextInput" | "Checkbox" | "Select";
  name: string;
  /** TextInput only: its `type`, "text" when left out. */
  type?: string;
  /** Select only: its string options. */
  options?: string[];
}

/** A Button with an `action`. */
export interface ActionButton {
  path: string;
  action: string;
  disabled: boolean;
}

export interface TreeBindings {
  inputs: NamedInput[];
  buttons: ActionButton[];
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The named inputs and action Buttons in a UI tree, in document order. Reads
 * any value, valid or not: nodes without a string `name` or `action` are
 * skipped, and nothing else about the tree is checked.
 */
export function collectBindings(tree: unknown): TreeBindings {
  const bindings: TreeBindings = { inputs: [], buttons: [] };

  const visit = (node: unknown, path: string): void => {
    if (!isObject(node)) return;
    const props = isObject(node.props) ? node.props : {};
    const { component } = node;

    if (component === "Button" && typeof props.action === "string") {
      bindings.buttons.push({ path, action: props.action, disabled: props.disabled === true });
    } else if (
      (component === "TextInput" || component === "Checkbox" || component === "Select") &&
      typeof props.name === "string"
    ) {
      const input: NamedInput = { path, component, name: props.name };
      if (component === "TextInput") input.type = typeof props.type === "string" ? props.type : "text";
      if (component === "Select") {
        input.options = Array.isArray(props.options)
          ? props.options.filter((o): o is string => typeof o === "string")
          : [];
      }
      bindings.inputs.push(input);
    }

    if (Array.isArray(node.children)) {
      node.children.forEach((child, i) => visit(child, `${path}.children.${i}`));
    }
  };

  visit(tree, "tree");
  return bindings;
}

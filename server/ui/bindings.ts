import { nearestCard } from "shared/formScope";

/**
 * A TextInput, Checkbox or Select with a `name`: a value a click can send.
 * Markup `input` and `select` elements count as one of these.
 */
export interface NamedInput {
  /** Same form as `validateUiTree` paths: "tree.children.0". */
  path: string;
  /** Inside a Markup root: `path` is the element, `name` is in its `attrs`. */
  markup?: true;
  component: "TextInput" | "Checkbox" | "Select";
  name: string;
  /** TextInput only: its `type`, "text" when left out. */
  type?: string;
  /** Select only: its string options. */
  options?: string[];
  /** A Select component only: the option it starts on, when set. */
  value?: string;
  /** A Select component only: set when it is greyed out and fixed. */
  disabled?: true;
  /** Path of the nearest Card around it, if any. */
  card?: string;
}

/** A Button, or a Markup `button` element, with an `action`. */
export interface ActionButton {
  path: string;
  /** Inside a Markup root: `path` is the element. */
  markup?: true;
  action: string;
  disabled: boolean;
  /** Path of the nearest Card around it, if any. */
  card?: string;
}

export interface TreeBindings {
  inputs: NamedInput[];
  buttons: ActionButton[];
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The named inputs and action Buttons in a UI tree, in document order,
 * including the named `input`/`select` elements and action `button` elements
 * of every Markup root. Reads any value, valid or not: nodes without a string
 * `name` or `action` are skipped, and nothing else about the tree is checked.
 */
export function collectBindings(tree: unknown): TreeBindings {
  const bindings: TreeBindings = { inputs: [], buttons: [] };

  const visitMarkup = (element: unknown, path: string): void => {
    if (!isObject(element)) return;
    const attrs = isObject(element.attrs) ? element.attrs : {};
    const children: unknown[] = Array.isArray(element.children) ? element.children : [];
    const { tag, action } = element;
    const name = attrs.name;

    if (tag === "button" && typeof action === "string") {
      bindings.buttons.push({ path, action, disabled: attrs.disabled === true, markup: true });
    } else if (tag === "input" && typeof name === "string") {
      if (attrs.type === "checkbox") {
        bindings.inputs.push({ path, component: "Checkbox", name, markup: true });
      } else {
        const type = typeof attrs.type === "string" ? attrs.type : "text";
        bindings.inputs.push({ path, component: "TextInput", name, type, markup: true });
      }
    } else if (tag === "select" && typeof name === "string") {
      const options = children.flatMap((option) => {
        if (!isObject(option) || option.tag !== "option") return [];
        // The browser sets a number value as text; an option without a value sends its text.
        const value = isObject(option.attrs) ? option.attrs.value : undefined;
        if (typeof value === "number") return [String(value)];
        if (typeof value === "string") return [value];
        return typeof option.text === "string" ? [option.text] : [];
      });
      bindings.inputs.push({ path, component: "Select", name, options, markup: true });
    }

    children.forEach((child, i) => visitMarkup(child, `${path}.children.${i}`));
  };

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
        if (typeof props.value === "string") input.value = props.value;
        if (props.disabled === true) input.disabled = true;
      }
      bindings.inputs.push(input);
    } else if (component === "Markup") {
      visitMarkup(props.root, `${path}.props.root`);
    }

    if (Array.isArray(node.children)) {
      node.children.forEach((child, i) => visit(child, `${path}.children.${i}`));
    }
  };

  visit(tree, "tree");
  for (const binding of [...bindings.inputs, ...bindings.buttons]) {
    const card = nearestCard(tree, binding.path);
    if (card) binding.card = card;
  }
  return bindings;
}

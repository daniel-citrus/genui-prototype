import { MAX_FIELD_CHARS } from "shared/api";
import type { MarkupElement } from "shared/markup";
import type { RenderedComponentName } from "./componentNames";
import { filterMarkup } from "./markup";

/**
 * Draws one catalog component. Props come from a tree the server already
 * checked, but are still read defensively. Text only ever goes in through
 * `textContent` or a named attribute, never as HTML.
 */
export type Renderer = (props: Record<string, unknown>, children: HTMLElement[], path: string) => HTMLElement;

type Props = Record<string, unknown>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function str(props: Props, key: string): string | undefined {
  const value = props[key];
  return typeof value === "string" ? value : undefined;
}

function bool(props: Props, key: string, fallback: boolean): boolean {
  const value = props[key];
  return typeof value === "boolean" ? value : fallback;
}

/** Looks the prop up in `classes`; a missing or unknown value uses `fallback`. */
function pick<T extends string>(props: Props, key: string, classes: Record<T, string>, fallback: T): string {
  const value = props[key];
  return typeof value === "string" && Object.hasOwn(classes, value) ? classes[value as T] : classes[fallback];
}

let nextId = 0;
function uniqueId(prefix: string): string {
  nextId += 1;
  return `sandbox-${prefix}-${nextId}`;
}

/** The `name` prop names the value an action receives from this field. */
function setName(control: HTMLInputElement | HTMLSelectElement, props: Props, path: string): void {
  const name = str(props, "name");
  if (name) control.name = name;
  control.dataset.path = path;
}

function field(label: string, control: HTMLElement, labelFor: string): HTMLElement {
  const wrapper = el("div", "flex flex-col gap-1");
  const labelEl = el("label", "text-sm font-medium text-zinc-700", label);
  labelEl.htmlFor = labelFor;
  wrapper.append(labelEl, control);
  return wrapper;
}

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none placeholder:text-zinc-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20";

const stackDirection = {
  vertical: "flex-col",
  horizontal: "flex-row flex-wrap",
};
const stackGap = { none: "gap-0", sm: "gap-2", md: "gap-4", lg: "gap-6" };
const stackAlign = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

const Stack: Renderer = (props, children) => {
  const cls = [
    "flex",
    pick(props, "direction", stackDirection, "vertical"),
    pick(props, "gap", stackGap, "md"),
    pick(props, "align", stackAlign, "stretch"),
  ].join(" ");
  const node = el("div", cls);
  node.append(...children);
  return node;
};

const cardPadding = { sm: "p-3", md: "p-5", lg: "p-8" };

const Card: Renderer = (props, children) => {
  const node = el(
    "section",
    `flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white shadow-sm ${pick(props, "padding", cardPadding, "md")}`,
  );
  const title = str(props, "title");
  if (title) node.append(el("h3", "text-base font-semibold text-zinc-900", title));
  node.append(...children);
  return node;
};

const Divider: Renderer = () => el("hr", "border-0 border-t border-zinc-200");

const headingTag = { "1": "h1", "2": "h2", "3": "h3" } as const;
const headingClass = {
  "1": "text-2xl font-bold tracking-tight text-zinc-900",
  "2": "text-xl font-semibold text-zinc-900",
  "3": "text-base font-semibold text-zinc-900",
};

const Heading: Renderer = (props) => {
  const level = String(props.level) in headingTag ? (String(props.level) as keyof typeof headingTag) : "2";
  return el(headingTag[level], headingClass[level], str(props, "text") ?? "");
};

const textSize = { sm: "text-xs", md: "text-sm" };
const textTone = { default: "text-zinc-900", muted: "text-zinc-500" };

const Text: Renderer = (props) =>
  el(
    "p",
    `${pick(props, "size", textSize, "md")} ${pick(props, "tone", textTone, "default")} leading-relaxed`,
    str(props, "text") ?? "",
  );

const buttonVariant = {
  primary: "bg-zinc-900 text-white hover:bg-zinc-800",
  secondary: "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
};
const buttonSize = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-5 py-2.5 text-base" };

const actionName = /^[a-z][a-z0-9_]*$/;

const Button: Renderer = (props, _children, path) => {
  const node = el(
    "button",
    `inline-flex items-center justify-center self-start rounded-lg font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${pick(props, "variant", buttonVariant, "primary")} ${pick(props, "size", buttonSize, "md")}`,
    str(props, "label") ?? "",
  );
  node.type = "button";
  node.disabled = bool(props, "disabled", false);
  // Only an enabled Button with a well-formed action name can send one.
  const action = str(props, "action");
  if (action && actionName.test(action) && !node.disabled) {
    node.dataset.action = action;
    node.dataset.path = path;
  }
  return node;
};

const inputTypes = ["text", "email", "password", "number"];

const TextInput: Renderer = (props, _children, path) => {
  const id = uniqueId("input");
  const input = el("input", inputClass);
  input.id = id;
  const type = str(props, "type");
  input.type = type && inputTypes.includes(type) ? type : "text";
  const placeholder = str(props, "placeholder");
  if (placeholder) input.placeholder = placeholder;
  input.required = bool(props, "required", false);
  input.maxLength = MAX_FIELD_CHARS;
  setName(input, props, path);
  return field(str(props, "label") ?? "", input, id);
};

const Checkbox: Renderer = (props, _children, path) => {
  const id = uniqueId("checkbox");
  const wrapper = el("div", "flex items-center gap-2");
  const input = el("input", "size-4 rounded border-zinc-300 accent-zinc-900");
  input.type = "checkbox";
  input.id = id;
  input.checked = bool(props, "checked", false);
  setName(input, props, path);
  const label = el("label", "text-sm text-zinc-700", str(props, "label") ?? "");
  label.htmlFor = id;
  wrapper.append(input, label);
  return wrapper;
};

const Select: Renderer = (props, _children, path) => {
  const id = uniqueId("select");
  const select = el("select", inputClass);
  select.id = id;
  setName(select, props, path);
  const placeholder = str(props, "placeholder");
  const preset = str(props, "value");
  if (placeholder) {
    const option = new Option(placeholder, "");
    option.disabled = true;
    option.selected = preset === undefined;
    select.append(option);
  }
  const options = Array.isArray(props.options) ? props.options : [];
  for (const value of options) {
    if (typeof value === "string") select.append(new Option(value, value));
  }
  if (preset !== undefined) select.value = preset;
  select.disabled = bool(props, "disabled", false);
  return field(str(props, "label") ?? "", select, id);
};

const imageWidth = { sm: "w-24", md: "w-48", lg: "w-96 max-w-full", full: "w-full" };

function isHttpUrl(src: string): boolean {
  try {
    const { protocol } = new URL(src);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const Image: Renderer = (props) => {
  const src = str(props, "src");
  if (!src || !isHttpUrl(src)) {
    return el(
      "div",
      "flex h-24 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-xs text-zinc-500",
      "Image unavailable",
    );
  }
  const img = el("img", `h-auto rounded-lg ${pick(props, "width", imageWidth, "full")}`);
  img.src = src;
  img.alt = str(props, "alt") ?? "";
  img.referrerPolicy = "no-referrer";
  return img;
};

const badgeTone = {
  neutral: "bg-zinc-100 text-zinc-700",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
};

const Badge: Renderer = (props) =>
  el(
    "span",
    `inline-flex items-center self-start rounded-full px-2.5 py-0.5 text-xs font-medium ${pick(props, "tone", badgeTone, "neutral")}`,
    str(props, "text") ?? "",
  );

const alertTone = {
  info: "border-sky-200 bg-sky-50 text-sky-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-900",
};

const Alert: Renderer = (props) => {
  const node = el("div", `rounded-lg border px-4 py-3 text-sm ${pick(props, "tone", alertTone, "info")}`);
  node.setAttribute("role", "alert");
  const title = str(props, "title");
  if (title) node.append(el("p", "font-semibold", title));
  node.append(el("p", "", str(props, "message") ?? ""));
  return node;
};

const SVG_NS = "http://www.w3.org/2000/svg";

function buildMarkup(
  element: MarkupElement,
  inSvg: boolean,
  paths: WeakMap<MarkupElement, string>,
): HTMLElement | SVGElement {
  const svg = inSvg || element.tag === "svg";
  const node = svg
    ? (document.createElementNS(SVG_NS, element.tag) as SVGElement)
    : document.createElement(element.tag);

  for (const [name, value] of Object.entries(element.attrs ?? {})) {
    if (value !== false) node.setAttribute(name, value === true ? "" : String(value));
  }
  for (const [property, value] of Object.entries(element.style ?? {})) {
    node.style.setProperty(property, String(value));
  }
  if (element.text !== undefined) node.textContent = String(element.text);

  // Controls and action buttons carry the path the server knows them by.
  const path = paths.get(element);
  if (path && (node instanceof HTMLInputElement || node instanceof HTMLSelectElement)) node.dataset.path = path;

  if (node instanceof HTMLInputElement && !node.hasAttribute("maxlength")) node.maxLength = MAX_FIELD_CHARS;
  // The server lists an option without a value by its text: send exactly that.
  if (node instanceof HTMLOptionElement && !node.hasAttribute("value")) node.value = String(element.text ?? "");
  if (node instanceof HTMLImageElement) node.referrerPolicy = "no-referrer";
  if (node instanceof HTMLButtonElement) {
    node.type = "button";
    // Only an enabled button can send its action; the filter kept only snake_case names.
    if (element.action && !node.disabled) {
      node.dataset.action = element.action;
      if (path) node.dataset.path = path;
    }
  }

  node.append(...(element.children ?? []).map((child) => buildMarkup(child, svg, paths)));
  return node;
}

/**
 * Draws the `root` element tree element by element, leaving out anything
 * outside the allowlist, inside a wrapper that keeps everything in its own
 * box, so nothing in it can cover the chat or the page.
 */
const Markup: Renderer = (props, _children, path) => {
  const wrapper = document.createElement("div");
  wrapper.style.setProperty("contain", "content");
  wrapper.style.setProperty("overflow", "hidden");
  // Filtering can drop siblings, so remember each element's path in the received root.
  const paths = new WeakMap<MarkupElement, string>();
  const root = filterMarkup(props.root, (element, at) => paths.set(element, `${path}.props.${at}`));
  if (root) wrapper.append(buildMarkup(root, false, paths));
  return wrapper;
};

/** One function per rendered component; TypeScript fails if a name is missing. */
export const components: Record<RenderedComponentName, Renderer> = {
  Stack,
  Card,
  Divider,
  Heading,
  Text,
  Button,
  TextInput,
  Checkbox,
  Select,
  Image,
  Badge,
  Alert,
  Markup,
};

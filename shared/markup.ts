/**
 * Markup: what a `Markup` component draws, as a JSON tree of allowlisted HTML
 * and SVG elements. Never HTML text and never JavaScript. The server refuses
 * anything outside these lists and the browser drops it again before drawing;
 * both go through `sanitizeMarkup`, so the rules are the same.
 */
import { MAX_FIELD_CHARS } from "./api";

/** A custom component prop, substituted before the tree is checked or drawn. */
export interface PropPlaceholder {
  $prop: string;
}

export interface MarkupElement {
  tag: string;
  attrs?: Record<string, string | number | boolean | PropPlaceholder>;
  /** Inline style properties; there are no class names. */
  style?: Record<string, string | PropPlaceholder>;
  /** Set as text, never as HTML. */
  text?: string | PropPlaceholder;
  /** `button` only: the registered action it runs. */
  action?: string;
  children?: MarkupElement[];
}

export const MAX_MARKUP_ELEMENTS = 200;
/** Root is level 1. */
export const MAX_MARKUP_DEPTH = 12;
export const MAX_MARKUP_TEXT_CHARS = 1000;
/** Longest attribute or style value. */
export const MAX_MARKUP_VALUE_CHARS = 200;

const html = (...attrs: string[]) => ["title", "aria-label", ...attrs];

/** HTML tag → its allowed attributes. `svg` starts an SVG drawing. */
export const MARKUP_HTML_TAGS: Record<string, readonly string[]> = {
  div: html(),
  span: html(),
  p: html(),
  strong: html(),
  em: html(),
  small: html(),
  br: html(),
  hr: html(),
  h1: html(),
  h2: html(),
  h3: html(),
  h4: html(),
  ul: html(),
  ol: html(),
  li: html(),
  table: html(),
  thead: html(),
  tbody: html(),
  tr: html(),
  th: html("colspan", "rowspan"),
  td: html("colspan", "rowspan"),
  caption: html(),
  label: html(),
  input: html("name", "type", "placeholder", "min", "max", "step", "value", "checked", "disabled", "maxlength"),
  select: html("name", "disabled"),
  option: html("value", "selected"),
  button: html("disabled"),
  img: html("src", "alt", "width", "height"),
  figure: html(),
  figcaption: html(),
  progress: html("value", "max"),
  meter: html("value", "min", "max"),
  svg: html("viewBox", "width", "height"),
};

const paint = ["fill", "stroke", "stroke-width", "transform", "opacity"];
const textAttrs = ["x", "y", "text-anchor", "font-size", ...paint];

/** SVG tag → its allowed attributes; only inside an `svg`. */
export const MARKUP_SVG_TAGS: Record<string, readonly string[]> = {
  g: ["text-anchor", "font-size", ...paint],
  rect: ["x", "y", "width", "height", "rx", "ry", ...paint],
  circle: ["cx", "cy", "r", ...paint],
  ellipse: ["cx", "cy", "rx", "ry", ...paint],
  line: ["x1", "y1", "x2", "y2", ...paint],
  polyline: ["points", ...paint],
  polygon: ["points", ...paint],
  path: ["d", ...paint],
  text: textAttrs,
  tspan: textAttrs,
  title: [],
};

/** Attributes that take true or false; `false` leaves them off. */
const BOOLEAN_ATTRIBUTES = new Set(["checked", "disabled", "selected"]);

/** No `position`, `z-index` or `transform`: nothing can move over the page. */
export const MARKUP_STYLE_PROPERTIES: readonly string[] = [
  // text
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "font-style",
  "font-family",
  "text-align",
  "text-decoration",
  "line-height",
  "letter-spacing",
  "white-space",
  "vertical-align",
  // box
  ...["padding", "margin"].flatMap((p) => [p, `${p}-top`, `${p}-right`, `${p}-bottom`, `${p}-left`]),
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-color",
  "border-width",
  "border-style",
  "border-radius",
  "box-sizing",
  "overflow",
  "opacity",
  // size
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  // layout
  "display",
  "flex-direction",
  "flex-wrap",
  "flex",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-items",
  "justify-content",
  "align-self",
  "gap",
  "row-gap",
  "column-gap",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  // SVG paint
  "fill",
  "stroke",
  "stroke-width",
];

export const MARKUP_DISPLAY_VALUES: readonly string[] = ["block", "inline", "inline-block", "flex", "grid", "none"];

/** No `password`, `radio`, `file` or `hidden`. */
export const MARKUP_INPUT_TYPES: readonly string[] = [
  "text",
  "email",
  "number",
  "date",
  "time",
  "url",
  "tel",
  "checkbox",
  "range",
];

/** Elements that take no `text`. */
const NO_TEXT_TAGS = new Set(["input", "select", "img", "br", "hr"]);
const ELEMENT_KEYS = ["tag", "attrs", "style", "text", "action", "children"];
const ACTION_NAME = /^[a-z][a-z0-9_]*$/;
const UNSAFE_VALUE_PARTS = ["url(", "expression", "javascript:", "@", "\\", "<", ">"];

/** Why an attribute or style value is refused, or undefined when it is fine. */
export function markupValueProblem(value: string): string | undefined {
  if (value.length > MAX_MARKUP_VALUE_CHARS) return `is longer than ${MAX_MARKUP_VALUE_CHARS} characters`;
  const lower = value.toLowerCase();
  const part = UNSAFE_VALUE_PARTS.find((p) => lower.includes(p));
  return part === undefined ? undefined : `must not contain ${JSON.stringify(part)}`;
}

/** Only absolute `http:` or `https:` URLs. */
export function isSafeImageSrc(value: string): boolean {
  if (!/^https?:\/\//.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `{ "$prop": … }` object: a custom component prop to fill in. */
export function isPlaceholder(value: unknown): value is Record<string, unknown> {
  return isObject(value) && "$prop" in value;
}

const UNFILLED = 'is a {"$prop"} placeholder that was not filled';

function attributeProblem(tag: string, name: string, value: unknown, allowed: readonly string[]): string | undefined {
  if (!allowed.includes(name)) return "is not allowed";
  if (isPlaceholder(value)) return UNFILLED;
  if (BOOLEAN_ATTRIBUTES.has(name)) return typeof value === "boolean" ? undefined : "must be true or false";
  if (typeof value !== "string" && typeof value !== "number") return "must be a string or number";
  const text = String(value);
  const problem = markupValueProblem(text);
  if (problem) return problem;
  if (tag === "img" && name === "src" && !isSafeImageSrc(text)) return "must be an http: or https: URL";
  if (tag === "input" && name === "type" && !MARKUP_INPUT_TYPES.includes(text)) {
    return `must be one of ${MARKUP_INPUT_TYPES.join(", ")}`;
  }
  if (name === "maxlength") {
    const max = Number(text);
    if (!Number.isInteger(max) || max < 0 || max > MAX_FIELD_CHARS) {
      return `must be a whole number from 0 to ${MAX_FIELD_CHARS}`;
    }
  }
  return undefined;
}

function styleProblem(property: string, value: unknown): string | undefined {
  if (!MARKUP_STYLE_PROPERTIES.includes(property)) return "is not allowed";
  if (isPlaceholder(value)) return UNFILLED;
  if (typeof value !== "string") return "must be a string";
  const problem = markupValueProblem(value);
  if (problem) return problem;
  if (property === "display" && !MARKUP_DISPLAY_VALUES.includes(value)) {
    return `must be one of ${MARKUP_DISPLAY_VALUES.join(", ")}`;
  }
  return undefined;
}

/**
 * Checks a Markup root against the allowlist and returns it with everything
 * that breaks a rule left out: an element, attribute, style property, text or
 * action, and an input whose type is refused; null when the root itself is
 * left out. Calls `report` once per thing left out, with its path below
 * `path`. Elements past MAX_MARKUP_ELEMENTS (in document order) or
 * MAX_MARKUP_DEPTH are left out too, reported once each.
 */
export function sanitizeMarkup(
  root: unknown,
  path: string,
  report: (problem: string) => void = () => {},
): MarkupElement | null {
  let elements = 0;
  let tooMany = false;
  let tooDeep = false;

  const visit = (value: unknown, at: string, level: number, inSvg: boolean): MarkupElement | null => {
    if (!isObject(value) || typeof value.tag !== "string") {
      report(`${at} must be an object with a "tag" string`);
      return null;
    }
    if (level > MAX_MARKUP_DEPTH) {
      if (!tooDeep) report(`${path} is more than ${MAX_MARKUP_DEPTH} levels deep`);
      tooDeep = true;
      return null;
    }
    elements += 1;
    if (elements > MAX_MARKUP_ELEMENTS) {
      if (!tooMany) report(`${path} has more than ${MAX_MARKUP_ELEMENTS} elements`);
      tooMany = true;
      return null;
    }

    const { tag } = value;
    const tags = inSvg ? MARKUP_SVG_TAGS : MARKUP_HTML_TAGS;
    if (!Object.hasOwn(tags, tag)) {
      let where = "";
      if (inSvg && Object.hasOwn(MARKUP_HTML_TAGS, tag)) where = " inside an svg";
      if (!inSvg && Object.hasOwn(MARKUP_SVG_TAGS, tag)) where = " outside an svg";
      report(`${at}.tag "${tag}" is not allowed${where}`);
      return null;
    }
    const allowed = tags[tag];
    const element: MarkupElement = { tag };
    // An input whose type is refused would be drawn as a text field (a password one too): leave it out.
    let refusedInputType = false;

    for (const key of Object.keys(value)) {
      if (!ELEMENT_KEYS.includes(key)) report(`${at}.${key} is not allowed (use ${ELEMENT_KEYS.join(", ")})`);
    }

    if (value.attrs !== undefined) {
      if (!isObject(value.attrs)) {
        report(`${at}.attrs must be an object`);
      } else {
        const attrs: NonNullable<MarkupElement["attrs"]> = {};
        for (const [name, attr] of Object.entries(value.attrs)) {
          const problem = attributeProblem(tag, name, attr, allowed);
          if (problem) report(`${at}.attrs.${name} ${problem}`);
          else attrs[name] = attr as string | number | boolean;
          if (problem && tag === "input" && name === "type") refusedInputType = true;
        }
        element.attrs = attrs;
      }
    }

    if (value.style !== undefined) {
      if (!isObject(value.style)) {
        report(`${at}.style must be an object`);
      } else {
        const style: NonNullable<MarkupElement["style"]> = {};
        for (const [property, css] of Object.entries(value.style)) {
          const problem = styleProblem(property, css);
          if (problem) report(`${at}.style.${property} ${problem}`);
          else style[property] = css as string;
        }
        element.style = style;
      }
    }

    if (value.text !== undefined) {
      const { text } = value;
      if (NO_TEXT_TAGS.has(tag)) report(`${at}.text is not allowed on ${tag}`);
      else if (isPlaceholder(text)) report(`${at}.text ${UNFILLED}`);
      else if (typeof text !== "string") report(`${at}.text must be a string`);
      else if (text.length > MAX_MARKUP_TEXT_CHARS) {
        report(`${at}.text is longer than ${MAX_MARKUP_TEXT_CHARS} characters`);
      } else element.text = text;
    }

    if (value.action !== undefined) {
      const { action } = value;
      if (tag !== "button") report(`${at}.action is only allowed on a button`);
      else if (isPlaceholder(action)) report(`${at}.action ${UNFILLED}`);
      else if (typeof action !== "string" || !ACTION_NAME.test(action)) {
        report(`${at}.action must be a snake_case action name`);
      } else element.action = action;
    }

    if (value.children !== undefined) {
      if (!Array.isArray(value.children)) {
        report(`${at}.children must be an array`);
      } else {
        const childInSvg = inSvg || tag === "svg";
        element.children = value.children
          .map((child, i) => visit(child, `${at}.children.${i}`, level + 1, childInSvg))
          .filter((child) => child !== null);
      }
    }
    return refusedInputType ? null : element;
  };

  return visit(root, path, 1, false);
}

/**
 * The catalog components the browser can draw. Kept free of DOM types so a
 * test can compare it with the server's catalog.
 */
export const RENDERED_COMPONENTS = [
  "Stack",
  "Card",
  "Divider",
  "Heading",
  "Text",
  "Button",
  "TextInput",
  "Checkbox",
  "Select",
  "Image",
  "Badge",
  "Alert",
  "Markup",
] as const;

export type RenderedComponentName = (typeof RENDERED_COMPONENTS)[number];

import type { CustomComponentDefinition } from "shared/customComponents";

/** Custom component definitions the expansion and definition tests share. All valid. */

/** Catalog components with props; `section` is optional with no default, `tone` has one. */
export const menuItemCard: CustomComponentDefinition = {
  name: "MenuItemCard",
  description: "A menu item with its photo, name and price.",
  category: "display",
  children: "none",
  propsSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Item name." },
      price: { type: "string", description: "Price with its currency, such as $4.50." },
      photo: { type: "string", description: "Absolute http(s) URL of the item's photo." },
      tone: { enum: ["neutral", "success"], default: "success", description: "Color of the price badge." },
      section: { type: "string", description: "Card title, such as the menu section." },
    },
    required: ["name", "price", "photo"],
    additionalProperties: false,
  },
  exampleProps: { name: "Latte", price: "$4.50", photo: "https://example.com/latte.jpg" },
  template: {
    component: "Card",
    props: { title: { $prop: "section" } },
    children: [
      { component: "Image", props: { src: { $prop: "photo" }, alt: { $prop: "name" } } },
      { component: "Heading", props: { text: { $prop: "name" }, level: 3 } },
      { component: "Badge", props: { text: { $prop: "price" }, tone: { $prop: "tone" } } },
    ],
  },
};

/** Markup with placeholders in attributes and text. */
export const barChart: CustomComponentDefinition = {
  name: "BarChart",
  description: "A bar showing one value out of 100.",
  category: "display",
  children: "none",
  propsSchema: {
    type: "object",
    properties: {
      label: { type: "string", description: "What the value measures." },
      value: { type: "number", minimum: 0, maximum: 100, description: "The value, from 0 to 100." },
      color: { type: "string", default: "#0ea5e9", description: "Bar color." },
    },
    required: ["label", "value"],
    additionalProperties: false,
  },
  exampleProps: { label: "Sales", value: 60 },
  template: {
    component: "Markup",
    props: {
      root: {
        tag: "svg",
        attrs: { viewBox: "0 0 100 20", width: 200, height: 40, "aria-label": { $prop: "label" } },
        children: [
          { tag: "title", text: { $prop: "label" } },
          { tag: "rect", attrs: { width: 100, height: 20, fill: "#e4e4e7" } },
          { tag: "rect", attrs: { width: { $prop: "value" }, height: 20, fill: { $prop: "color" } } },
        ],
      },
    },
  },
};

/** A wrapper whose instance children go between a heading and a divider. */
export const panel: CustomComponentDefinition = {
  name: "Panel",
  description: "A titled card that holds other components.",
  category: "layout",
  children: "any",
  propsSchema: {
    type: "object",
    properties: { title: { type: "string", description: "Panel title." } },
    required: ["title"],
    additionalProperties: false,
  },
  exampleProps: { title: "Today" },
  template: {
    component: "Card",
    children: [{ component: "Heading", props: { text: { $prop: "title" } } }, { $children: true }, { component: "Divider" }],
  },
};

/** Uses `panel` and `menuItemCard`. */
export const specials: CustomComponentDefinition = {
  name: "Specials",
  description: "Today's special in a panel.",
  category: "layout",
  children: "none",
  propsSchema: {
    type: "object",
    properties: { price: { type: "string", description: "Price of the special." } },
    required: ["price"],
    additionalProperties: false,
  },
  exampleProps: { price: "$3.00" },
  template: {
    component: "Panel",
    props: { title: "Specials" },
    children: [
      {
        component: "MenuItemCard",
        props: { name: "Mocha", price: { $prop: "price" }, photo: "https://example.com/mocha.jpg" },
      },
    ],
  },
};

/** A definition whose template is `template`, with no props. */
export function withTemplate(
  name: string,
  template: CustomComponentDefinition["template"],
  children: CustomComponentDefinition["children"] = "none",
): CustomComponentDefinition {
  return {
    name,
    description: `${name} for tests.`,
    category: "layout",
    children,
    propsSchema: { type: "object", properties: {}, additionalProperties: false },
    exampleProps: {},
    template,
  };
}

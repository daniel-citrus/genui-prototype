import type { CatalogComponent } from "shared/components";

/**
 * The predefined UI components: the only source of truth for the
 * `components` table, which `seedComponents` brings in line with this list.
 * Text content is a prop, so leaf components take no children.
 */
export const catalog: CatalogComponent[] = [
  {
    name: "Stack",
    description:
      "Lays out its children in a row or a column with even spacing. Use it to group and arrange other components.",
    category: "layout",
    children: "any",
    propsSchema: {
      type: "object",
      properties: {
        direction: {
          enum: ["vertical", "horizontal"],
          default: "vertical",
          description: "Whether children run top to bottom or left to right.",
        },
        gap: {
          enum: ["none", "sm", "md", "lg"],
          default: "md",
          description: "Space between children.",
        },
        align: {
          enum: ["start", "center", "end", "stretch"],
          default: "stretch",
          description: "How children line up across the stack's direction.",
        },
      },
      additionalProperties: false,
    },
    exampleProps: { direction: "horizontal", gap: "sm" },
  },
  {
    name: "Card",
    description:
      "A bordered panel that groups related content, with an optional title. Use it to set a section apart, such as a form or a summary.",
    category: "layout",
    children: "any",
    propsSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Heading shown at the top of the card." },
        padding: {
          enum: ["sm", "md", "lg"],
          default: "md",
          description: "Space between the border and the content.",
        },
      },
      additionalProperties: false,
    },
    exampleProps: { title: "Account" },
  },
  {
    name: "Divider",
    description: "A horizontal rule. Use it to separate groups of content within a card or stack.",
    category: "layout",
    children: "none",
    propsSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    exampleProps: {},
  },
  {
    name: "Heading",
    description:
      "A section title. Use it to name a page, card, or section; use Text for body copy.",
    category: "text",
    children: "none",
    propsSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The heading text." },
        level: {
          enum: [1, 2, 3],
          default: 2,
          description: "Importance, 1 being the largest. Use 1 once per view.",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    exampleProps: { text: "Settings", level: 1 },
  },
  {
    name: "Text",
    description:
      "A paragraph of body text. Use it for explanations, labels outside forms, and helper copy.",
    category: "text",
    children: "none",
    propsSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to show." },
        size: { enum: ["sm", "md"], default: "md", description: "Font size." },
        tone: {
          enum: ["default", "muted"],
          default: "default",
          description: "Use muted for secondary or helper text.",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    exampleProps: { text: "Changes are saved automatically.", tone: "muted" },
  },
  {
    name: "Button",
    description:
      "A clickable action. Use for the main and secondary actions of a form, card, or toolbar.",
    category: "input",
    children: "none",
    propsSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Text on the button." },
        variant: {
          enum: ["primary", "secondary", "danger"],
          default: "primary",
          description: "Visual weight. Use danger for destructive actions.",
        },
        size: { enum: ["sm", "md", "lg"], default: "md", description: "Button size." },
        disabled: {
          type: "boolean",
          default: false,
          description: "Shows the button but blocks clicks.",
        },
        action: {
          type: "string",
          pattern: "^[a-z][a-z0-9_]*$",
          maxLength: 64,
          description:
            "Backend action run when the button is clicked. Use only a name from list_actions; leave it out if none fits.",
        },
      },
      required: ["label"],
      additionalProperties: false,
    },
    exampleProps: { label: "Save changes", variant: "primary" },
  },
  {
    name: "TextInput",
    description:
      "A labeled single-line text field. Use it to collect short free-form input such as a name, email, or number.",
    category: "input",
    children: "none",
    propsSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Label shown above the field." },
        placeholder: { type: "string", description: "Hint shown while the field is empty." },
        type: {
          enum: ["text", "email", "password", "number"],
          default: "text",
          description: "Kind of value, which sets the keyboard and masking.",
        },
        required: {
          type: "boolean",
          default: false,
          description: "Whether the field must be filled in.",
        },
        name: {
          type: "string",
          pattern: "^[A-Za-z][A-Za-z0-9_]*$",
          maxLength: 64,
          description:
            "Key this value is sent under when a Button runs an action: the action property it fills. Unique in the design.",
        },
      },
      required: ["label"],
      additionalProperties: false,
    },
    exampleProps: { label: "Email", placeholder: "you@example.com", type: "email" },
  },
  {
    name: "Checkbox",
    description:
      "A labeled on/off box. Use it for a single yes/no choice, such as accepting terms or turning an option on.",
    category: "input",
    children: "none",
    propsSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Text next to the box." },
        checked: { type: "boolean", default: false, description: "Whether the box starts checked." },
        name: {
          type: "string",
          pattern: "^[A-Za-z][A-Za-z0-9_]*$",
          maxLength: 64,
          description:
            "Key this value is sent under when a Button runs an action: the action property it fills. Unique in the design.",
        },
      },
      required: ["label"],
      additionalProperties: false,
    },
    exampleProps: { label: "Email me about updates" },
  },
  {
    name: "Select",
    description:
      "A labeled dropdown of fixed options. Use it when the user picks exactly one of several known values.",
    category: "input",
    children: "none",
    propsSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Label shown above the dropdown." },
        options: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "The choices, in display order.",
        },
        placeholder: { type: "string", description: "Hint shown before a choice is made." },
        value: { type: "string", description: "The option it starts on; must be one of options." },
        disabled: { type: "boolean", default: false, description: "Shows it greyed out and fixed; its value is still sent." },
        name: {
          type: "string",
          pattern: "^[A-Za-z][A-Za-z0-9_]*$",
          maxLength: 64,
          description:
            "Key this value is sent under when a Button runs an action: the action property it fills. Unique in the design.",
        },
      },
      required: ["label", "options"],
      additionalProperties: false,
    },
    exampleProps: { label: "Country", options: ["Canada", "Mexico", "United States"] },
  },
  {
    name: "Image",
    description:
      "A picture loaded from a URL, with alternative text. Use it for photos, illustrations, and logos.",
    category: "display",
    children: "none",
    propsSchema: {
      type: "object",
      properties: {
        src: {
          type: "string",
          format: "uri",
          pattern: "^https?://",
          description: "Absolute http(s) URL of the image.",
        },
        alt: { type: "string", description: "Text that describes the image for screen readers." },
        width: {
          enum: ["sm", "md", "lg", "full"],
          default: "full",
          description: "Display width; full fills the container.",
        },
      },
      required: ["src", "alt"],
      additionalProperties: false,
    },
    exampleProps: { src: "https://example.com/team.jpg", alt: "The team at the offsite", width: "md" },
  },
  {
    name: "Badge",
    description:
      "A small colored label. Use it to show a status or count next to other content, such as Active or 3 new.",
    category: "display",
    children: "none",
    propsSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The label text; keep it to a word or two." },
        tone: {
          enum: ["neutral", "success", "warning", "danger"],
          default: "neutral",
          description: "Color that signals the status.",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    exampleProps: { text: "Active", tone: "success" },
  },
  {
    name: "Alert",
    description:
      "A highlighted message box. Use it to call out information, success, a warning, or an error the user should notice.",
    category: "display",
    children: "none",
    propsSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The body of the alert." },
        title: { type: "string", description: "Short bold summary shown above the message." },
        tone: {
          enum: ["info", "success", "warning", "danger"],
          default: "info",
          description: "Color and icon that signal the kind of message.",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
    exampleProps: { title: "Payment failed", message: "Check your card details and try again.", tone: "danger" },
  },
  {
    name: "Markup",
    description:
      "Draws allowlisted HTML and SVG elements from a JSON tree, for what no other component can show, such as a bar chart or a star rating. Only used inside custom component templates.",
    category: "display",
    children: "none",
    propsSchema: {
      type: "object",
      properties: {
        root: {
          type: "object",
          description:
            'The root element: { "tag", "attrs"?, "style"?, "text"?, "action"?, "children"? }, a JSON tree, never an HTML string, with allowlisted tags, attributes and inline style properties; no scripts, classes or event handlers. Style keys are kebab-case CSS properties, such as font-weight, and go in style, not attrs. In a template, text, attribute and style values may be {"$prop": "<name>"}. Only used inside custom component templates.',
        },
      },
      required: ["root"],
      additionalProperties: false,
    },
    exampleProps: {
      root: {
        tag: "svg",
        attrs: { viewBox: "0 0 100 20", width: 200, height: 40, "aria-label": "Sales: 60%" },
        children: [
          { tag: "rect", attrs: { width: 100, height: 20, fill: "#e4e4e7" } },
          { tag: "rect", attrs: { width: 60, height: 20, fill: "#0ea5e9" } },
        ],
      },
    },
  },
];

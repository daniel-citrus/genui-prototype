import { MAX_FIELD_CHARS } from "shared/api";
import type { ActionDefinition } from "./types";

/** Echoes its text back. No side effects: it proves the click pipeline end to end. */
export const demoEchoAction: ActionDefinition = {
  name: "demo_echo",
  description: "Demo action with no side effects: replies with the text it was sent.",
  input_schema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        maxLength: MAX_FIELD_CHARS,
        description: "Text to echo back in the result message.",
      },
    },
    additionalProperties: false,
  },
  async run(values) {
    const { text } = values;
    if (typeof text === "string") return { ok: true, message: `Demo action received: ${text}` };
    return { ok: true, message: "Demo action ran." };
  },
};

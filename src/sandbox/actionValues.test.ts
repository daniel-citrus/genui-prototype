import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionValues, type FieldReading } from "./actionValues";

function reading(name: string, kind: FieldReading["kind"], value = "", checked = false): FieldReading {
  return { name, kind, value, checked };
}

describe("actionValues", () => {
  it("passes text values through", () => {
    assert.deepEqual(actionValues([reading("email", "text", "a@b.co"), reading("note", "text", "")]), {
      email: "a@b.co",
      note: "",
    });
  });

  it("leaves password fields out entirely", () => {
    assert.deepEqual(actionValues([reading("user", "text", "dan"), reading("password", "password", "hunter2")]), {
      user: "dan",
    });
  });

  it("sends a checkbox's checked state as a boolean, ignoring its value", () => {
    assert.deepEqual(actionValues([reading("agree", "checkbox", "on", true), reading("news", "checkbox", "on", false)]), {
      agree: true,
      news: false,
    });
  });

  it("sends a select's value, empty while the placeholder is selected", () => {
    assert.deepEqual(actionValues([reading("plan", "select", "Pro"), reading("size", "select", "")]), {
      plan: "Pro",
      size: "",
    });
  });

  it("returns an empty object when there are no fields", () => {
    assert.deepEqual(actionValues([]), {});
  });
});

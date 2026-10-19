import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_FIELD_CHARS } from "shared/api";
import type { UiNode } from "shared/ui";
import { checkActionRequest } from "./checkAction";

const design: UiNode = {
  component: "Card",
  children: [
    { component: "TextInput", props: { label: "Name", name: "name" } },
    { component: "TextInput", props: { label: "Code", name: "code", type: "password" } },
    { component: "Checkbox", props: { label: "Updates", name: "updates" } },
    { component: "Select", props: { label: "Plan", name: "plan", options: ["Free", "Pro"] } },
    { component: "Button", props: { label: "Go", action: "sign_up" } },
    { component: "Button", props: { label: "Later", action: "remind_me", disabled: true } },
  ],
};

const refused = (action: string, values: Record<string, string | boolean>) => {
  const check = checkActionRequest(design, action, values);
  assert.equal(check.ok, false);
  return check.ok ? "" : check.message;
};

describe("checkActionRequest", () => {
  it("accepts an enabled Button's action with values that fit their inputs", () => {
    assert.deepEqual(checkActionRequest(design, "sign_up", {}), { ok: true });
    assert.deepEqual(
      checkActionRequest(design, "sign_up", {
        name: "x".repeat(MAX_FIELD_CHARS),
        updates: false,
        plan: "Pro",
      }),
      { ok: true },
    );
    assert.deepEqual(checkActionRequest(design, "sign_up", { plan: "" }), { ok: true });
  });

  it("refuses an action that no Button in the design names", () => {
    assert.match(refused("delete_all", {}), /no enabled button/);
  });

  it("refuses the action of a disabled Button", () => {
    assert.match(refused("remind_me", {}), /no enabled button/);
  });

  it("refuses a key that isn't the name of an input", () => {
    assert.match(refused("sign_up", { email: "a@b.c" }), /no input named "email"/);
  });

  it("refuses any value for a password field, without echoing it", () => {
    const message = refused("sign_up", { code: "hunter2" });
    assert.match(message, /password/);
    assert.ok(!message.includes("hunter2"));
  });

  it("refuses a TextInput value that is not a string or is too long", () => {
    refused("sign_up", { name: true });
    refused("sign_up", { name: "x".repeat(MAX_FIELD_CHARS + 1) });
  });

  it("refuses a Checkbox value that is not a boolean", () => {
    refused("sign_up", { updates: "true" });
  });

  it("refuses a Select value that is neither empty nor an option", () => {
    refused("sign_up", { plan: "Enterprise" });
    refused("sign_up", { plan: true });
  });

  it("accepts a shared name when the value fits any input with it, unless one is a password", () => {
    const shared: UiNode = {
      component: "Stack",
      children: [
        { component: "Checkbox", props: { label: "A", name: "pick" } },
        { component: "Select", props: { label: "B", name: "pick", options: ["x"] } },
        { component: "TextInput", props: { label: "C", name: "secret" } },
        { component: "TextInput", props: { label: "D", name: "secret", type: "password" } },
        { component: "Button", props: { label: "Go", action: "go" } },
      ],
    };
    assert.deepEqual(checkActionRequest(shared, "go", { pick: true }), { ok: true });
    assert.deepEqual(checkActionRequest(shared, "go", { pick: "x" }), { ok: true });
    assert.equal(checkActionRequest(shared, "go", { pick: "y" }).ok, false);
    assert.equal(checkActionRequest(shared, "go", { secret: "s" }).ok, false);
  });
});

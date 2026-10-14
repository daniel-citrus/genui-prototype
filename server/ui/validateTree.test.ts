import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Component } from "shared/components";
import { catalog } from "../catalog/components";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { validateUiTree, validatorCompileCount } from "./validateTree";

const repo = new InMemoryComponentRepository(catalog);
const stored = () => repo.list();

async function check(tree: unknown) {
  return validateUiTree(tree, await stored());
}

const button = { component: "Button", props: { label: "Go" } };

describe("validateUiTree", () => {
  it("accepts a valid tree and counts nodes, depth and components", async () => {
    const result = await check({
      component: "Stack",
      children: [button, { component: "Card", children: [button] }],
    });
    assert.deepEqual(result, {
      ok: true,
      errors: [],
      stats: { nodes: 4, depth: 3, components: { Stack: 1, Button: 2, Card: 1 } },
    });
  });

  it("accepts every catalog component's example props as children of a Stack", async () => {
    const tree = {
      component: "Stack",
      children: catalog
        .filter((c) => c.name !== "Stack")
        .map((c) => ({ component: c.name, props: c.exampleProps })),
    };
    const result = await check(tree);
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  });

  it("reports malformed nodes", async () => {
    const result = await check({
      component: "Stack",
      children: [button, 7, { props: {} }, { component: "Divider", extra: 1 }, { component: "Divider", props: [] }],
    });
    assert.deepEqual(result.errors, [
      'tree.children.1 must be an object with a "component" string',
      'tree.children.2 must be an object with a "component" string',
      "tree.children.3.extra is not allowed (use component, props, children)",
      "tree.children.4.props must be an object",
    ]);
  });

  it("rejects a non-array children and a non-object tree", async () => {
    assert.deepEqual((await check({ component: "Stack", children: {} })).errors, [
      "tree.children must be an array",
    ]);
    assert.deepEqual((await check("hi")).errors, ['tree must be an object with a "component" string']);
  });

  it("rejects unknown components and suggests the right case", async () => {
    const result = await check({
      component: "Stack",
      children: [{ component: "button", props: { label: "x" } }, { component: "Carousel" }],
    });
    assert.deepEqual(result.errors, [
      'tree.children.0.component "button" is not in the catalog (did you mean Button?)',
      'tree.children.1.component "Carousel" is not in the catalog',
    ]);
  });

  it("reports props that break the schema", async () => {
    const result = await check({
      component: "Stack",
      children: [
        { component: "Button" },
        { component: "Button", props: { label: 3 } },
        { component: "Button", props: { label: "x", variant: "huge" } },
        { component: "Button", props: { label: "x", color: "red" } },
      ],
    });
    assert.deepEqual(result.errors, [
      "tree.children.0.props.label is required",
      "tree.children.1.props.label must be string",
      "tree.children.2.props.variant must be one of primary, secondary, danger",
      "tree.children.3.props.color is not allowed",
    ]);
  });

  it("rejects children on a component that takes none", async () => {
    const result = await check({ component: "Stack", children: [{ ...button, children: [button] }] });
    assert.deepEqual(result.errors, ["tree.children.0 Button cannot have children"]);
  });

  it("limits depth to 8 levels and nodes to 100", async () => {
    let deep: unknown = { component: "Divider" };
    for (let i = 0; i < 8; i++) deep = { component: "Stack", children: [deep] };
    assert.deepEqual((await check(deep)).errors, ["tree is 9 levels deep (max 8)"]);

    let ok: unknown = { component: "Divider" };
    for (let i = 0; i < 7; i++) ok = { component: "Stack", children: [ok] };
    assert.equal((await check(ok)).ok, true);

    const wide = { component: "Stack", children: Array.from({ length: 139 }, () => ({ component: "Divider" })) };
    assert.deepEqual((await check(wide)).errors, ["tree has 140 nodes (max 100)"]);
  });

  it("reports several problems in one call", async () => {
    const result = await check({
      component: "Stack",
      children: [{ component: "nope" }, { component: "Button" }, { component: "Divider", children: [] }],
    });
    assert.equal(result.errors.length, 3);
    assert.equal(result.ok, false);
  });

  it("returns exactly 20 entries when there are more problems, the last counting the rest", async () => {
    const result = await check({
      component: "Stack",
      children: Array.from({ length: 30 }, () => ({ component: "Nope" })),
    });
    assert.equal(result.errors.length, 20);
    assert.equal(result.errors[19], "…and 11 more");
    assert.equal(result.errors[0], 'tree.children.0.component "Nope" is not in the catalog');
  });

  it("compiles each component's validator once per updatedAt", async () => {
    const tree = { component: "Stack", children: [button, { component: "Badge", props: { text: "x" } }] };
    await check(tree); // warm the cache
    const before = validatorCompileCount();
    for (let i = 0; i < 3; i++) await check(tree);
    assert.equal(validatorCompileCount(), before);

    const bumped: Component[] = (await stored()).map((c) =>
      c.name === "Button" ? { ...c, updatedAt: "2099-01-01T00:00:00.000Z" } : c,
    );
    validateUiTree(tree, bumped);
    assert.equal(validatorCompileCount(), before + 1);
    validateUiTree(tree, bumped);
    assert.equal(validatorCompileCount(), before + 1);
  });

  it("accepts only http(s) image URLs", async () => {
    const image = (src: string) => check({ component: "Image", props: { src, alt: "x" } });
    assert.equal((await image("https://example.com/a.png")).ok, true);
    assert.equal((await image("http://example.com/a.png")).ok, true);
    for (const src of ["javascript:alert(1)", "data:image/png;base64,AAAA"]) {
      const result = await image(src);
      assert.equal(result.ok, false, src);
      assert.match(result.errors[0], /^tree\.props\.src /);
    }
  });
});

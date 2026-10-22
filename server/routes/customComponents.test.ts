import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomComponentDetail } from "shared/api";
import { MAX_CUSTOM_COMPONENT_VERSIONS, type CustomComponentDefinition } from "shared/customComponents";
import type { UiNode } from "shared/ui";
import { emptyToolRegistry } from "../agent/tools";
import { buildApp } from "../app";
import { catalog } from "../catalog/components";
import { menuItemCard, panel, specials, withTemplate } from "../customComponents/testDefinitions";
import { CustomComponentError, type CustomComponentRepository } from "../ports/CustomComponentRepository";
import { InMemoryComponentRepository } from "../ports/fakes/InMemoryComponentRepository";
import { InMemoryCustomComponentRepository } from "../ports/fakes/InMemoryCustomComponentRepository";
import { UNAVAILABLE_MESSAGE } from "./customComponents";

const BASE = "/api/custom-components";
const catalogNames = new Set(catalog.map((c) => c.name));

/** A repository holding `definitions`, saved in order. */
async function seeded(...definitions: CustomComponentDefinition[]): Promise<InMemoryCustomComponentRepository> {
  const repo = new InMemoryCustomComponentRepository();
  for (const definition of definitions) await repo.save(definition);
  return repo;
}

const build = (customComponents: CustomComponentRepository, opts: { max?: number; logLines?: string[] } = {}) =>
  buildApp({
    tools: emptyToolRegistry,
    rateLimit: { max: opts.max ?? 1000 },
    customComponents,
    components: new InMemoryComponentRepository(catalog),
    logLevel: opts.logLines ? "info" : undefined,
    logStream: opts.logLines && { write: (line) => void opts.logLines?.push(line) },
  });

type App = Awaited<ReturnType<typeof build>>;

const request = (app: App, method: "GET" | "POST" | "DELETE" | "PUT", url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `${BASE}${url}`,
    ...(payload === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          payload: typeof payload === "string" ? payload : JSON.stringify(payload),
        }),
  });

/** Sends one request to a fresh app over `repo`. */
async function call(repo: CustomComponentRepository, method: "GET" | "POST" | "DELETE" | "PUT", url: string, payload?: unknown) {
  const app = await build(repo);
  const res = await request(app, method, url, payload);
  await app.close();
  return res;
}

function componentNames(node: UiNode): string[] {
  return [node.component, ...(node.children ?? []).flatMap(componentNames)];
}

/** A repository whose every call rejects with `err`. */
const failing = (err: unknown) =>
  new Proxy({} as CustomComponentRepository, {
    get: () => async () => {
      throw err;
    },
  });

describe("GET /api/custom-components", () => {
  it("lists every component by name as summaries, deleted ones flagged with deletedAt", async () => {
    const repo = await seeded(panel, menuItemCard, { ...menuItemCard, description: "Second version." });
    await repo.softDelete("Panel");
    // The panel asks without a trailing slash.
    const res = await call(repo, "GET", "");
    assert.equal(res.statusCode, 200);
    const { components } = res.json();
    assert.deepEqual(
      components.map((c: Record<string, unknown>) => [c.name, c.version, c.versions, c.deletedAt === null]),
      [
        ["MenuItemCard", 2, 2, true],
        ["Panel", 1, 1, false],
      ],
    );
    assert.equal(typeof components[1].deletedAt, "string");
    assert.deepEqual(Object.keys(components[0]).sort(), [
      "category",
      "deletedAt",
      "description",
      "name",
      "updatedAt",
      "version",
      "versions",
    ]);
    assert.equal(components[0].description, "Second version.");
  });

  it("answers an empty list when there are none", async () => {
    const res = await call(new InMemoryCustomComponentRepository(), "GET", "/");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { components: [] });
  });
});

describe("GET /api/custom-components/:name", () => {
  it("returns the current version, its versions and a preview of catalog components only", async () => {
    const repo = await seeded(panel, menuItemCard, specials, { ...specials, description: "Version two." });
    const res = await call(repo, "GET", "/Specials");
    assert.equal(res.statusCode, 200);
    const detail: CustomComponentDetail = res.json();
    assert.equal(detail.component.name, "Specials");
    assert.equal(detail.component.version, 2);
    assert.deepEqual(detail.component.template, specials.template);
    assert.deepEqual(
      detail.versions.map((v) => [v.version, v.description]),
      [
        [1, specials.description],
        [2, "Version two."],
      ],
    );
    assert.deepEqual(detail.previewErrors, []);
    assert.ok(detail.preview);
    const names = componentNames(detail.preview);
    assert.ok(names.every((name) => catalogNames.has(name)), names.join(", "));
    assert.deepEqual(names, ["Card", "Heading", "Card", "Image", "Heading", "Badge", "Divider"]);
    assert.deepEqual(detail.preview.children?.[1].children?.[2].props, { text: "$3.00", tone: "success" });
  });

  it("previews a deleted component", async () => {
    const repo = await seeded(menuItemCard);
    await repo.softDelete("MenuItemCard");
    const detail: CustomComponentDetail = (await call(repo, "GET", "/MenuItemCard")).json();
    assert.equal(typeof detail.component.deletedAt, "string");
    assert.equal(detail.preview?.component, "Card");
    assert.deepEqual(detail.previewErrors, []);
  });

  it("returns a null preview with the problems when expansion fails", async () => {
    const repo = await seeded({ ...menuItemCard, exampleProps: { name: "Latte" } });
    const detail: CustomComponentDetail = (await call(repo, "GET", "/MenuItemCard")).json();
    assert.equal(detail.preview, null);
    assert.ok(detail.previewErrors.some((e) => /price/.test(e)), detail.previewErrors.join("\n"));
  });

  it("returns a null preview when the expanded tree fails the catalog checks", async () => {
    const repo = await seeded(withTemplate("BadHeading", { component: "Heading", props: { text: 5 } }));
    const detail: CustomComponentDetail = (await call(repo, "GET", "/BadHeading")).json();
    assert.equal(detail.preview, null);
    assert.equal(detail.previewErrors.length, 1);
    assert.match(detail.previewErrors[0], /^tree \(BadHeading v1\) template\.props\.text /);
  });

  it("returns 404 for an unknown name", async () => {
    const res = await call(await seeded(panel), "GET", "/Missing");
    assert.equal(res.statusCode, 404);
    assert.match(res.json().error.message, /"Missing"/);
  });
});

describe("DELETE and restore", () => {
  it("deletes and restores with 204", async () => {
    const repo = await seeded(panel);
    const app = await build(repo);
    const deleted = await request(app, "DELETE", "/Panel");
    assert.equal(deleted.statusCode, 204);
    assert.equal(deleted.body, "");
    assert.equal(typeof (await repo.getByName("Panel"))?.deletedAt, "string");
    const restored = await request(app, "POST", "/Panel/restore");
    assert.equal(restored.statusCode, 204);
    assert.equal((await repo.getByName("Panel"))?.deletedAt, null);
    await app.close();
  });

  it("returns 404 for unknown names", async () => {
    const repo = await seeded(panel);
    assert.equal((await call(repo, "DELETE", "/Missing")).statusCode, 404);
    assert.equal((await call(repo, "POST", "/Missing/restore")).statusCode, 404);
    // Names are exact.
    assert.equal((await call(repo, "DELETE", "/PANEL")).statusCode, 404);
  });

  it("returns 409 with the repository's message when a restore is refused", async () => {
    const repo = await seeded(panel);
    const message = "There are already 200 custom components, the limit: delete one first.";
    repo.restore = async () => {
      throw new CustomComponentError("limit", message);
    };
    const res = await call(repo, "POST", "/Panel/restore");
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.json(), { error: { message } });
  });
});

describe("POST /api/custom-components/:name/revert", () => {
  it("saves the chosen version as the new current version", async () => {
    const changed = { ...menuItemCard, description: "Changed.", exampleProps: { ...menuItemCard.exampleProps, name: "Mocha" } };
    const repo = await seeded(menuItemCard, changed);
    const res = await call(repo, "POST", "/MenuItemCard/revert", { version: 1 });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { version: 3 });
    const current = await repo.getByName("MenuItemCard");
    const first = await repo.getVersion("MenuItemCard", 1);
    assert.equal(current?.version, 3);
    assert.deepEqual(
      { ...current, version: 1, createdAt: "", updatedAt: "" },
      { ...first, createdAt: "", updatedAt: "" },
    );
  });

  it("returns 404 for an unknown version or name", async () => {
    const repo = await seeded(menuItemCard);
    const unknownVersion = await call(repo, "POST", "/MenuItemCard/revert", { version: 2 });
    assert.equal(unknownVersion.statusCode, 404);
    assert.match(unknownVersion.json().error.message, /no version 2/);
    assert.equal((await call(repo, "POST", "/Missing/revert", { version: 1 })).statusCode, 404);
    assert.equal((await repo.getByName("MenuItemCard"))?.versions, 1);
  });

  it(`returns 409 past ${MAX_CUSTOM_COMPONENT_VERSIONS} versions and for a deleted component`, async () => {
    const repo = await seeded(...Array.from({ length: MAX_CUSTOM_COMPONENT_VERSIONS }, () => menuItemCard), panel);
    const full = await call(repo, "POST", "/MenuItemCard/revert", { version: 1 });
    assert.equal(full.statusCode, 409);
    assert.match(full.json().error.message, /limit of 20 versions/);

    await repo.softDelete("Panel");
    const deleted = await call(repo, "POST", "/Panel/revert", { version: 1 });
    assert.equal(deleted.statusCode, 409);
    assert.match(deleted.json().error.message, /is deleted: restore it first/);
  });

  it("returns 400 for a bad body", async () => {
    const repo = await seeded(menuItemCard);
    for (const body of [undefined, "{", [], {}, { version: "1" }, { version: 0 }, { version: 1.5 }, { version: 1, extra: true }]) {
      const res = await call(repo, "POST", "/MenuItemCard/revert", body);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(typeof res.json().error.message, "string");
    }
    assert.equal((await repo.getByName("MenuItemCard"))?.versions, 1);
  });

  it("returns 413 for a body over 1 KB", async () => {
    const res = await call(await seeded(menuItemCard), "POST", "/MenuItemCard/revert", {
      version: 1,
      pad: "x".repeat(1024),
    });
    assert.equal(res.statusCode, 413);
  });
});

describe("custom components route", () => {
  it("returns 400 for a name that doesn't match the pattern on every endpoint", async () => {
    const repo = await seeded(panel);
    const requests = [
      ["GET", "/panel"],
      ["GET", "/Bad-Name"],
      ["DELETE", "/1Panel"],
      ["POST", "/Pa%20nel/restore"],
      ["POST", "/Pan_el/revert", { version: 1 }],
    ] as const;
    for (const [method, url, payload] of requests) {
      const res = await call(repo, method, url, payload);
      assert.equal(res.statusCode, 400, `${method} ${url}`);
      assert.match(res.json().error.message, /name must start with a capital letter/);
    }
  });

  it("answers 503 and logs no definition when the repository fails", async () => {
    const template = JSON.stringify(menuItemCard.template);
    // Shaped like a failed Drizzle query: its message and params hold the definition.
    const err = Object.assign(new Error(`Failed query: insert …\nparams: ${template}`), {
      params: [template],
      cause: Object.assign(new Error("Connection terminated unexpectedly"), { code: "57P01" }),
    });
    const logLines: string[] = [];
    const app = await build(failing(err), { logLines });
    const requests = [
      ["GET", "/"],
      ["GET", "/Panel"],
      ["DELETE", "/Panel"],
      ["POST", "/Panel/restore"],
      ["POST", "/Panel/revert", { version: 1 }],
    ] as const;
    for (const [method, url, payload] of requests) {
      const res = await request(app, method, url, payload);
      assert.equal(res.statusCode, 503, `${method} ${url}`);
      assert.deepEqual(res.json(), { error: { message: UNAVAILABLE_MESSAGE } });
    }
    await app.close();
    const failures = logLines.filter((line) => line.includes("custom components repository failed"));
    assert.equal(failures.length, requests.length);
    assert.match(failures[0], /Connection terminated unexpectedly/);
    assert.ok(!logLines.some((line) => line.includes("example.com") || line.includes("Failed query")));
  });

  it("accepts no definition", async () => {
    const repo = await seeded(panel);
    const definition = { ...menuItemCard, name: "Panel" };
    for (const [method, url] of [
      ["POST", "/"],
      ["PUT", "/Panel"],
      ["POST", "/Panel"],
    ] as const) {
      assert.equal((await call(repo, method, url, definition)).statusCode, 404, `${method} ${url}`);
    }
    const revert = await call(repo, "POST", "/Panel/revert", { version: 1, template: menuItemCard.template });
    assert.equal(revert.statusCode, 400);
    assert.equal((await repo.list({ includeDeleted: true })).total, 1);
    assert.equal((await repo.getByName("Panel"))?.versions, 1);
  });

  it("uses the shared rate limit", async () => {
    const app = await build(await seeded(panel), { max: 1 });
    assert.equal((await request(app, "GET", "/Panel")).statusCode, 200);
    assert.equal((await request(app, "GET", "/Panel")).statusCode, 429);
    await app.close();
  });

  it("isn't registered without a custom component repository", async () => {
    const app = await buildApp({ tools: emptyToolRegistry, rateLimit: { max: 1000 } });
    assert.equal((await app.inject({ method: "GET", url: BASE })).statusCode, 404);
    await app.close();
  });
});

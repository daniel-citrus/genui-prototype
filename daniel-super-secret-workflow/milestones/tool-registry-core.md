---
id: tool-registry-core
priority: 20
depends: []
touches:
  - server/agent/tools.ts
  - server/agent/registry.ts
  - server/agent/registry.test.ts
  - server/agent/run.ts
  - server/agent/loop.test.ts
  - server/routes/agent.ts
  - server/routes/agent.test.ts
  - server/validation/jsonSchema.ts
  - package.json
  - package-lock.json
scope: medium
---

# Build a validating tool registry

## Sources

- [Tool registry plan — Step 1, Tool definitions and the registry](./tool-registry.md#3-step-1--tool-definitions-and-the-registry)
- [Component catalog plan — Step 3, shared Ajv instance](./component-catalog.md#5-step-3--the-seed-script)

## Context

The agent loop (`server/agent/loop.ts`) sends `run.tools.specs` to the model and, for each tool call, calls `handleToolCall` in `server/agent/run.ts`, which emits `tool_call`, calls `run.tools.run(call.name, call.args)`, emits `tool_result`, and returns the result to the model as JSON. `server/agent/tools.ts` defines `ToolSpec` (`name`, `description`, `input_schema`), the `ToolRegistry` interface (`specs`, `run(name, args)`), and `emptyToolRegistry`, which `server/index.ts` and `server/routes/agent.test.ts` use. `ToolResult` (`ok`, `summary`, `data?`) is in `shared/api.ts`. `AgentRun` (`emit`, `signal`, `tools`, `resume?`) is built by the chat route in `server/routes/agent.ts`. Malformed tool-argument JSON already becomes `{}` (`parseToolArguments`).

Today there is no way to define a tool with a handler, no argument validation, and a throwing tool would end the turn with an error.

## Scope

**JSON Schema validation** (`server/validation/jsonSchema.ts`): add runtime dependencies `ajv` (v8) and `ajv-formats`. Export one shared Ajv instance (strict mode, `allErrors: true`, formats added so `format: "uri"` works). Also export helpers that check a schema is valid and compile a validator. A later goal reuses this module to validate the component catalog, so keep it general, not tool-specific.

**Definitions** (`server/agent/tools.ts`), keeping `ToolSpec` and `ToolRegistry`:

```ts
export interface ToolLogger {
  debug(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface ToolContext {
  signal: AbortSignal; // aborted when the user presses Stop
  log: ToolLogger;     // the request's logger (Fastify's req.log satisfies this)
}

export interface ToolDefinition {
  name: string;                          // snake_case, unique
  description: string;                   // what it does and when to use it
  input_schema: Record<string, unknown>; // JSON Schema, closed
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
```

`ToolRegistry.run` becomes `run(name, args, ctx: ToolContext)`. `AgentRun` gains `log: ToolLogger`. The chat route sets it from `req.log`, and `handleToolCall` passes `{ signal: run.signal, log: run.log }`.

**`createToolRegistry(definitions)`** (`server/agent/registry.ts`) returns a `ToolRegistry`:

- **At construction**, throw if two tools share a name, a name doesn't match `^[a-z][a-z0-9_]*$`, or an `input_schema` is not valid JSON Schema with `type: "object"` and `additionalProperties: false`. Compile each validator once, here.
- **`specs`**: each definition's `name`, `description`, and `input_schema`, in order.
- **`run(name, args, ctx)`**, in order:
  1. Unknown name: `{ ok: false, summary: "Unknown tool: <name>" }`.
  2. Invalid args: `{ ok: false, summary: "Invalid arguments for <name>", data: { errors } }`, where each error is a short `{ path, message }` the model can act on.
  3. Run the handler. If it throws, `ctx.log.error` with the tool name and error, and return `{ ok: false, summary: "<name> failed" }`, with no error details in the result.
  4. `ctx.log.debug` the tool name, duration in ms, and `ok`.
- **Result size:** if `JSON.stringify(result.data)` is longer than 16,384 characters, replace `data` with `{ truncated: true, note: "Result too large to return" }`.

Replace `emptyToolRegistry` with `createToolRegistry([])`, keeping the exported name so `server/index.ts` needs no change. Update `loop.test.ts` and `routes/agent.test.ts` for the new `run` signature and `AgentRun.log`, using a no-op logger in tests.

Out of scope: any concrete tools, the component catalog, and system prompt changes.

## Acceptance

- `createToolRegistry` throws on a duplicate name, a name like `List-Components`, an invalid schema, and a schema without `additionalProperties: false`.
- An unknown tool, arguments that fail the schema (missing required field, wrong type, extra property), and a handler that throws each return `ok: false` with the summaries above. The thrown error's message is not in the result, and it is logged.
- A handler receives the turn's abort signal (aborting the controller is visible as `ctx.signal.aborted`) and a logger.
- Oversized `data` is replaced with the truncation note. Smaller `data` passes through unchanged.
- With the empty registry, a chat turn behaves as before: `specs` is empty, so the OpenAI adapter sends no `tools`.
- `ajv` and `ajv-formats` are runtime dependencies, so the API image (`npm ci --omit=dev`) and `npm run build:api` still work.
- `npm run typecheck`, `npm test`, `npm run build`, and `npm run build:api` pass.

## Validation

- New `server/agent/registry.test.ts` (this goal adds it) covers every acceptance case above. Run `npm test`.
- `npm run typecheck && npm run build && npm run build:api`: pass.
- `node server-dist/index.mjs` with no `DATABASE_URL` reachable and no OpenAI key starts and answers `GET /api/health` (confirms the bundle resolves `ajv` at runtime). Stop it afterwards.

---
id: api-foundation
priority: 10
depends: []
touches:
  - package.json
  - package-lock.json
  - tsconfig.json
  - tsconfig.app.json
  - tsconfig.server.json
  - vite.config.ts
  - .env.example
  - .gitignore
  - .dockerignore
  - server/index.ts
  - server/config.ts
  - server/routes/health.ts
  - server/ports/AgentLlm.ts
  - server/ports/ComponentRepository.ts
  - server/agent/tools.ts
  - server/agent/openaiTools.ts
  - server/agent/openaiTools.test.ts
  - shared/api.ts
  - shared/components.ts
scope: medium
---

# API foundation: Fastify skeleton, tooling, and shared contracts

## Sources

- [Agent API plan — Step 1, API service scaffold](../../docs/plans/agent-api-and-database.md#4-step-1--api-service-scaffold)
- [Agent API plan — Step 2, Port the agent loop](../../docs/plans/agent-api-and-database.md#5-step-2--port-the-agent-loop) (shared types and `tools.ts`)
- [Agent API plan — Step 5, Adapter scaffold](../../docs/plans/agent-api-and-database.md#8-step-5--adapter-scaffold) (port interfaces)
- CapheVietPOS source at `/Users/daniel/Documents/repo/CapheVietPOS` (also `../CapheVietPOS` from this repo's root), commit `60764e5` (local only)

## Context

The repo is a single-package Vite + TypeScript browser app (`src/main.ts`, Tailwind, Node 24+), with no backend. The plan adds a Fastify API under `server/` with types in `shared/`, in the same package. It ports the OpenAI agent loop from the sibling CapheVietPOS repo, adds Postgres through Drizzle, and connects the chat pane to the API.

Four goals run in parallel after this one: `port-agent-loop`, `openai-llm-adapter`, `postgres-components-store`, and `chat-pane-streaming`. They must not edit `package.json`, the lockfile, the tsconfigs, `vite.config.ts`, `server/config.ts`, or `server/index.ts`. So this goal makes **all** of the shared tooling changes and defines the interfaces they build against. Get the contracts below exactly right: the other goals copy them verbatim.

## Scope

1. **Dependencies.** Install everything the whole plan needs in one go:
   - Runtime: `fastify`, `openai`, `drizzle-orm`, `pg`.
   - Dev: `tsx`, `esbuild`, `concurrently`, `drizzle-kit`, `@types/node`, `@types/pg`.
2. **Scripts** in `package.json`. Keep `build`, `preview`, and `typecheck`. Rename today's `dev` to `dev:web` and add:

   | Script | Command |
   |---|---|
   | `dev` | `concurrently -k -n api,web "npm:dev:api" "npm:dev:web"` |
   | `dev:web` | `vite` |
   | `dev:api` | `tsx watch --tsconfig ./tsconfig.server.json --env-file-if-exists=.env.local server/index.ts` |
   | `build:api` | `esbuild server/index.ts --bundle --platform=node --format=esm --packages=external --tsconfig=tsconfig.server.json --outfile=server-dist/index.mjs` |
   | `test` | `tsx --tsconfig ./tsconfig.server.json --test "server/**/*.test.ts" "src/**/*.test.ts"` |
   | `db:generate` | `drizzle-kit generate` |
   | `db:migrate` | `drizzle-kit migrate` |
   | `db:studio` | `drizzle-kit studio` |

   The `db:*` scripts only work once `postgres-components-store` adds `drizzle.config.ts`. If `tsx` rejects `--env-file-if-exists`, use `--env-file=.env.local` instead and note in `.env.example` that the file must exist.
3. **TypeScript.**
   - New `tsconfig.server.json`, modeled on CapheVietPOS's `tsconfig.server.json`: `target` and `lib` ES2023, `types: ["node"]`, `strict`, `skipLibCheck`, `module: "esnext"`, `moduleResolution: "bundler"`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `moduleDetection: "force"`, `noEmit`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`, and `paths: { "shared/*": ["./shared/*"] }`. Set `include` to `["server", "shared", "drizzle.config.ts", "src/**/*.test.ts"]`. The `src` tests are included so frontend tests that import `node:test` are type-checked with Node types.
   - Add `tsconfig.server.json` to the `references` in `tsconfig.json`.
   - In `tsconfig.app.json`: add `"paths": { "shared/*": ["./shared/*"] }`, add `"shared"` to `include`, and add `"exclude": ["src/**/*.test.ts"]`.
4. **Vite.** In `vite.config.ts`, add a `resolve.alias` so `shared/...` resolves to `./shared/...`, and add `server.proxy` with `"/api": process.env.API_PROXY_TARGET ?? "http://localhost:3001"`. Keep the existing host and port settings.
5. **Config.** `server/config.ts` reads env once and exports `config`:
   - `apiPort` from `API_PORT` (default `3001`), `apiHost` from `API_HOST` (default `127.0.0.1`).
   - `openai: { apiKey, model }` from `OPENAI_API_KEY` (trimmed, default `""`) and `AGENT_MODEL` (default `gpt-4.1`).
   - `databaseUrl` from `DATABASE_URL` (default `postgres://genui:genui@localhost:5432/genui`).
   - `logLevel` from `LOG_LEVEL` (default `info`).

   Also export `agentAvailable = config.openai.apiKey.length > 0`. Secrets are read only in this file.
6. **Env and ignore files.**
   - `.env.example` lists every variable above with the dev defaults and an empty `OPENAI_API_KEY`. `.env.local` is already ignored through `*.local`.
   - Add `server-dist/` to `.gitignore` and `.dockerignore`.
7. **`shared/api.ts`**, ported from CapheVietPOS `shared/api.ts`:
   - `ToolCall { id: string; name: string; args: Record<string, unknown> }` (no `mutates`).
   - `ToolResult { ok: boolean; summary: string; data?: unknown }`.
   - `AgentChatRequest { conversationId: string; message: string; resume?: boolean }`.
   - `AgentEvent`: `{type:"text";text}`, `{type:"tool_call";call}`, `{type:"tool_result";call;result}`, `{type:"notice";message}`, `{type:"done"}`, `{type:"error";message}`.

   Nothing else from that file.
8. **`shared/components.ts`:**
   - `ComponentSpec = Record<string, unknown>`.
   - `PropsSchema { type: "object"; properties: Record<string, unknown>; required?: string[] }`.
   - `Component { id: string; name: string; spec: ComponentSpec; propsSchema: PropsSchema; createdAt: string; updatedAt: string }`, with ISO timestamps.
   - `NewComponent = { name; spec; propsSchema }` and `ComponentPatch = Partial<NewComponent>`.
9. **`server/agent/tools.ts`:**
   - `ToolSpec { name: string; description: string; input_schema: Record<string, unknown> }`.
   - `ToolRegistry { specs: ToolSpec[]; run(name: string, args: Record<string, unknown>): Promise<ToolResult> }`.
   - `emptyToolRegistry`, with `specs: []` and a `run` that resolves `{ ok: false, summary: "Unknown tool: <name>" }`.
10. **`server/ports/AgentLlm.ts`**, interfaces only:
    - `HistoryMessage`, the union from CapheVietPOS `server/agent/conversations.ts`: `user`, `assistant` with optional `tool_calls`, and `tool` with `tool_call_id`.
    - `LlmUsage { promptTokens; completionTokens }` and `LlmTurn { content: string | null; toolCalls: Array<{ id; name; arguments: string }>; usage?: LlmUsage }`.
    - `AgentLlm { complete(input: { messages: HistoryMessage[]; tools: ToolSpec[]; signal: AbortSignal; onText(text: string): void }): Promise<LlmTurn> }`.

    Tools are vendor-neutral `ToolSpec`s; the OpenAI adapter converts them.
11. **`server/ports/ComponentRepository.ts`:**
    - `ComponentRepository` with `list(): Promise<Component[]>`, `get(id): Promise<Component | undefined>`, `create(input: NewComponent): Promise<Component>`, `update(id, patch: ComponentPatch): Promise<Component | undefined>`, and `remove(id): Promise<boolean>`.
    - `class NameTakenError extends Error`, carrying the conflicting `name`.
12. **`server/agent/openaiTools.ts`:** copy CapheVietPOS `server/agent/openaiTools.ts` unchanged except that `ToolSpec` comes from `./tools`. It provides `toOpenAITools`, `parseToolArguments`, and `createTurnAccumulator`. Port `openaiTools.test.ts`, replacing the `menuTools` `toolSpecs` import with one or two inline `ToolSpec`s.
13. **Server skeleton.**
    - `server/routes/health.ts`: a Fastify plugin with options `{ pingDb?: () => Promise<boolean> }` serving `GET /` → `{ ok: true, db, agent }`. `db` is `await pingDb()` (with `false` on a throw, or when no `pingDb` is passed), and `agent` is `agentAvailable`.
    - `server/index.ts`:
      - Fastify with `logger: { level: config.logLevel }`.
      - The empty-body-tolerant `application/json` parser and the `setErrorHandler` from CapheVietPOS `server/index.ts`, without the `RepositoryError` branch.
      - Register the health plugin at `/api/health`, then `listen({ port: config.apiPort, host: config.apiHost })`.
      - No auth and no other routers. `wire-api-services` adds the rest later.

## Acceptance

- `npm run typecheck` covers the app, Vite config, and server projects, and passes.
- `npm test` runs the ported `openaiTools` tests, and they pass.
- With no `.env.local`, `npm run dev` starts both the API on `127.0.0.1:3001` and Vite on `:5173`. `curl -s localhost:5173/api/health` returns `{"ok":true,"db":false,"agent":false}` through the proxy.
- With `OPENAI_API_KEY` set in `.env.local`, the same request reports `"agent":true`.
- `npm run build` still produces `dist/`, and `npm run build:api` produces `server-dist/index.mjs`.
- No file under `server/` or `shared/` imports anything about menus, Square, Auth0, permissions, traces, or audit.

## Validation

- `npm ci && npm run typecheck && npm test && npm run build && npm run build:api`, all exiting 0.
- `npm run dev`, then `curl -s localhost:5173/api/health` and `curl -s localhost:3001/api/health`, both returning the JSON above.

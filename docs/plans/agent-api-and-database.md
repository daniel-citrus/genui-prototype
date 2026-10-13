# Plan: Agent API service and Postgres

Add a backend to the prototype. A Fastify + TypeScript API runs the OpenAI agent loop ported from CapheVietPOS, the chat pane sends its prompts to that API, and a Postgres database (through Drizzle) holds a `components` table for generated UI component structures.

**Status:** not started · **Source of the agent:** [`../CapheVietPOS/server/agent/`](../../../CapheVietPOS/server/agent/) at `60764e5`

Related: [Architecture](../ARCHITECTURE.md) · [Plans](./README.md)

## Index

1. [Goals and non-goals](#1-goals-and-non-goals)
2. [Target shape](#2-target-shape)
3. [Repository layout](#3-repository-layout)
4. [Step 1 — API service scaffold](#4-step-1--api-service-scaffold)
5. [Step 2 — Port the agent loop](#5-step-2--port-the-agent-loop)
6. [Step 3 — Connect the chat pane](#6-step-3--connect-the-chat-pane)
7. [Step 4 — Postgres and the `components` table](#7-step-4--postgres-and-the-components-table)
8. [Step 5 — Adapter scaffold](#8-step-5--adapter-scaffold)
9. [Step 6 — Docker, docs, and checks](#9-step-6--docker-docs-and-checks)
10. [Decisions and open questions](#10-decisions-and-open-questions)

## 1. Goals and non-goals

**Goals**

- A Node 24 API in TypeScript on **Fastify**, in the same repo and package as the Vite app.
- The **agent loop and OpenAI client** from CapheVietPOS, with nothing else carried over.
- Prompts typed in the chat pane go to the API, and the reply streams back into the thread.
- A **Postgres** database with a `components` table holding a name, a JSON spec, and a props schema per component.
- **Adapters** with Drizzle as the ORM: one for the database and one for OpenAI, each behind a small interface so callers and tests don't depend on the vendor.

**Non-goals (this plan)**

- Agent tools. The loop keeps its tool-calling path, but the tool list starts empty.
- Rendering generated components in the sandbox pane.
- Auth, sessions in the session dropdown, and persisting chat history in Postgres. Conversations stay in memory as they do in the source.
- Anything else from CapheVietPOS: menu tools, Square, Auth0, permissions, the Apply / Skip confirmation flow (`pending.ts`), the offline parser (`offline.ts`), SQLite trace and audit logs, the eval harness (`__evals__/`), fixtures, and scripts.

## 2. Target shape

```mermaid
flowchart LR
  subgraph browser ["Browser"]
    Chat["Chat pane (src/main.ts)"]
  end

  subgraph api ["API (Fastify, :3001)"]
    Route["POST /api/agent/chat (SSE)"]
    Loop["agent loop"]
    LlmPort["AgentLlm interface"]
    RepoPort["ComponentRepository interface"]
  end

  OpenAI["OpenAI Chat Completions"]
  PG[("Postgres: components")]

  Chat -- "fetch + SSE stream" --> Route --> Loop --> LlmPort
  LlmPort -- "OpenAI adapter" --> OpenAI
  RepoPort -- "Drizzle adapter" --> PG
```

| Mode | Web | API | Database |
|---|---|---|---|
| Dev (Node) | Vite on :5173, proxies `/api` to :3001 | `tsx watch` on :3001 | Postgres from Compose on :5432 |
| Dev (Compose) | `dev` service | `api-dev` service | `db` service |
| Production (Compose) | nginx on :8080, proxies `/api` to `api` | `api` image (bundled with esbuild) | `db` service, named volume |

The browser only ever calls same-origin `/api/...`, so there is no CORS setup.

## 3. Repository layout

The repo stays a single package. New directories mirror the CapheVietPOS split: `server/` for the API and `shared/` for types both sides import.

```
genui-prototype/
├── server/
│   ├── index.ts                  # Fastify app: JSON parser, error handler, routes, listen
│   ├── config.ts                 # env: API_PORT, OPENAI_API_KEY, AGENT_MODEL, DATABASE_URL
│   ├── routes/
│   │   ├── agent.ts              # POST /api/agent/chat (SSE)
│   │   └── health.ts             # GET /api/health (API + DB ping)
│   ├── agent/
│   │   ├── loop.ts               # runTurn / runAgent, MAX_STEPS, SYSTEM_PROMPT
│   │   ├── run.ts                # AgentRun, handleToolCall (stripped down)
│   │   ├── tools.ts              # ToolSpec + empty tool registry
│   │   ├── conversations.ts      # in-memory history, oneTurnAtATime
│   │   ├── openaiTools.ts        # toOpenAITools, parseToolArguments, createTurnAccumulator
│   │   └── *.test.ts
│   ├── adapters/
│   │   ├── openai/OpenAILlm.ts   # createOpenAILlm(): AgentLlm
│   │   └── db/
│   │       ├── client.ts         # pg Pool + drizzle() instance
│   │       ├── schema.ts         # components table
│   │       ├── migrations/       # drizzle-kit output (committed)
│   │       └── DrizzleComponentRepository.ts
│   └── ports/
│       ├── AgentLlm.ts           # LLM interface the loop calls
│       └── ComponentRepository.ts
├── shared/
│   ├── api.ts                    # AgentChatRequest, AgentEvent, ToolCall, ToolResult
│   └── components.ts             # Component, ComponentSpec, PropsSchema
├── src/
│   ├── main.ts                   # composer now streams from the API
│   └── agentClient.ts            # fetch + SSE reader
├── drizzle.config.ts
├── tsconfig.server.json          # server/ + shared/, bundler resolution, types: node
├── .env.example
└── ...
```

## 4. Step 1 — API service scaffold

**Dependencies**

- Runtime: `fastify`, `openai`, `drizzle-orm`, `pg`.
- Dev: `tsx`, `esbuild`, `concurrently`, `drizzle-kit`, `@types/node`, `@types/pg`.

**Files**

- `tsconfig.server.json`, modeled on the CapheVietPOS one: `target`/`lib` ES2023, `types: ["node"]`, `moduleResolution: "bundler"`, `noEmit`, `paths: { "shared/*": ["./shared/*"] }`, `include: ["server", "shared", "drizzle.config.ts"]`. Add it to the root `tsconfig.json` references so `npm run typecheck` covers it.
- `server/config.ts`: reads env once. `API_PORT` (default 3001), `OPENAI_API_KEY`, `AGENT_MODEL` (default `gpt-4.1`, as in the source), `DATABASE_URL`, `LOG_LEVEL`. Secrets are read only here.
- `server/index.ts`: Fastify with logger, the empty-body-tolerant JSON parser and error handler from the source (minus `RepositoryError` until something throws it), routes under `/api/...`, listen on `API_HOST` (default `127.0.0.1`; `0.0.0.0` in Docker).
- `server/routes/health.ts`: `GET /api/health` returns `{ ok, db, agent }`, where `db` is the result of `select 1` and `agent` says whether an OpenAI key is set.
- `.env.example` with every variable above. `.env.local` is already ignored by `*.local`.

**Scripts** in `package.json`

| Script | Command |
|---|---|
| `dev` | `concurrently -k -n api,web "npm:dev:api" "npm:dev:web"` |
| `dev:web` | `vite` (today's `dev`) |
| `dev:api` | `tsx watch --tsconfig ./tsconfig.server.json --env-file-if-exists=.env.local server/index.ts` |
| `build:api` | `esbuild server/index.ts --bundle --platform=node --format=esm --packages=external --tsconfig=tsconfig.server.json --outfile=server-dist/index.mjs` |
| `test` | `tsx --tsconfig ./tsconfig.server.json --test "server/**/*.test.ts"` |

**Vite:** add `server.proxy: { "/api": "http://localhost:3001" }` in `vite.config.ts` (an env override for the Compose dev service, where the target is `http://api-dev:3001`).

**Done when** `npm run dev` starts both processes and `curl localhost:5173/api/health` answers through the proxy.

## 5. Step 2 — Port the agent loop

Copy only what the loop needs, then cut every dependency on menus, permissions, confirmation, and tracing.

| Source file | Action | What changes |
|---|---|---|
| `server/agent/loop.ts` | Port | Keep `MAX_STEPS`, `runTurn`, the tool-call branch, and `FORGOTTEN_NOTICE`. Replace the coffee-shop `SYSTEM_PROMPT` with a short placeholder for a UI-generation assistant. Move `AgentLlm`, `LlmTurn`, `LlmUsage` to `server/ports/AgentLlm.ts` and `createOpenAILlm` to `server/adapters/openai/OpenAILlm.ts`. The loop takes its `AgentLlm` and tool registry as arguments, with no module-level default client. Drop the `config` import. |
| `server/agent/openaiTools.ts` | Copy as is | Retype `ToolSpec` import to `./tools`. |
| `server/agent/conversations.ts` | Port | Keep `HistoryMessage`, `getHistory`, `hasConversation`, `resetConversation`, `oneTurnAtATime`, `MAX_CONVERSATIONS`. Drop `conversationKey` (no signed-in owner to scope by). |
| `server/agent/run.ts` | Port, much smaller | `AgentRun` becomes `{ emit, signal, tools, resume? }`. `handleToolCall` becomes announce → (stopped? report) → run → report. Remove `can`, `permissionRefusal`, `precheck`, `confirm`, and `MenuToolbox`. |
| `shared/api.ts` | Port the types only | `ToolCall` (drop `mutates`), `ToolResult`, `AgentChatRequest` (`conversationId`, `message`, `resume?`), and `AgentEvent` without `awaiting_confirmation`. |
| `server/routes/agent.ts` | Port `/chat` only | Keep the hijacked SSE response, the abort-on-response-close handling, and the `done` / `error` events. Remove auth, trace, audit, `/confirm`, `/abort`, `/traces`, and the offline fallback. With no `OPENAI_API_KEY`, emit one `error` event naming the missing variable. |
| `loop.test.ts`, `openaiTools.test.ts`, `conversations.test.ts` | Port | Replace the `MenuToolbox` stub with a stub tool registry. Drop cases about permissions, prechecks, and Apply / Skip. |
| Everything else under `server/` and `shared/` | Leave behind | `menuTools.ts`, `offline.ts`, `pending.ts`, `traceReplay.test.ts`, `conversationMemory.test.ts` (uses trace replay), `__evals__/`, `__fixtures__/`, `trace/`, `audit/`, `menu/`, `people/`, auth files, `shared/domain/`. |

**New `server/agent/tools.ts`:** the `ToolSpec` shape (`name`, `description`, `input_schema`) and a `ToolRegistry` interface (`specs`, `run(name, args)`), exported with an empty registry. When the registry is empty, the OpenAI adapter leaves `tools` out of the request, since the API rejects an empty `tools` array.

**Done when** `npm test` passes, and `curl -N -X POST localhost:3001/api/agent/chat -H 'content-type: application/json' -d '{"conversationId":"t1","message":"hi"}'` streams `text` events then `done`.

## 6. Step 3 — Connect the chat pane

- **`src/agentClient.ts`:** `streamChat({ conversationId, message, signal }, onEvent)` posts to `/api/agent/chat` and reads `response.body` with a `TextDecoder`, splitting on blank lines and parsing each `data:` line as an `AgentEvent`. It uses `fetch` rather than `EventSource` because the request is a POST with a JSON body.
- **`src/main.ts`:**
  - Create one `conversationId` per page load with `crypto.randomUUID()`.
  - On submit: append the user bubble as today, then an empty assistant bubble (left-aligned, neutral colors) that `text` events append to.
  - `notice` and `error` events render as small system lines in the thread. `tool_call` and `tool_result` render as one compact line each, so they are visible once tools exist.
  - While a turn streams, disable Send and turn it into Stop, which aborts the fetch. The server sees the response close and stops the loop.
  - The session dropdown stays empty.
- `src/` imports types from `shared/api.ts`. Add `"paths": { "shared/*": ["./shared/*"] }` and `shared` to `include` in `tsconfig.app.json`, plus a matching `resolve.alias` in `vite.config.ts`.

**Done when** a prompt typed in the browser streams a reply into the thread, and Stop ends it mid-stream.

## 7. Step 4 — Postgres and the `components` table

- **Compose:** add a `db` service (`postgres:17-alpine`, `POSTGRES_DB=genui`, user and password from env with dev defaults, a named volume `pgdata`, port 5432, and a `pg_isready` healthcheck).
- **`DATABASE_URL`:** `postgres://genui:genui@localhost:5432/genui` for host dev, and `@db:5432` inside Compose.
- **`drizzle.config.ts`:** `dialect: "postgresql"`, `schema: "./server/adapters/db/schema.ts"`, `out: "./server/adapters/db/migrations"`, credentials from `DATABASE_URL`.
- **Scripts:** `db:generate` (`drizzle-kit generate`), `db:migrate` (`drizzle-kit migrate`), `db:studio` (`drizzle-kit studio`). Migrations are committed and are the only way the schema changes. Production runs them with `drizzle-orm/node-postgres/migrator` on API start.
- **`components` table:**

  ```ts
  // server/adapters/db/schema.ts
  export const components = pgTable("components", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    spec: jsonb("spec").$type<ComponentSpec>().notNull(),
    propsSchema: jsonb("props_schema").$type<PropsSchema>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });
  export type ComponentRow = typeof components.$inferSelect;
  export type NewComponentRow = typeof components.$inferInsert;
  ```

  | Column | Type | Holds |
  |---|---|---|
  | `id` | `uuid`, primary key, random default | Row identity |
  | `name` | `text`, not null, unique | The name the agent and UI refer to the component by |
  | `spec` | `jsonb`, not null | The component's structure (element tree, layout, bindings) |
  | `props_schema` | `jsonb`, not null | A JSON Schema describing the props the component accepts |
  | `created_at`, `updated_at` | `timestamptz`, default `now()` | Bookkeeping |

  `ComponentSpec` and `PropsSchema` live in `shared/components.ts`. `PropsSchema` is a JSON Schema object (`{ type: "object", properties, required? }`). `ComponentSpec` starts as `Record<string, unknown>` until its shape is settled (see [open questions](#10-decisions-and-open-questions)), so the column type doesn't change when it is.

**Done when** `docker compose up db` and `npm run db:migrate` create the table, and `GET /api/health` reports `db: true`.

## 8. Step 5 — Adapter scaffold

Each external system sits behind an interface in `server/ports/`. Callers import the interface, and `server/index.ts` is the one place that builds the real adapters and passes them in.

**OpenAI**

- `server/ports/AgentLlm.ts`: `AgentLlm.complete({ messages, tools, signal, onText }) → LlmTurn`, moved out of `loop.ts`.
- `server/adapters/openai/OpenAILlm.ts`: `createOpenAILlm({ apiKey, model, maxRetries?, systemPrompt })`, the source's streaming implementation with the system prompt and tools passed in rather than read from module scope. The `OpenAI` client is still created lazily on first use.
- Tests use a scripted `AgentLlm` (a list of canned `LlmTurn`s), as `loop.test.ts` already does.

**Database**

- `server/adapters/db/client.ts`: `createDb(databaseUrl)` returns `{ db, pool, close }`, where `db = drizzle(pool, { schema })` over a `pg` `Pool`. `server/index.ts` closes the pool in an `onClose` hook.
- `server/ports/ComponentRepository.ts`: `list()`, `get(id)`, `create(input)`, `update(id, patch)`, `remove(id)`, typed against the `Component` type in `shared/components.ts` (`id`, `name`, `spec`, `propsSchema`, `createdAt`, `updatedAt`) rather than the Drizzle row, so the ORM stays inside the adapter.
- `server/adapters/db/DrizzleComponentRepository.ts`: implements the interface with Drizzle queries and sets `updatedAt` on update. `create` and `update` turn a unique-name violation into a typed `NameTakenError` so callers don't see Postgres error codes.
- No HTTP routes or agent tools use the repository yet. It is built and passed to the app context so the next plan can add `/api/components` routes or agent tools without touching the wiring.

**Done when** a `DrizzleComponentRepository` test (gated on `DATABASE_URL`, skipped without it) creates, reads, updates, and removes a row against the Compose database, and checks that a duplicate name is refused.

## 9. Step 6 — Docker, docs, and checks

**Docker**

- `Dockerfile.api`: Node 24 alpine, `npm ci`, `npm run build:api`, then a runtime stage with production dependencies and `server-dist/` plus the migrations folder. Listens on `0.0.0.0:3001`.
- `docker-compose.yml`:
  - `db` as in Step 4.
  - `api-dev`: Node 24, repo mounted, `npm run dev:api`, depends on `db` being healthy.
  - `dev` (web): sets the proxy target to `api-dev`.
  - `api`: built from `Dockerfile.api`, depends on `db`.
  - `web`: depends on `api`.
- `nginx.conf`: add `location /api/ { proxy_pass http://api:3001; proxy_buffering off; proxy_read_timeout 300s; }` so SSE is not buffered.
- `.gitignore` and `.dockerignore`: add `server-dist/`.

**Docs**

- `docs/ARCHITECTURE.md`: update purpose, runtime shapes, layout, scripts, and Docker sections for the API and database. Drop "no backend, database, or API yet".
- `README.md`: env setup (`cp .env.example .env.local`), `docker compose up db`, `npm run db:migrate`, `npm run dev`.
- `docs/plans/README.md`: list this plan under **Active** while it is in progress, then move it to milestones when it ships.

**Final checks**

- `npm run typecheck` covers app, node, and server configs.
- `npm test` passes.
- `npm run build` and `npm run build:api` succeed.
- `docker compose up web --build` serves the app on :8080, and a prompt streams a reply through nginx.

## 10. Decisions and open questions

**Decided**

- **`components` columns:** `name`, `spec` (jsonb), and `props_schema` (jsonb), plus `id` and timestamps.
- **Default model:** `gpt-4.1`, the same as the source. `AGENT_MODEL` overrides it.
- **Conversation storage:** in memory, as in the source. History is lost on restart and capped at 500 conversations.

**Open**

1. **Shape of `spec`.** What the JSON inside `spec` looks like (element tree, slot names, how props bind into it) is for the plan that has the agent generate components and the sandbox render them.
2. **Repo shape.** This plan keeps one package. If the API grows its own dependency set, it could split into npm workspaces (`apps/web`, `apps/api`, `packages/shared`).

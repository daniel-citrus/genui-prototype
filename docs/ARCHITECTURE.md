# Architecture

genui-prototype is a two-pane web app: on the left you chat with an AI agent, on the right a sandbox will show the UI it generates. It is a **Vite + TypeScript** browser app and a **Fastify** API in one repository. The API runs the agent on **OpenAI** and streams replies to the browser over server-sent events (SSE), and it owns a **Postgres** database accessed through **Drizzle**.

Related: [README](../README.md)

## Index

1. [System overview](#1-system-overview)
2. [Browser app](#2-browser-app)
3. [API](#3-api)
4. [A chat turn, end to end](#4-a-chat-turn-end-to-end)
5. [Data](#5-data)
6. [Environments](#6-environments)
7. [Configuration](#7-configuration)
8. [Repository layout](#8-repository-layout)
9. [Build, test, and CI](#9-build-test-and-ci)
10. [Current limits and what's next](#10-current-limits-and-whats-next)

## 1. System overview

```mermaid
flowchart LR
  subgraph Browser
    Chat["Chat pane"]
    Sandbox["Sandbox pane<br/>(placeholder)"]
    Client["Agent client<br/>fetch + SSE reader"]
    Chat --> Client
  end

  Edge["Web server<br/>Vite :5173 in dev<br/>nginx :8080 in production"]

  subgraph API ["API (Fastify, Node 24, :3001)"]
    Routes["HTTP routes<br/>GET /api/health<br/>POST /api/agent/chat"]
    Loop["Agent loop"]
    Convos["Conversations<br/>(in memory)"]
    Tools["Tool registry<br/>list_components, get_component"]
    LlmPort["AgentLlm port"]
    RepoPort["ComponentRepository port"]
    OpenAIAdapter["OpenAI adapter"]
    DbAdapter["Drizzle adapter"]
    Routes --> Loop
    Loop --> Convos
    Loop --> Tools
    Loop --> LlmPort
    Tools --> RepoPort
    LlmPort --> OpenAIAdapter
    RepoPort --> DbAdapter
  end

  OpenAI["OpenAI<br/>Chat Completions"]
  DB[("Postgres<br/>components table")]

  Client -- "POST /api/agent/chat" --> Edge
  Edge -- "proxies /api" --> Routes
  Edge -. "SSE events" .-> Client
  OpenAIAdapter -- "streaming HTTPS" --> OpenAI
  DbAdapter --> DB
  Routes -. "health check" .-> DB
```

- **The browser only talks to its own origin.** The web server serves the app and proxies `/api` to the API, so there is no CORS setup.
- **The API follows ports and adapters.** The agent loop and future features depend on small interfaces (`AgentLlm`, `ComponentRepository`). The OpenAI and Drizzle adapters implement them, and [server/index.ts](../server/index.ts) is the one place that wires real adapters in. Tests swap in fakes.
- **Types shared by both sides** (request bodies, SSE event shapes, component types) live in [shared/](../shared/), so the browser and the API can't disagree about the wire format.

## 2. Browser app

```
┌──────────────────────────────┬──────────────────────────────┐
│ [ session ▾ ]  (empty)       │                              │
├──────────────────────────────┤                              │
│  agent chat thread           │  sandbox panel               │
│  (user + streamed agent      │  (placeholder)               │
│   bubbles, notices, errors)  │                              │
├──────────────────────────────┤                              │
│ [ Message the agent…     ]   │                              │
│               [Send / Stop]  │                              │
└──────────────────────────────┴──────────────────────────────┘
```

- **Chat pane:** each message opens an agent bubble that fills in as text streams back. Tool calls, notices, and errors render as small lines in the thread. While a reply streams, **Send** becomes **Stop**, which aborts the request; the API sees the connection close and stops the turn.
- **Conversation identity:** one conversation per page load (a random id). Reloading starts a new one.
- **Sandbox pane and session menu:** placeholders for now.
- **Stack:** plain TypeScript and DOM APIs, no UI framework; styling with Tailwind. Code is in [src/](../src/): the shell and chat rendering, the agent client, and an SSE parser.

## 3. API

| Part | Role |
|---|---|
| **Routes** ([server/routes/](../server/routes/)) | `GET /api/health` returns `{ ok, db, agent }`: whether Postgres answers and whether an OpenAI key is set. `POST /api/agent/chat` runs one agent turn and streams it back as SSE |
| **Agent** ([server/agent/](../server/agent/)) | The tool-use loop (§4), the in-memory conversation store, the tool registry, and the agent's tools (`tools/`): `list_components` lists the catalog by name, category, description and children; `get_component` returns one component's props schema and example props |
| **Ports** ([server/ports/](../server/ports/)) | `AgentLlm`: run one model turn with streaming. `ComponentRepository`: read the component catalog. `fakes/`: in-memory versions for tests |
| **Adapters** ([server/adapters/](../server/adapters/)) | `openai/`: streaming Chat Completions. `db/`: Drizzle client, schema, migrations, the repository, and the catalog seed |
| **Catalog** ([server/catalog/](../server/catalog/)) | `components.ts`: the predefined UI components, the source of truth for the `components` table. `validate.ts`: the rules every entry follows (§5) |
| **Config** ([server/config.ts](../server/config.ts)) | The only place the API reads environment variables (§7) |

**Startup.** The API builds its adapters and registers the routes. In production it first applies database migrations, then seeds the component catalog (§5), and exits with status 1 if either fails. In development both are run by hand (`npm run db:migrate`, then `npm run db:seed`) and the API starts even when Postgres is down (health then reports `db: false`, and component tool calls fail until it is up). Without an OpenAI key the API still starts; health reports `agent: false` and a chat turn answers with one `error` event naming the missing key.

## 4. A chat turn, end to end

```mermaid
sequenceDiagram
  actor User
  participant B as Browser
  participant R as Chat route
  participant L as Agent loop
  participant O as OpenAI
  participant T as Tool registry

  User->>B: types a message
  B->>R: POST /api/agent/chat
  R->>L: run the turn
  Note over L: one turn at a time per conversation
  loop up to 10 model calls
    L->>O: history and tool definitions
    O-->>L: streamed text and tool calls
    L-->>B: text events (SSE)
    opt the model asked for tools
      L->>T: run each tool
      T-->>L: result, added to history
      L-->>B: tool_call and tool_result events
    end
  end
  R-->>B: done, or error
```

- The loop sends the conversation history and the available tools to the model, streams its text to the browser as it arrives, runs any tools the model asks for, and calls the model again with the results. A reply with no tool calls ends the turn.
- Each turn is capped by the constants in [server/agent/guardrails.ts](../server/agent/guardrails.ts): 10 model calls, 20 tool calls, and 150,000 tokens (prompt plus completion, summed over the turn's calls). The last call, and any call after the tool-call or token cap is reached, is sent with tool use switched off (`tool_choice: "none"`), so the model answers with what it has. A tool call past the cap, or a repeat of an earlier call with the same arguments, is not run; the model is told so. If the model still asks for tools once they are off, the turn ends with an `error` event.
- A reply cut off by the output-token limit (`AGENT_MAX_OUTPUT_TOKENS`) is followed by a `notice` event. Every turn ends with one info log line: conversation id, model calls, tool calls, prompt and completion tokens, and why it ended.
- The system prompt is added by the OpenAI adapter on each call, so it is never stored in history.
- The registry checks each call's arguments against the tool's schema before running it. An unknown tool, invalid arguments, or a tool that throws (Postgres down, for example) comes back as an `ok: false` result the model can read; failures are logged.
- SSE event types: `text`, `tool_call`, `tool_result`, `notice`, `done`, `error` (defined in [shared/api.ts](../shared/api.ts)).
- If the API has forgotten a conversation the browser is continuing (after a restart, for example), the agent sends a `notice` saying so and answers the message on its own.

## 5. Data

| Data | Where | Lifetime |
|---|---|---|
| Conversation history | API memory | Until the API restarts. At most 500 conversations; the least recently used is dropped first |
| UI components | [server/catalog/components.ts](../server/catalog/components.ts), copied to Postgres `components` table by the seed | The file is the source of truth; the table can be dropped and reseeded at any time. Schema changes only through committed Drizzle migrations |

**`components` table:** a catalog of predefined UI components. Columns: `id`, `name` (unique), `description`, `category` (check: `layout`, `text`, `input`, or `display`), `children` (check: `none` or `any`), `props_schema` (JSON Schema), `example_props` (JSON), and timestamps. Rendering lives in browser code keyed by `name`, so no render spec is stored. The API's `ComponentRepository` is read-only (`list`, `get`, `getByName`); only the seed writes rows. The agent reads it through the `list_components` and `get_component` tools; no HTTP route exposes it (§10).

**Catalog and seed.** `server/catalog/components.ts` exports the twelve basic components (`Stack`, `Card`, `Divider`, `Heading`, `Text`, `Button`, `TextInput`, `Checkbox`, `Select`, `Image`, `Badge`, `Alert`). Text content is a prop, so only `Stack` and `Card` take children. `validateCatalog` (Ajv, the shared strict instance in `server/validation/jsonSchema.ts`) checks that every name matches `^[A-Z][A-Za-z0-9]*$` and is unique, the description is non-empty, `propsSchema` is valid JSON Schema with `type: "object"`, `additionalProperties: false`, and a `description` on every property, and every `default` and `exampleProps` is valid against it. `seedComponents(db, catalog)` (`server/adapters/db/seed.ts`) validates first and, on any problem, throws listing them all and writes nothing. Otherwise, in one transaction, it inserts missing entries, updates rows whose fields differ (setting `updated_at`), deletes rows whose name left the catalog, leaves the rest untouched, and returns `{ added, updated, removed, unchanged }`. Running it twice ends in the same state.

- **Development:** `npm run db:seed` after `npm run db:migrate` prints `components: N added, N updated, N removed, N unchanged`.
- **Production:** the API seeds right after migrating on start, logs the same counts, and exits with status 1 if the seed fails. The catalog is bundled into the API, so the image needs no extra files.

## 6. Environments

| Mode | Command | Web | API | Database | URL |
|---|---|---|---|---|---|
| Dev | `npm run dev` | Vite dev server with hot reload | `tsx watch`, reads `.env.local` | Compose `db` service | http://localhost:5173 |
| Dev in containers | `docker compose up dev` | `dev` container | `api-dev` container | `db` container | http://localhost:5173 |
| Production | `docker compose up web --build` | nginx serving the built app | `api` container, migrates and seeds on start | `db` container, named volume | http://localhost:8080 |

```mermaid
flowchart LR
  User["Browser"] -- ":8080" --> Web["web<br/>nginx + built app"]
  Web -- "/api, unbuffered" --> Api["api<br/>Node, bundled server"]
  Api --> Db[("db<br/>Postgres 17")]
  Api -- "HTTPS" --> OpenAI["OpenAI"]
```

- **Images:** the web image builds the app and serves it with nginx. The API image bundles the server with esbuild and ships only production dependencies and the migrations.
- **SSE through nginx:** buffering is off for `/api/` and reads time out after 300 seconds, so events reach the browser as they are written.
- **Ports:** only `web` (8080) and `db` (5432) are published in production; the API is reached through nginx. If a host port is taken, remap it in an uncommitted `docker-compose.override.yml`.

## 7. Configuration

| Variable | Default | Used by |
|---|---|---|
| `OPENAI_API_KEY` | none (the agent is off without it) | API |
| `AGENT_MODEL` | `gpt-4.1` | API |
| `AGENT_MAX_OUTPUT_TOKENS` | `2048` (output tokens allowed per model call) | API |
| `DATABASE_URL` | `postgres://genui:genui@localhost:5432/genui` | API, migrations |
| `API_PORT` / `API_HOST` | `3001` / `127.0.0.1` (`0.0.0.0` in containers) | API |
| `LOG_LEVEL` | `info` | API |
| `API_PROXY_TARGET` | `http://localhost:3001` | Vite dev server |

For local development, copy [.env.example](../.env.example) to `.env.local` and set `OPENAI_API_KEY`. The `.env.local` file is ignored by git and kept out of Docker builds.

## 8. Repository layout

One npm package, no monorepo.

```
genui-prototype/
├── src/            browser app: shell, chat rendering, agent client, SSE parser
├── server/         Fastify API
│   ├── routes/     health and chat endpoints
│   ├── agent/      agent loop, conversations, tool registry, tools
│   ├── catalog/    component catalog file and its validation
│   ├── ports/      interfaces the app depends on
│   └── adapters/   OpenAI and Postgres (Drizzle) implementations, migrations, seed
├── shared/         types used by both the browser and the API
├── docs/           this file
├── .github/        CI workflow
├── Dockerfile      web image (build + nginx)
├── Dockerfile.api  API image (esbuild bundle + production dependencies)
└── docker-compose.yml, nginx.conf, vite.config.ts, drizzle.config.ts, tsconfig*.json
```

Runtime dependencies are the API's: `fastify`, `openai`, `drizzle-orm`, `pg`, and `ajv` with `ajv-formats`. Everything else (Vite, TypeScript, Tailwind, tsx, esbuild, drizzle-kit) is a development dependency.

## 9. Build, test, and CI

| Command | Does |
|---|---|
| `npm run dev` | Runs the web dev server and the API together |
| `npm run build` / `npm run build:api` | Builds the browser app to `dist/` / bundles the API to `server-dist/` |
| `npm run typecheck` | Type-checks the browser app, the Vite config, and the API |
| `npm test` | Runs the test suite (Node's test runner) |
| `npm run db:generate` / `npm run db:migrate` | Creates a migration from the schema / applies migrations to `DATABASE_URL` |
| `npm run db:seed` | Brings the `components` table in line with the catalog file and prints the counts |

- **Tests** use a fake model, so they need no OpenAI key. Database tests run only when `DATABASE_URL` is set; they share one database, so `npm test` runs test files one at a time.
- **CI** ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs on every pull request and on pushes to `main`: it starts Postgres, then runs install, typecheck, tests (including the database tests), and both builds on Node 24. `main` accepts changes only through pull requests that pass it.

## 10. Current limits and what's next

**Today**

- Each turn is capped at 10 model calls, 20 tool calls and 150,000 tokens; there are no limits yet on message size or request rate.
- The agent's only tools look up components (`list_components`, `get_component`); it cannot render or change anything yet.
- Conversations are lost when the API restarts.
- The sandbox and session menu are placeholders.
- The `components` table is not exposed over HTTP.
- There is no authentication.

**Planned**

- Rendering components in the sandbox, and tools that use them.

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
    Sandbox["Sandbox pane<br/>(draws ui events, sends button clicks)"]
    Client["Agent and actions clients<br/>fetch + SSE reader"]
    Chat --> Client
    Sandbox --> Client
  end

  Edge["Web server<br/>Vite :5173 in dev<br/>nginx :8080 in production"]

  subgraph API ["API (Fastify, Node 24, :3001)"]
    Limits["Request limits<br/>size cap, per-IP rate limit"]
    Routes["HTTP routes<br/>GET /api/health<br/>POST /api/agent/chat<br/>POST /api/actions/run"]
    Loop["Agent loop"]
    Convos["Conversations and their last designs<br/>(in memory)"]
    Tools["Tool registry<br/>list_components, get_component,<br/>list_actions, render_ui"]
    Actions["Action registry<br/>demo_echo, 14 menu actions"]
    LlmPort["AgentLlm port"]
    RepoPort["ComponentRepository port"]
    MenuPort["PosMenu port"]
    OpenAIAdapter["OpenAI adapter"]
    DbAdapter["Drizzle adapter"]
    MenuAdapter["Demo menu adapter<br/>(in memory, reset on start)"]
    Limits --> Routes
    Routes --> Loop
    Routes -- "action clicks, no model call" --> Actions
    Routes -. "remembered design" .-> Convos
    Loop --> Convos
    Loop --> Tools
    Tools -. "action specs, dropdown values" .-> Actions
    Loop --> LlmPort
    Tools --> RepoPort
    Actions --> MenuPort
    LlmPort --> OpenAIAdapter
    RepoPort --> DbAdapter
    MenuPort --> MenuAdapter
  end

  OpenAI["OpenAI<br/>Chat Completions"]
  DB[("Postgres<br/>components table")]
  Redis[("Redis<br/>optional, rate-limit counters")]

  Client -- "POST /api/agent/chat<br/>POST /api/actions/run" --> Edge
  Edge -- "proxies /api" --> Routes
  Edge -. "SSE events, action results" .-> Client
  OpenAIAdapter -- "streaming HTTPS" --> OpenAI
  DbAdapter --> DB
  Limits -. "optional" .-> Redis
  Routes -. "health check" .-> DB
```

- **The browser only talks to its own origin.** The web server serves the app and proxies `/api` to the API, so there is no CORS setup.
- **The API follows ports and adapters.** The agent loop and future features depend on small interfaces (`AgentLlm`, `ComponentRepository`, `PosMenu`). The OpenAI, Drizzle and in-memory demo menu adapters implement them, and [server/index.ts](../server/index.ts) is the one place that wires real adapters in (it passes them to `buildApp` in [server/app.ts](../server/app.ts), which builds the Fastify app and is what tests use). Tests swap in fakes.
- **Types shared by both sides** (request bodies, SSE event shapes, component types) live in [shared/](../shared/), so the browser and the API can't disagree about the wire format.

## 2. Browser app

```
┌──────────────────────────────┬──────────────────────────────┐
│ [ session ▾ ]  (empty)       │                              │
├──────────────────────────────┤                              │
│  agent chat thread           │  action status area          │
│  (user + streamed agent      ├──────────────────────────────┤
│   bubbles, notices, errors,  │  sandbox panel               │
│   action result lines)       │  (latest rendered design)    │
├──────────────────────────────┤                              │
│ [ Message the agent…     ]   │                              │
│               [Send / Stop]  │                              │
└──────────────────────────────┴──────────────────────────────┘
```

- **Chat pane:** the agent's text streams into a bubble, and tool calls, notices, and errors render as small lines in the thread, all in the order they arrive: text that follows a tool line starts a new bubble below it. While a reply streams, **Send** becomes **Stop**, which aborts the request; the API sees the connection close and stops the turn.
- **Conversation identity:** one conversation per page load (a random id). Reloading starts a new one.
- **Sandbox pane:** shows "Designs you ask for appear here." until a `ui` event arrives, then draws that tree and keeps the event's `id`; a newer `ui` event replaces it (and clears the status area), and nothing is saved in the browser. The renderer is in [src/sandbox/](../src/sandbox/): `components.ts` has one function per catalog component (a map typed by `RENDERED_COMPONENTS`, so a missing one fails typecheck), and `render.ts` walks the tree. Tree text goes in only through `textContent` or named attributes, never as HTML; image URLs are re-checked for http(s); a component the browser has no function for draws as a dashed "Unknown component" box. Inputs, checkboxes and selects work as normal form controls; a Button with an `action` prop runs that action (below), and any other button does nothing. `src/sandbox/componentNames.test.ts` fails if the catalog and `RENDERED_COMPONENTS` differ.
- **Action clicks:** clicking a Button that has an `action` first checks the design's fields with the browser's own validation (a required field left empty shows its message and nothing is sent). It then posts `{ conversationId, uiId, action, values }` to `POST /api/actions/run` (§3) through [src/actionsClient.ts](../src/actionsClient.ts). `values` holds every named TextInput, Checkbox and Select of the shown design, keyed by its `name` (Checkboxes as booleans, the rest as strings); password fields are never sent. The result appears in the status area above the design, and a `⚡ <action>: <message>` line is added to the chat. Action buttons are disabled while an action request or a chat turn is in flight, or while a confirm question is shown. If a newer design was drawn before a result came back, the result is not shown in the status area (it belongs to the old design), but the chat line is still added. Clicks never reach the agent and make no model call; network and HTTP failures show as a failed result. For an action that asks first (the three menu deletes), the API answers the click with its question instead of running it (§3). The status area shows the question in place, above the design, with **Yes** and **Cancel**, and no chat line is added yet. **Yes** resends the same request, with the values read for the first click, as `confirmed: true`, and its result shows as above; **Cancel** sends nothing and adds a `⚡ <action>: cancelled` line. A question that comes back after a newer design was drawn or a chat turn started is dropped, and a new design or chat turn clears an unanswered one.
- **Session menu:** a placeholder for now.
- **Stack:** plain TypeScript and DOM APIs, no UI framework; styling with Tailwind. Code is in [src/](../src/): the shell and chat rendering, the agent client, an SSE parser, and the sandbox renderer.

## 3. API

| Part | Role |
|---|---|
| **Routes** ([server/routes/](../server/routes/)) | `GET /api/health` returns `{ ok, db, agent, redis }`: whether Postgres answers, whether an OpenAI key is set, and whether Redis answers (`null` when `REDIS_URL` is not set). `POST /api/agent/chat` runs one agent turn and streams it back as SSE. `POST /api/actions/run` runs the action a sandbox Button click names, with no model call (below) |
| **Agent** ([server/agent/](../server/agent/)) | The tool-use loop (§4), the in-memory conversation store, the tool registry, and the agent's tools (`tools/`): `list_components` lists the catalog by name, category, description and children; `get_component` returns one component's props schema and example props; `list_actions` finds registered actions by area and operation (below); `render_ui` checks a UI tree against the catalog, the registered actions and the current dropdown values and, if valid, sends it to the browser as a `ui` event (§4) |
| **Actions** ([server/actions/](../server/actions/)) | The action registry: named handlers a Button click can run, each with a closed `input_schema` whose properties are all strings or booleans, and optionally an `area` (snake_case, what it works on), an `operation` (`create`, `edit`, `archive`, `delete`, `attach`, `detach` or `other`; both count as `other` when missing), dropdown sources for string inputs (`choices`, each a named `ChoiceSource` that lists current values), and a `confirm` question whose `{input}` placeholders name declared properties. Values are checked against the schema before a handler runs; a handler gets 10 seconds (then its signal is aborted and the result is "took too long"), a throw becomes an `ok: false` result, and result messages are cut to 500 characters. `listChoices` returns a source's current values. `index.ts` registers `demo_echo`, which has no side effects and replies "Demo action received: <text>"; [server/index.ts](../server/index.ts) adds the menu actions after it |
| **Menu actions** ([server/actions/menu/](../server/actions/menu/)) | `createMenuActions(menu)`: fourteen actions over a `PosMenu`. Items: create, update (name, description, category), archive or unarchive, set or clear the image. Modifier groups: attach to and detach from an item, delete. Sizes: add, update (name, SKU), set the price, remove. Categories: create, rename, delete. Their `item`, `size`, `category` and `group` inputs are dropdowns over four shared sources (`menu_items`, `menu_item_sizes` as "Item (Size)", `menu_categories`, `menu_modifier_groups`, archived items included, sorted by folded name) and are resolved by name when the action runs: the exact name first, then a unique match after `foldName`. Prices are typed in dollars (`parsePrice` strips `$` and `,`). In the update actions an empty field stays as it is, and an update with every field empty is refused. A `PosMenuError`, from the menu or from resolving a name, becomes an `ok: false` result with its message. The three deletes (`menu_remove_size`, `menu_delete_category`, `menu_delete_modifier_group`) have a confirm question. Name helpers (`cleanName`, `foldName`, `sizeLabel`) are in [server/text/names.ts](../server/text/names.ts) |
| **UI checks** ([server/ui/](../server/ui/)) | `validateTree.ts`: the `render_ui` checks (§4). `bindings.ts`: finds a tree's named inputs and action Buttons. `checkAction.ts`: whether a click may run an action with the values sent |
| **Ports** ([server/ports/](../server/ports/)) | `AgentLlm`: run one model turn with streaming. `ComponentRepository`: read the component catalog. `PosMenu`: the café menu as a point-of-sale system holds it (categories, modifier groups, items and their sizes, prices as integer minor units), mirroring CapheVietPOS's `MenuStore` at its commit 60764e5 so a live CapheVietPOS adapter can implement it; expected failures reject with a `PosMenuError` (`validation` or `not_found`). `fakes/`: in-memory versions for tests |
| **Adapters** ([server/adapters/](../server/adapters/)) | `openai/`: streaming Chat Completions. `db/`: Drizzle client, schema, migrations, the repository, and the catalog seed. `pos/`: `createInMemoryPosMenu`, the demo café menu (a copy of `fixtures.ts`, CapheVietPOS's placeholder menu) with CapheVietPOS's menu rules, such as refusing a negative price, two categories (or two sizes of one item) whose names differ only in accents, or deleting a category or modifier group an item still uses (§5) |
| **Catalog** ([server/catalog/](../server/catalog/)) | `components.ts`: the predefined UI components, the source of truth for the `components` table. `validate.ts`: the rules every entry follows (§5) |
| **App** ([server/app.ts](../server/app.ts)) | `buildApp` creates the Fastify app: trust proxy, the request limits below, and the routes. `server/index.ts` wires the adapters, the demo menu and the action registry and listens |
| **Config** ([server/config.ts](../server/config.ts)) | The only place the API reads environment variables (§7) |

**Request limits.** All apply to `POST /api/agent/chat` and `POST /api/actions/run` only.

- **Message length (chat):** `MAX_MESSAGE_CHARS` (4000, in [shared/api.ts](../shared/api.ts)) is both the chat textarea's `maxlength` and the route's check; a longer message gets a 400 ("Message is too long (max 4000 characters)."). Malformed JSON gets a 400 on both routes.
- **Body size:** a 32 KB `bodyLimit` on each route; a larger body gets a 413.
- **Rate limit:** `@fastify/rate-limit` allows `AGENT_RATE_LIMIT_PER_MINUTE` requests per client IP per minute on each route (fixed window; IPv6 addresses are grouped by /64). The two routes share the limiter and its settings but are counted separately, so clicking actions does not use up chat requests. Past it the route answers 429 with a `Retry-After` header and "Too many messages. Try again in N seconds." It runs before the body is read.
- **Store:** counters are in memory by default. With `REDIS_URL` set they live in Redis (`ioredis`, keys prefixed `genui-rate-limit:`), so several API instances share them. The limiter fails open: while Redis is not connected or is down, requests pass, with one warning logged per outage.
- **Trust proxy:** the client IP comes from the socket unless `TRUST_PROXY` (number of proxy hops) is set, in which case Fastify reads `X-Forwarded-For`. nginx sets that header and the production `api` uses `TRUST_PROXY=1`, which is safe only because the API's port is not published. Where clients can reach the API directly, leave it off: they could spoof the header and dodge the limit.

**`list_actions`.** It takes two required arguments, each from a fixed list built from the registered actions when the tools are created: `area` (every action's area, `other` for those without one, plus `any`) and `operation` (the operations in use, plus `any`). It returns, as `actions`, up to 10 actions that fit both, in full: name, description, `input_schema`, area, operation, and their `confirm` question and `choices` (input → source) when they have them. When none fit both, it returns the area's actions instead and says so (`match: "area"` rather than `"exact"`). Every other action gets one line in `others` (name, area, operation, and the description cut to 120 characters), so a wrong guess never hides an action. `choices` holds the first 50 current values of each source the returned actions name (with `truncated` when there are more); a source that fails to load is logged and listed empty with an error.

**Action route.** `POST /api/actions/run` takes `{ conversationId, uiId, action, values, confirmed? }` ([shared/api.ts](../shared/api.ts)) and never calls the model.

- **Body checks:** the three ids must be non-empty strings, `values` an object of at most 100 strings or booleans, and `confirmed`, if present, a boolean; otherwise 400.
- **Design check:** the route looks up the design by `conversationId` and `uiId` among the ones the API remembers (§5). If it is gone (after a restart, after eviction, or after five newer designs), it answers 409 "This design is no longer available. Ask the agent to show it again." (`DESIGN_GONE_MESSAGE`). Otherwise `checkActionRequest` requires an enabled Button in that design with this `action`, and every value must belong to a named input of the design and fit it: a string of at most 1000 characters for a TextInput, a boolean for a Checkbox, one of the options (or "") for a Select. If several inputs share a name, a value is accepted when it fits any of them and refused when any of them is a password field. A failed check is a 400 whose message names the input, never the value.
- **Confirmation:** values the action's schema doesn't declare are dropped. If the action has a `confirm` question and the request doesn't say `confirmed: true`, nothing runs: the response is 200 `{ ok: false, message, confirm }`, where `message` and `confirm` are both the question with each `{input}` replaced by its value (`(none)` when empty), cut to 500 characters. The browser asks it and resends with `confirmed: true` (§2).
- **Run:** the registry runs the handler with the declared values; its abort signal fires if the client disconnects. The response is 200 `{ ok, message }`, whether the handler succeeded or not.
- **Logging:** every request that passes the body checks gets one info log line with the conversation id, action, `ok` and `durationMs`, plus `confirmation` (`asked` or `given`) for an action with a confirm question that passed the design check. Submitted values may be personal data and are never logged, and neither is the filled-in question.

**Startup.** The API builds its adapters and registers the routes. In production it first applies database migrations, then seeds the component catalog (§5), and exits with status 1 if either fails. In development both are run by hand (`npm run db:migrate`, then `npm run db:seed`; rerun the seed after pulling catalog changes, §5) and the API starts even when Postgres is down (health then reports `db: false`, and component tool calls fail until it is up). Without an OpenAI key the API still starts; health reports `agent: false` and a chat turn answers with one `error` event naming the missing key.

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
      L-->>B: tool_call, ui { id, tree } and tool_result events
    end
  end
  R-->>B: done, or error
```

- The loop sends the conversation history and the available tools to the model, streams its text to the browser as it arrives, runs any tools the model asks for, and calls the model again with the results. A reply with no tool calls ends the turn.
- Each turn is capped by the constants in [server/agent/guardrails.ts](../server/agent/guardrails.ts): 10 model calls, 20 tool calls, and 150,000 tokens (prompt plus completion, summed over the turn's calls). The last call, and any call after the tool-call or token cap is reached, is sent with tool use switched off (`tool_choice: "none"`), so the model answers with what it has. A tool call past the cap, or a repeat of an earlier call with the same arguments, is not run; the model is told so. If the model still asks for tools once they are off, the turn ends with an `error` event.
- A reply cut off by the output-token limit (`AGENT_MAX_OUTPUT_TOKENS`) is followed by a `notice` event. Every turn ends with one info log line: conversation id, model calls, tool calls, prompt and completion tokens, and why it ended.
- The system prompt lives in [server/agent/systemPrompt.ts](../server/agent/systemPrompt.ts). The OpenAI adapter adds it on each call, so it is never stored in history. It tells the agent what it can and cannot do and gives it a procedure: list components once; if a button should do something, find the action first, before reading components, by calling `list_actions` with the area and operation that fit (`any` when unsure; skipped when an action found earlier in the chat fits, or when no button needs the server), and build the form around the returned inputs and choices; read only the components it uses; build one tree, wiring each Button to a returned action (calling `list_actions` again for one listed under `others`), naming each input after the property it fills, giving an input to each optional property the request implies, and using a Select with a source's values for each dropdown input; call `render_ui` and fix reported problems; then reply briefly, saying when an action asks before it runs. It also says that clicks and what the person types never reach the agent, and never to invent action names. It names the tools but not the catalog's contents, and a test fails if the prompt and the registered tools drift apart.
- The registry checks each call's arguments against the tool's schema before running it. An unknown tool, invalid arguments, or a tool that throws (Postgres down, for example) comes back as an `ok: false` result the model can read; failures are logged.
- SSE event types: `text`, `tool_call`, `tool_result`, `ui` (`{ id, tree }`), `notice`, `done`, `error` (defined in [shared/api.ts](../shared/api.ts)).
- **UI trees.** The agent describes a UI as a tree of catalog components, `{ component, props?, children? }` ([shared/ui.ts](../shared/ui.ts)). `render_ui` runs `validateUiTree` ([server/ui/validateTree.ts](../server/ui/validateTree.ts)) over the whole tree and reports every problem at once (at most 20): malformed nodes, components not in the catalog, props that break the component's `propsSchema`, children on components that take none, and more than 8 levels or 100 nodes. It also checks bindings: two inputs with the same `name`, a Button `action` that is not registered, a required property of an action that no named input fills (for Buttons that aren't disabled), an input of the wrong kind for the property it fills (a boolean needs a Checkbox, a string a TextInput or Select), and a password TextInput bound to an action property. Dropdowns and edit forms are checked too: before validating, `render_ui` loads the current values of each dropdown source that a Button's action names for an input present in the tree (a source that fails to load is logged and left unchecked). An input filling a property with a loaded source must be a Select (any other input gets only that message), and each of its options must be one of the source's values. An enabled Button for an `edit` action that has optional properties is refused when the tree has no input for any of them, since that form could change nothing. If any are found, nothing is shown and the model gets the errors to fix. If none, the tool hands the tree to the browser through `ToolContext.showUi`. The run gives the design a server-generated `id` (a random UUID), remembers it for the conversation (§5), and emits it as a `ui` event `{ id, tree }` just before the tool result. The browser draws it in the sandbox and sends the `id` back with any click on it (§2, §3). Tools have no other way to emit events. Per-component props validators are compiled once per `updatedAt` and cached.
- If the API has forgotten a conversation the browser is continuing (after a restart, for example), the agent sends a `notice` saying so and answers the message on its own.

## 5. Data

| Data | Where | Lifetime |
|---|---|---|
| Conversation history | API memory | Until the API restarts. At most 500 conversations; the least recently used is dropped first |
| Rendered designs | API memory, beside each conversation's history, keyed by `ui` event `id` | The last five per conversation; a sixth evicts the oldest. Lost with the conversation (restart or eviction). The action route checks clicks against them (§3) |
| Demo menu | API memory: one `createInMemoryPosMenu` per API instance, built from [server/adapters/pos/fixtures.ts](../server/adapters/pos/fixtures.ts) (four categories, three modifier groups and seven items, one of them archived; prices in USD) | Reset to the fixtures every time the API starts. Shared by every conversation and everyone using that API instance, so one person's menu actions change what everyone sees; several instances would each have their own |
| UI components | [server/catalog/components.ts](../server/catalog/components.ts), copied to Postgres `components` table by the seed | The file is the source of truth; the table can be dropped and reseeded at any time. Schema changes only through committed Drizzle migrations |

**`components` table:** a catalog of predefined UI components. Columns: `id`, `name` (unique), `description`, `category` (check: `layout`, `text`, `input`, or `display`), `children` (check: `none` or `any`), `props_schema` (JSON Schema), `example_props` (JSON), and timestamps. Rendering lives in browser code keyed by `name`, so no render spec is stored. The API's `ComponentRepository` is read-only (`list`, `get`, `getByName`); only the seed writes rows. The agent reads it through the `list_components` and `get_component` tools; no HTTP route exposes it (§10).

**Catalog and seed.** `server/catalog/components.ts` exports the twelve basic components (`Stack`, `Card`, `Divider`, `Heading`, `Text`, `Button`, `TextInput`, `Checkbox`, `Select`, `Image`, `Badge`, `Alert`). Text content is a prop, so only `Stack` and `Card` take children. `validateCatalog` (Ajv, the shared strict instance in `server/validation/jsonSchema.ts`) checks that every name matches `^[A-Z][A-Za-z0-9]*$` and is unique, the description is non-empty, `propsSchema` is valid JSON Schema with `type: "object"`, `additionalProperties: false`, and a `description` on every property, and every `default` and `exampleProps` is valid against it. `seedComponents(db, catalog)` (`server/adapters/db/seed.ts`) validates first and, on any problem, throws listing them all and writes nothing. Otherwise, in one transaction, it inserts missing entries, updates rows whose fields differ (setting `updated_at`), deletes rows whose name left the catalog, leaves the rest untouched, and returns `{ added, updated, removed, unchanged }`. Running it twice ends in the same state.

- **Development:** `npm run db:seed` after `npm run db:migrate` prints `components: N added, N updated, N removed, N unchanged`. Catalog changes reach Postgres only through the seed, so run it again after pulling them; until then `render_ui` checks against the old rows (for example, it rejects the Button `action` and input `name` props until the seed adds them).
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
  Api -. "rate-limit counters (optional)" .-> Redis[("redis<br/>Redis 8, no persistence")]
  Api -- "HTTPS" --> OpenAI["OpenAI"]
```

- **Images:** the web image builds the app and serves it with nginx. The API image bundles the server with esbuild and ships only production dependencies and the migrations.
- **SSE through nginx:** buffering is off for `/api/` and reads time out after 300 seconds, so events reach the browser as they are written.
- **Ports:** `web` (8080), `db` (5432) and `redis` (6379) are published; the API is reached through nginx and uses `redis` in production. If a host port is taken, remap it in an uncommitted `docker-compose.override.yml`.

## 7. Configuration

| Variable | Default | Used by |
|---|---|---|
| `OPENAI_API_KEY` | none (the agent is off without it) | API |
| `AGENT_MODEL` | `gpt-4.1` | API |
| `AGENT_MAX_OUTPUT_TOKENS` | `2048` (output tokens allowed per model call) | API |
| `DATABASE_URL` | `postgres://genui:genui@localhost:5432/genui` | API, migrations |
| `AGENT_RATE_LIMIT_PER_MINUTE` | `20` (chat requests per IP per minute, and separately action requests) | API |
| `TRUST_PROXY` | off (number of proxy hops to trust; `1` in the production `api`) | API |
| `REDIS_URL` | none (rate-limit counters stay in memory) | API |
| `API_PORT` / `API_HOST` | `3001` / `127.0.0.1` (`0.0.0.0` in containers) | API |
| `LOG_LEVEL` | `info` | API |
| `API_PROXY_TARGET` | `http://localhost:3001` | Vite dev server |

For local development, copy [.env.example](../.env.example) to `.env.local` and set `OPENAI_API_KEY`. The `.env.local` file is ignored by git and kept out of Docker builds.

## 8. Repository layout

One npm package, no monorepo.

```
genui-prototype/
├── src/            browser app: shell, chat rendering, agent and actions clients, SSE parser, sandbox
├── server/         Fastify API
│   ├── routes/     health, chat and action endpoints
│   ├── agent/      agent loop, conversations and their designs, tool registry, tools
│   ├── actions/    action registry, confirm questions, and demo_echo
│   │   └── menu/   the menu actions, their dropdown sources, name and price parsing
│   ├── ui/         UI tree, binding and action-click checks
│   ├── catalog/    component catalog file and its validation
│   ├── text/       comparing menu names (shared by the demo menu and the menu actions)
│   ├── ports/      interfaces the app depends on
│   └── adapters/   OpenAI and Postgres (Drizzle) implementations, migrations, seed
│       └── pos/    the in-memory demo café menu and its fixtures
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
| `npm run db:seed` | Brings the `components` table in line with the catalog file and prints the counts; run it after pulling catalog changes |

- **Tests** use a fake model, so they need no OpenAI key. Database tests run only when `DATABASE_URL` is set; they share one database, so `npm test` runs test files one at a time.
- **CI** ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs on every pull request and on pushes to `main`: it starts Postgres and Redis (so the Redis store tests run), then runs install, typecheck, tests (including the database tests), and both builds on Node 24. `main` accepts changes only through pull requests that pass it.

## 10. Current limits and what's next

**Today**

- Each turn is capped at 10 model calls, 20 tool calls and 150,000 tokens.
- Messages are capped at 4000 characters and request bodies at 32 KB, and the chat and action routes each allow 20 requests per IP per minute by default (§3). The rate limit is per IP, not per user, and it is in memory unless Redis is configured.
- The agent can look up components and render UI trees (`render_ui`), and the sandbox draws the latest one. A Button in it can run a registered backend action with the values of the design's named inputs (§2, §3); clicks and typed values never reach the agent.
- The registered actions are `demo_echo`, which has no side effects, and the fourteen menu actions. Menu actions change only the in-memory demo menu (§5): nothing reaches a real POS, and every change is gone when the API restarts. The agent finds actions with `list_actions` by area and operation, and the three deletes ask in the sandbox before they run.
- Actions run with no authentication: anyone who can reach the API and knows a conversation id and design id can run them, so anyone can change the demo menu, and only actions without lasting effects outside the API are safe to register.
- Menu actions cannot create or edit modifier groups, and generated forms do not show an item's current values.
- Conversations, and the designs remembered for them, are lost when the API restarts; clicking a design the API no longer remembers asks the user to have it shown again.
- The session menu is a placeholder.
- The `components` table is not exposed over HTTP.
- There is no authentication.

**Planned**

- Authentication, before any real action ships.
- A live CapheVietPOS adapter for the `PosMenu` port, behind authentication, so the same menu actions change the café's real menu; nothing built on the port changes.
- Real, side-effecting actions (saving or sending data, for example), registered in `server/actions/` once authentication exists.

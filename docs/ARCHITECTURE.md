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
    Panel["Components panel<br/>(list, preview, delete, restore, revert)"]
    Client["Agent, actions and custom components clients<br/>fetch + SSE reader"]
    Chat --> Client
    Sandbox --> Client
    Panel --> Client
  end

  Edge["Web server<br/>Vite :5173 in dev<br/>nginx :8080 in production"]

  subgraph API ["API (Fastify, Node 24, :3001)"]
    Limits["Request limits<br/>size cap, per-IP rate limit"]
    Routes["HTTP routes<br/>GET /api/health<br/>POST /api/agent/chat<br/>POST /api/actions/run<br/>/api/custom-components"]
    Loop["Agent loop"]
    Convos["Conversations: history and last designs<br/>(in memory)"]
    Tools["Tool registry<br/>list_components, get_component,<br/>list_actions, render_ui,<br/>define_component, delete_component"]
    Expander["Custom component expander<br/>and definition checks"]
    Actions["Action registry<br/>demo_echo, 14 menu actions"]
    LlmPort["AgentLlm port"]
    RepoPort["ComponentRepository port"]
    CustomPort["CustomComponentRepository port"]
    MenuPort["PosMenu port"]
    TracePort["TraceRepository port"]
    OpenAIAdapter["OpenAI adapter"]
    DbAdapter["Drizzle catalog adapter"]
    TracesAdapter["Drizzle traces adapter"]
    MenuAdapter["Demo menu adapter<br/>(in memory, reset on start)"]
    Limits --> Routes
    Routes --> Loop
    Routes -- "action clicks, no model call" --> Actions
    Routes -. "remembered design" .-> Convos
    Routes -- "Components panel" --> CustomPort
    Routes -. "previews" .-> Expander
    Loop --> Convos
    Loop --> TracePort
    Loop --> Tools
    Tools -. "action specs, dropdown values" .-> Actions
    Tools -- "expand before validating" --> Expander
    Loop --> LlmPort
    Tools --> RepoPort
    Tools --> CustomPort
    Actions --> MenuPort
    LlmPort --> OpenAIAdapter
    RepoPort --> DbAdapter
    CustomPort --> DbAdapter
    TracePort --> TracesAdapter
    MenuPort --> MenuAdapter
  end

  OpenAI["OpenAI<br/>Chat Completions"]
  DB[("Postgres genui<br/>components,<br/>custom_components,<br/>custom_component_versions")]
  TracesDB[("Postgres genui_traces<br/>agent_traces")]
  Redis[("Redis<br/>optional, rate-limit counters")]

  Client -- "POST /api/agent/chat<br/>POST /api/actions/run<br/>/api/custom-components" --> Edge
  Edge -- "proxies /api" --> Routes
  Edge -. "SSE events, action results" .-> Client
  OpenAIAdapter -- "streaming HTTPS" --> OpenAI
  DbAdapter --> DB
  TracesAdapter --> TracesDB
  Limits -. "optional" .-> Redis
  Routes -. "health check" .-> DB
  Routes -. "health check" .-> TracesDB

  subgraph Eval ["Eval harness (CLI · §9)"]
    EvalCLI["Eval CLI<br/>npm run eval"]
    CaseFiles["Case files<br/>server/eval/cases/*.json"]
    TraceChecks["Trace checkers<br/>checkTrace"]
    EvalLogFiles["Eval log files<br/>eval-logs/ (gitignored)"]
    EvalFakes["In-memory fakes<br/>catalog · custom · traces · menu"]
    EvalCLI --> CaseFiles
    EvalCLI --> TraceChecks
    EvalCLI --> EvalLogFiles
  end

  EvalCLI -. "runAgent per case<br/>(no Fastify, no SSE)" .-> Loop
  EvalCLI --> OpenAIAdapter
  Loop -. "eval wiring" .-> EvalFakes
  TraceChecks -. "last AgentTrace" .-> EvalFakes
```

- **The browser only talks to its own origin.** The web server serves the app and proxies `/api` to the API, so there is no CORS setup.
- **The API follows ports and adapters.** The agent loop and future features depend on small interfaces (`AgentLlm`, `ComponentRepository`, `CustomComponentRepository`, `PosMenu`, `TraceRepository`). The OpenAI, Drizzle catalog and traces, and in-memory demo menu adapters implement them, and [server/index.ts](../server/index.ts) is the one place that wires real adapters in (it passes them to `buildApp` in [server/app.ts](../server/app.ts), which builds the Fastify app and is what tests use). Tests swap in fakes.
- **Eval runs beside the HTTP API, not through it.** `npm run eval` ([server/eval/cli.ts](../server/eval/cli.ts)) loads committed JSON cases, calls the same agent loop and OpenAI adapter as chat (same model and [system prompt](../server/agent/systemPrompt.ts)), but wires in-memory catalog, custom-component, trace, and menu ports ([server/eval/runner.ts](../server/eval/runner.ts)) so nothing hits Postgres or the browser and it does not write `genui_traces`. After each turn it scores the saved `AgentTrace` with deterministic checks ([server/eval/checks.ts](../server/eval/checks.ts)), writes one JSON file per case under a gitignored `eval-logs/<timestamp>/` directory (the file holds the case prompt, checks, result, and full turn trace), and prints one `pass` or `fail` line per case followed by a `logs` line with the directory's absolute path. `npm run eval -- --repeat N` (1 to 10) runs each case N times: each attempt is logged as `<id>.<k>.json`, its result line ends in `[k/N]`, and after all cases one `rate <id> <passes>/<N>` line per case precedes the `logs` line; a plain run (or `--repeat 1`) is unchanged. Eval needs `OPENAI_API_KEY` and CI does not run it (§9).
- **Types shared by both sides** (request bodies, SSE event shapes, component and custom component types) live in [shared/](../shared/), so the browser and the API can't disagree about the wire format. So do the Markup rules ([shared/markup.ts](../shared/markup.ts)), which the API checks and the browser applies again before drawing (§3).

## 2. Browser app

```
┌──────────────────────────────┬──────────────────────────────┐
│ [ session ▾ ]   [Components] │                              │
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
- **Sandbox pane:** shows "Designs you ask for appear here." until a `ui` event arrives, then draws that tree and keeps the event's `id`; a newer `ui` event replaces it (and clears the status area), and nothing is saved in the browser. The renderer is in [src/sandbox/](../src/sandbox/): `components.ts` has one function per catalog component (a map typed by `RENDERED_COMPONENTS`, so a missing one fails typecheck), and `render.ts` walks the tree. Tree text goes in only through `textContent` or named attributes, never as HTML; image URLs are re-checked for http(s); a component the browser has no function for draws as a dashed "Unknown component" box. Inputs, checkboxes and selects work as normal form controls; a Button with an `action` prop, or a Markup `button` with an `action`, runs that action (below), and any other button does nothing. `src/sandbox/componentNames.test.ts` fails if the catalog and `RENDERED_COMPONENTS` differ.
- **Drawing Markup:** the `Markup` renderer in `components.ts` first passes its `root` through `filterMarkup` ([src/sandbox/markup.ts](../src/sandbox/markup.ts)), which drops anything outside the allowlist by the same `sanitizeMarkup` rules the API checked (§3), so a tree that slipped past the API still can't draw more. It then builds the elements one by one (`createElementNS` inside an `svg`), setting attributes with `setAttribute`, styles with `style.setProperty` and text with `textContent`, inside a wrapper with `contain: content; overflow: hidden`, so nothing in it can cover the chat or the page. Its images load with no referrer, its buttons never submit, an `input` without a `maxlength` gets 1000, and only an enabled `button` with an `action` sends a click.
- **Action clicks:** clicking a button that has an `action` first makes sure every named field of the design can be seen: if one is hidden (by `display`, `visibility` or opacity) or less than 1px wide or tall, nothing is sent and the status area says "This design has a hidden field, so the action was not sent." It then checks the fields with the browser's own validation (a required field left empty shows its message and nothing is sent), and posts `{ conversationId, uiId, action, values }` to `POST /api/actions/run` (§3) through [src/actionsClient.ts](../src/actionsClient.ts). `values` holds every named TextInput, Checkbox and Select of the shown design, and every named Markup `input` and `select`, keyed by its `name` (checkboxes as booleans, the rest as strings); password fields are never sent. The result appears in the status area above the design, and a `⚡ <action>: <message>` line is added to the chat. Action buttons are disabled while an action request or a chat turn is in flight, or while a confirm question is shown. If a newer design was drawn before a result came back, the result is not shown in the status area (it belongs to the old design), but the chat line is still added. Clicks never reach the agent and make no model call; network and HTTP failures show as a failed result. For an action that asks first (the three menu deletes), the API answers the click with its question instead of running it (§3). The status area shows the question in place, above the design, with **Yes** and **Cancel**, and no chat line is added yet. **Yes** resends the same request, with the values read for the first click, as `confirmed: true`, and its result shows as above; **Cancel** sends nothing and adds a `⚡ <action>: cancelled` line. A question that comes back after a newer design was drawn or a chat turn started is dropped, and a new design or chat turn clears an unanswered one.
- **Components panel:** the **Components** button in the chat header opens a panel over the chat ([src/customComponentsPanel.ts](../src/customComponentsPanel.ts)), which talks to the custom components route (§3) through [src/customComponentsClient.ts](../src/customComponentsClient.ts) and loads the list each time it opens. It lists every custom component with its description, version and last update, deleted ones under "Deleted" with **Restore**. Selecting one shows its version and category, a preview (the component with its example props, expanded by the API and drawn by the sandbox renderer in the panel, with its action buttons stripped so they send nothing) or the problems that kept it from expanding, and its versions, newest first, each earlier one with **Revert to version N**. Its header has **Delete**, or **Restore** when it is deleted. After each change the panel reloads the list and the selection, and a failure (such as the route's limit or "unavailable" message) shows at its top. It never creates or edits a definition; only the agent does.
- **Session menu:** a placeholder for now.
- **Stack:** plain TypeScript and DOM APIs, no UI framework; styling with Tailwind. Code is in [src/](../src/): the shell and chat rendering, the agent client, an SSE parser, the sandbox renderer, and the Components panel and its client.

## 3. API

| Part | Role |
|---|---|
| **Routes** ([server/routes/](../server/routes/)) | `GET /api/health` returns `{ ok, db, agent, redis, traces }`: whether the catalog Postgres answers, whether an OpenAI key is set, whether Redis answers (`null` when `REDIS_URL` is not set), and whether the traces Postgres answers (`traces` is `false` when the ping is omitted, fails, or throws). `POST /api/agent/chat` runs one agent turn and streams it back as SSE. `POST /api/actions/run` runs the action a sandbox button click names, with no model call (below). `/api/custom-components` serves the Components panel (below): list every custom component, read one with a preview, soft-delete, restore and revert to an earlier version |
| **Agent** ([server/agent/](../server/agent/)) | The tool-use loop (§4), the in-memory conversation store (history and remembered designs only), the tool registry, and the agent's tools (`tools/`): `list_components` lists the catalog by name, category, description and children, then up to 40 custom components (`custom: true`, optional `search` on name or description); `get_component` returns one catalog or custom component's props schema and example props (a custom one also returns its `version` and `template`); `list_actions` finds registered actions by area and operation (below); `define_component` checks a definition and saves the next version; `delete_component` soft-deletes one; `render_ui` expands custom components, then checks the expanded tree against the catalog, the registered actions and the current dropdown values and, if valid, sends only that expanded tree to the browser as a `ui` event (§4) |
| **Custom components** ([server/customComponents/](../server/customComponents/)) | `definition.ts`: `validateDefinition` checks a definition's shape, template, Markup and action names before save. `expand.ts`: `expandTree` substitutes custom components for their current version's template (with instance props and a `{$children: true}` slot), reports deleted components, loops and nesting limits, and rewrites validator paths so errors name the custom component and version (§4) |
| **Custom components route** ([server/routes/customComponents.ts](../server/routes/customComponents.ts)) | `GET /api/custom-components` lists every component (deleted included), up to 500. `GET /api/custom-components/:name` returns the current version, every version's metadata, and a preview (`preview` is the expanded example tree, or `previewErrors` lists why it wouldn't expand). `DELETE /api/custom-components/:name` soft-deletes; `POST .../restore` undoes that; `POST .../revert` with `{ version }` saves a copy of that version as the new current one. Names must match `^[A-Z][A-Za-z0-9]*$`. A repository failure answers 503 with a fixed message; refusals (limit, deleted, and the like) use 404 or 409 with the repository's message |
| **Actions** ([server/actions/](../server/actions/)) | The action registry: named handlers a Button click can run, each with a closed `input_schema` whose properties are all strings or booleans, and optionally an `area` (snake_case, what it works on), an `operation` (`create`, `edit`, `archive`, `delete`, `attach`, `detach` or `other`; both count as `other` when missing), dropdown sources for string inputs (`choices`, each a named `ChoiceSource` that lists current values), and a `confirm` question whose `{input}` placeholders name declared properties. Values are checked against the schema before a handler runs; a handler gets 10 seconds (then its signal is aborted and the result is "took too long"), a throw becomes an `ok: false` result, and result messages are cut to 500 characters. `listChoices` returns a source's current values. `index.ts` registers `demo_echo`, which has no side effects and replies "Demo action received: <text>"; [server/index.ts](../server/index.ts) adds the menu actions after it |
| **Menu actions** ([server/actions/menu/](../server/actions/menu/)) | `createMenuActions(menu)`: fourteen actions over a `PosMenu`. Items: create, update (name, description, category), archive or unarchive, set or clear the image. Modifier groups: attach to and detach from an item, delete. Sizes: add, update (name, SKU), set the price, remove. Categories: create, rename, delete. Their `item`, `size`, `category` and `group` inputs are dropdowns over four shared sources (`menu_items`, `menu_item_sizes` as "Item (Size)", `menu_categories`, `menu_modifier_groups`, archived items included, sorted by folded name) and are resolved by name when the action runs: the exact name first, then a unique match after `foldName`. Prices are typed in dollars (`parsePrice` strips `$` and `,`). In the update actions an empty field stays as it is, and an update with every field empty is refused. A `PosMenuError`, from the menu or from resolving a name, becomes an `ok: false` result with its message. The three deletes (`menu_remove_size`, `menu_delete_category`, `menu_delete_modifier_group`) have a confirm question. Name helpers (`cleanName`, `foldName`, `sizeLabel`) are in [server/text/names.ts](../server/text/names.ts) |
| **UI checks** ([server/ui/](../server/ui/)) | `validateTree.ts`: the `render_ui` checks (§4). `bindings.ts`: finds a tree's named inputs and action Buttons. `checkAction.ts`: whether a click may run an action with the values sent |
| **Ports** ([server/ports/](../server/ports/)) | `AgentLlm`: run one model turn with streaming. `ComponentRepository`: read the component catalog. `CustomComponentRepository`: list, read, save, soft-delete and restore custom component definitions with versions (§5). `TraceRepository`: persist turn traces (§5). `PosMenu`: the café menu as a point-of-sale system holds it (categories, modifier groups, items and their sizes, prices as integer minor units), mirroring CapheVietPOS's `MenuStore` at its commit 60764e5 so a live CapheVietPOS adapter can implement it; expected failures reject with a `PosMenuError` (`validation` or `not_found`). `fakes/`: in-memory versions for tests |
| **Adapters** ([server/adapters/](../server/adapters/)) | `openai/`: streaming Chat Completions. `db/`: Drizzle client, schema, migrations, the catalog repository, `DrizzleCustomComponentRepository`, and the catalog seed. `traces/`: Drizzle client, schema, migrations, and `DrizzleTraceRepository` for database `genui_traces` (§5). `pos/`: `createInMemoryPosMenu`, the demo café menu (a copy of `fixtures.ts`, CapheVietPOS's placeholder menu) with CapheVietPOS's menu rules, such as refusing a negative price, two categories (or two sizes of one item) whose names differ only in accents, or deleting a category or modifier group an item still uses (§5) |
| **Catalog** ([server/catalog/](../server/catalog/)) | `components.ts`: the predefined UI components, the source of truth for the `components` table, including `Markup` (allowlisted HTML and SVG as a JSON tree; only valid inside custom component templates, checked in [shared/markup.ts](../shared/markup.ts)). `validate.ts`: the rules every entry follows (§5) |
| **App** ([server/app.ts](../server/app.ts)) | `buildApp` creates the Fastify app: trust proxy, the request limits below, and the routes. `server/index.ts` wires the adapters, the demo menu and the action registry and listens |
| **Config** ([server/config.ts](../server/config.ts)) | The only place the API reads environment variables (§7) |

**Request limits.** The chat and action routes below share one limiter; `/api/custom-components` uses the same per-IP limit but is counted separately from chat and from actions.

- **Message length (chat):** `MAX_MESSAGE_CHARS` (4000, in [shared/api.ts](../shared/api.ts)) is both the chat textarea's `maxlength` and the route's check; a longer message gets a 400 ("Message is too long (max 4000 characters)."). Malformed JSON gets a 400 on both routes.
- **Body size:** a 32 KB `bodyLimit` on each chat and action route; a larger body gets a 413. Custom component routes allow 1 KB (enough for `{ "version": n }` on revert).
- **Rate limit:** `@fastify/rate-limit` allows `AGENT_RATE_LIMIT_PER_MINUTE` requests per client IP per minute on each route (fixed window; IPv6 addresses are grouped by /64). The two routes share the limiter and its settings but are counted separately, so clicking actions does not use up chat requests. Past it the route answers 429 with a `Retry-After` header and "Too many messages. Try again in N seconds." It runs before the body is read.
- **Store:** counters are in memory by default. With `REDIS_URL` set they live in Redis (`ioredis`, keys prefixed `genui-rate-limit:`), so several API instances share them. The limiter fails open: while Redis is not connected or is down, requests pass, with one warning logged per outage.
- **Trust proxy:** the client IP comes from the socket unless `TRUST_PROXY` (number of proxy hops) is set, in which case Fastify reads `X-Forwarded-For`. nginx sets that header and the production `api` uses `TRUST_PROXY=1`, which is safe only because the API's port is not published. Where clients can reach the API directly, leave it off: they could spoof the header and dodge the limit.

**`list_actions`.** It takes two required arguments, each from a fixed list built from the registered actions when the tools are created: `area` (every action's area, `other` for those without one, plus `any`) and `operation` (the operations in use, plus `any`). It returns, as `actions`, up to 10 actions that fit both, in full: name, description, `input_schema`, area, operation, and their `confirm` question and `choices` (input → source) when they have them. When none fit both, it returns the area's actions instead and says so (`match: "area"` rather than `"exact"`), with a fixed `note` (`AREA_FALLBACK_NOTE`, placed before the lists) telling the model to use one only if its description does what the button should do and otherwise to render the button without an action. Every other action gets one line in `others` (name, area, operation, and the description cut to 120 characters), so a wrong guess never hides an action. `choices` holds the first 50 current values of each source the returned actions name (with `truncated` when there are more); a source that fails to load is logged and listed empty with an error.

**Action route.** `POST /api/actions/run` takes `{ conversationId, uiId, action, values, confirmed? }` ([shared/api.ts](../shared/api.ts)) and never calls the model.

- **Body checks:** the three ids must be non-empty strings, `values` an object of at most 100 strings or booleans, and `confirmed`, if present, a boolean; otherwise 400.
- **Design check:** the route looks up the design by `conversationId` and `uiId` among the ones the API remembers (§5). If it is gone (after a restart, after eviction, or after five newer designs), it answers 409 "This design is no longer available. Ask the agent to show it again." (`DESIGN_GONE_MESSAGE`). Otherwise `checkActionRequest` requires an enabled Button or Markup `button` in that design with this `action`, and every value must belong to a named input of the design and fit it: a string of at most 1000 characters for a TextInput or Markup `input`, a boolean for a Checkbox or Markup checkbox `input`, one of the options (or "") for a Select or Markup `select`. If several inputs share a name, a value is accepted when it fits any of them and refused when any of them is a password field. A failed check is a 400 whose message names the input, never the value.
- **Confirmation:** values the action's schema doesn't declare are dropped. If the action has a `confirm` question and the request doesn't say `confirmed: true`, nothing runs: the response is 200 `{ ok: false, message, confirm }`, where `message` and `confirm` are both the question with each `{input}` replaced by its value (`(none)` when empty), cut to 500 characters. The browser asks it and resends with `confirmed: true` (§2).
- **Run:** the registry runs the handler with the declared values; its abort signal fires if the client disconnects. The response is 200 `{ ok, message }`, whether the handler succeeded or not.
- **Logging:** every request that passes the body checks gets one info log line with the conversation id, action, `ok` and `durationMs`, plus `confirmation` (`asked` or `given`) for an action with a confirm question that passed the design check. Submitted values may be personal data and are never logged, and neither is the filled-in question.

**Startup.** The API builds its adapters and registers the routes. In production it first applies catalog database migrations, then seeds the component catalog (§5), then ensures database `genui_traces` exists and applies traces migrations, and exits with status 1 if any step fails. In development catalog and traces setup are run by hand (`npm run db:migrate`, `npm run db:migrate:traces`, then `npm run db:seed`; rerun the seed after pulling catalog changes, §5) and the API starts even when Postgres is down (health then reports `db: false` and/or `traces: false`, and component tool calls or trace saves fail until the relevant database is up). Without an OpenAI key the API still starts; health reports `agent: false` and a chat turn answers with one `error` event naming the missing key.

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
- A reply cut off by the output-token limit (`AGENT_MAX_OUTPUT_TOKENS`) is followed by a `notice` event. When the turn finishes, the loop builds one turn trace ([server/agent/trace.ts](../server/agent/trace.ts)): completions (each model call's text, truncation, usage, and tool outcomes), skip reasons when a tool call was not run, optional UI trees when `render_ui` succeeded, and any terminal `error` event message. In a `finally` block it calls `TraceRepository.save` with that trace; a failed save logs a warning (conversation id and error only, never payload, `userText`, completions, or trees) and the turn still completes. Every turn also ends with one counts-only info log line (`agent turn finished`): conversation id, model calls, tool calls, prompt and completion tokens, and why it ended.
- The system prompt lives in [server/agent/systemPrompt.ts](../server/agent/systemPrompt.ts). The OpenAI adapter adds it on each call, so it is never stored in history. It tells the agent what it can and cannot do and gives it a procedure: list components once; if a button should do something, find the action first, before reading components, by calling `list_actions` with the area and operation that fit (`any` when unsure; skipped when an action found earlier in the chat fits, or when no button needs the server), and build the form around the returned inputs and choices; choose components in order of preference (catalog, then existing custom components from `list_components`, then a new one from `define_component`, and only then a template that uses `Markup` for what nothing else can draw); read only the components it uses with `get_component`; build one tree, wiring each Button to a returned action whose description does what the button should do (calling `list_actions` again for one listed under `others`), or, when none fits, still rendering the Button without an action and saying that clicking it won't do anything yet (also when the person names an action `list_actions` didn't return, or only a demo or other unrelated action came back: a stand-in action is never wired, and a missing action is no reason to ask a question or to skip `render_ui`), naming each input after the property it fills, giving an input to each optional property the request implies, and using a Select with a source's values for each dropdown input; call `render_ui` and fix reported problems; then reply briefly, saying when an action asks before it runs or when a custom component was created, updated or deleted. Custom-component rules cover templates, versioning, `delete_component` only when asked, and that template buttons may use only actions `list_actions` returned. It also says that clicks and what the person types never reach the agent, and never to invent action or component names. Problems that `render_ui` or `define_component` report are not failures: the agent fixes them and calls the tool again in the same turn, and the prompt forbids replies promising to try again; only other tool failures are reported as what it couldn't do. It names the tools but not the catalog's contents, and a test fails if the prompt and the registered tools drift apart.
- The registry checks each call's arguments against the tool's schema before running it. An unknown tool, invalid arguments, or a tool that throws (Postgres down, for example) comes back as an `ok: false` result the model can read; failures are logged.
- SSE event types: `text`, `tool_call`, `tool_result`, `ui` (`{ id, tree }`), `notice`, `done`, `error` (defined in [shared/api.ts](../shared/api.ts)).
- **UI trees.** The agent describes a UI as a tree of catalog and custom components, `{ component, props?, children? }` ([shared/ui.ts](../shared/ui.ts)). `render_ui` first refuses a top-level `Markup` node and checks the agent's tree against the unexpanded size limits (a custom node counts as one). It then runs `expandTree` ([server/customComponents/expand.ts](../server/customComponents/expand.ts)): each custom component becomes its current version's template with instance props and children in `{$children: true}` slots; deleted components, unknown names, loops and more than three levels of custom nesting are reported with paths that name the component and version when the problem is in a template (for example `tree.children.0 (MenuItemCard v3) template.children.1…`). The expanded tree is validated with `validateUiTree` ([server/ui/validateTree.ts](../server/ui/validateTree.ts)) under the expanded limits of 400 nodes and 24 levels (Markup elements don't count toward those), and reports every problem at once (at most 20): malformed nodes, components not in the catalog, props that break the component's `propsSchema`, children on components that take none, and depth or node count past those expanded limits. In each check (`expandTree` for custom components, `validateUiTree` for catalog ones), the first props problem per component ends with `(call get_component <Name> for its props)`. The agent's own tree is also refused past 100 nodes or 8 levels before expanding. It also checks bindings: two inputs with the same `name`, a Button or Markup `button` `action` that is not registered, a required property of an action that no named input fills (for buttons that aren't disabled), an input of the wrong kind for the property it fills (a boolean needs a Checkbox or Markup checkbox `input`, a string a TextInput, Select or Markup `input`/`select`), and a password TextInput bound to an action property. Dropdowns and edit forms are checked too: before validating, `render_ui` loads the current values of each dropdown source that a Button's action names for an input present in the expanded tree (a source that fails to load is logged and left unchecked). An input filling a property with a loaded source must be a Select or Markup `select` (any other input gets only that message), and each of its options must be one of the source's values. An enabled Button for an `edit` action that has optional properties is refused when the tree has no input for any of them, since that form could change nothing. If any are found, nothing is shown and the model gets the errors to fix. If none, the tool hands the **expanded** tree to the browser through `ToolContext.showUi`. The run gives the design a server-generated `id` (a random UUID), remembers that expanded tree for the conversation (§5), and emits it as a `ui` event `{ id, tree }` just before the tool result. The browser draws it in the sandbox and sends the `id` back with any click on it (§2, §3). Tools have no other way to emit events. An empty children array on a component whose children is none is removed before the check, and the tree that is shown or saved has no children key. Per-component props validators are compiled once per `updatedAt` and cached.
- **Custom component definitions.** `define_component` runs `validateDefinition` ([server/customComponents/definition.ts](../server/customComponents/definition.ts)) on the whole definition: name `^[A-Z][A-Za-z0-9]*$` (not a catalog name; unique ignoring case), description at most 300 characters with no control characters, category and `children` like the catalog, `propsSchema` and `exampleProps` like a catalog entry, a template of at most 40 nodes and 6 levels with at most one `{$children: true}` slot when `children` is `any`, Markup only inside the template with the same allowlist and size limits as §3 (200 elements and 12 levels on each Markup root), template buttons whose `action` is registered, no string that looks like a `{{...}}` placeholder (it would be shown as written; use `{"$prop": "<name>"}`), and every declared prop used by a `{"$prop": "<name>"}` in the template. The serialized definition must fit in 8,000 characters. The template is expanded and checked like a design under the 400-node and 24-level limits. On success the repository saves the next version; on failure the model gets every problem and nothing is written. `delete_component` soft-deletes by exact name.
- If the API has forgotten a conversation the browser is continuing (after a restart, for example), the agent sends a `notice` saying so and answers the message on its own.

## 5. Data

| Data | Where | Lifetime |
|---|---|---|
| Conversation history | API memory | Until the API restarts. At most 500 conversations; the least recently used is dropped first |
| Rendered designs | API memory, beside each conversation's history, keyed by `ui` event `id` | The last five per conversation; a sixth evicts the oldest. Lost with the conversation (restart or eviction). The action route checks clicks against them (§3) |
| Turn traces | Postgres database `genui_traces`, table `agent_traces`, via `TraceRepository` | The last five per conversation; a sixth evicts the oldest. Survive API restart and in-memory conversation eviction or `resetConversation` (§4). One `AgentTrace` per turn; not exposed over HTTP |
| Demo menu | API memory: one `createInMemoryPosMenu` per API instance, built from [server/adapters/pos/fixtures.ts](../server/adapters/pos/fixtures.ts) (four categories, three modifier groups and seven items, one of them archived; prices in USD) | Reset to the fixtures every time the API starts. Shared by every conversation and everyone using that API instance, so one person's menu actions change what everyone sees; several instances would each have their own |
| UI components | [server/catalog/components.ts](../server/catalog/components.ts), copied to Postgres `components` table by the seed | The file is the source of truth; the table can be dropped and reseeded at any time. Schema changes only through committed Drizzle migrations |
| Custom components | Postgres `custom_components` and `custom_component_versions` tables via `CustomComponentRepository` | Global to the deployment: every conversation and the Components panel share them. At most 200 not deleted and 500 counting deleted ones; at most 20 versions per name. The seed never reads or writes these tables |

**`components` table:** a catalog of predefined UI components. Columns: `id`, `name` (unique), `description`, `category` (check: `layout`, `text`, `input`, or `display`), `children` (check: `none` or `any`), `props_schema` (JSON Schema), `example_props` (JSON), and timestamps. Rendering lives in browser code keyed by `name`, so no render spec is stored. The API's `ComponentRepository` is read-only (`list`, `get`, `getByName`); only the seed writes rows. The agent reads it through the `list_components` and `get_component` tools; no HTTP route exposes it (§10).

**Custom component tables.** `custom_components` holds one row per name (`id`, `name` with a unique index on `lower(name)`, `current_version`, `deleted_at`, timestamps). `custom_component_versions` holds every saved definition (`component_id`, `version`, `description`, `category`, `children`, `props_schema`, `example_props`, `template`, `created_at`); rows are only ever inserted. A save adds the next version and updates `current_version`; a delete sets `deleted_at` without removing versions; restore clears `deleted_at` when under the active limit; revert copies an earlier version's fields into a new save. Limits and refusals are enforced in [server/ports/CustomComponentRepository.ts](../server/ports/CustomComponentRepository.ts) and the Drizzle adapter. Types and limits are in [shared/customComponents.ts](../shared/customComponents.ts).

**Catalog and seed.** `server/catalog/components.ts` exports the thirteen predefined components: the twelve basic ones (`Stack`, `Card`, `Divider`, `Heading`, `Text`, `Button`, `TextInput`, `Checkbox`, `Select`, `Image`, `Badge`, `Alert`) and `Markup` (§3). Text content is a prop, so only `Stack` and `Card` take children. `validateCatalog` (Ajv, the shared strict instance in `server/validation/jsonSchema.ts`) checks that every name matches `^[A-Z][A-Za-z0-9]*$` and is unique, the description is non-empty, `propsSchema` is valid JSON Schema with `type: "object"`, `additionalProperties: false`, and a `description` on every property, and every `default` and `exampleProps` is valid against it. `seedComponents(db, catalog)` (`server/adapters/db/seed.ts`) validates first and, on any problem, throws listing them all and writes nothing. Otherwise, in one transaction, it inserts missing entries, updates rows whose fields differ (setting `updated_at`), deletes rows whose name left the catalog, leaves the rest untouched, and returns `{ added, updated, removed, unchanged }`. Running it twice ends in the same state. It touches only the `components` table.

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
| `DATABASE_URL` | `postgres://genui:genui@localhost:5432/genui` | API, catalog migrations |
| `TRACE_DATABASE_URL` | `postgres://genui:genui@localhost:5432/genui_traces` | API, traces migrations; must name a different database than `DATABASE_URL` |
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
├── src/            browser app: shell, chat rendering, agent and actions clients, custom components client and panel, SSE parser, sandbox
├── server/         Fastify API
│   ├── routes/     health, chat, action and custom-component endpoints
│   ├── agent/      agent loop, conversations, remembered designs, tool registry, tools
│   ├── eval/       `server/eval/`: case files, trace checkers, runner, log writer, and CLI (`npm run eval`)
│   ├── actions/    action registry, confirm questions, and demo_echo
│   │   └── menu/   the menu actions, their dropdown sources, name and price parsing
│   ├── customComponents/  definition checks and expanding custom components into catalog trees
│   ├── ui/         UI tree, binding and action-click checks
│   ├── catalog/    component catalog file and its validation
│   ├── text/       comparing menu names (shared by the demo menu and the menu actions)
│   ├── ports/      interfaces the app depends on
│   └── adapters/   OpenAI, catalog Postgres (Drizzle), traces Postgres, seed
│       ├── traces/ traces Drizzle client, schema, migrations, repository
│       └── pos/    the in-memory demo café menu and its fixtures
├── shared/         types, wire formats, custom component and Markup rules shared by both sides
├── docs/           this file
├── .github/        CI workflow
├── Dockerfile      web image (build + nginx)
├── Dockerfile.api  API image (esbuild bundle + production dependencies)
└── docker-compose.yml, nginx.conf, vite.config.ts, drizzle.config.ts, drizzle.traces.config.ts, tsconfig*.json
```

Runtime dependencies are the API's: `fastify`, `openai`, `drizzle-orm`, `pg`, and `ajv` with `ajv-formats`. Everything else (Vite, TypeScript, Tailwind, tsx, esbuild, drizzle-kit) is a development dependency.

## 9. Build, test, and CI

| Command | Does |
|---|---|
| `npm run dev` | Runs the web dev server and the API together |
| `npm run build` / `npm run build:api` | Builds the browser app to `dist/` / bundles the API to `server-dist/` |
| `npm run typecheck` | Type-checks the browser app, the Vite config, and the API |
| `npm test` | Runs the test suite (Node's test runner) |
| `npm run db:generate` / `npm run db:migrate` | Creates a migration from the catalog schema / applies catalog migrations to `DATABASE_URL` |
| `npm run db:generate:traces` / `npm run db:migrate:traces` | Creates a migration from the traces schema / ensures `genui_traces` exists and applies traces migrations to `TRACE_DATABASE_URL` |
| `npm run db:seed` | Brings the `components` table in line with the catalog file and prints the counts; run it after pulling catalog changes |
| `npm run eval` | Runs every committed eval case through the live agent (OpenAI, same model and system prompt as chat); writes one JSON file per case under a gitignored `eval-logs` directory (prompt, checks, result, and full turn trace) and prints one result line per case plus the log directory path; add `-- --repeat N` (1 to 10) to run each case N times, with `<id>.<k>.json` logs, `[k/N]` result lines, and a `rate <id> <passes>/<N>` line per case (a plain run is unchanged); needs `OPENAI_API_KEY`, does not write `genui_traces`, and is not run in CI |

- **Tests** use a fake model, so they need no OpenAI key. Catalog database tests run only when `DATABASE_URL` is set; traces database tests run only when `TRACE_DATABASE_URL` is set. They share one database each, so `npm test` runs test files one at a time.
- **CI** ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs on every pull request and on pushes to `main`: it starts Postgres (creating database `genui_traces` on the same instance) and Redis (so the Redis store tests run), sets `TRACE_DATABASE_URL`, runs catalog and traces migrations, then install, typecheck, tests (including the database tests), and both builds on Node 24. It does not run `npm run eval`. `main` accepts changes only through pull requests that pass it.

## 10. Current limits and what's next

**Today**

- Each turn is capped at 10 model calls, 20 tool calls and 150,000 tokens.
- Messages are capped at 4000 characters and request bodies at 32 KB, and the chat and action routes each allow 20 requests per IP per minute by default (§3). The rate limit is per IP, not per user, and it is in memory unless Redis is configured.
- The agent can look up catalog and custom components and render UI trees (`render_ui`), and the sandbox draws the latest expanded tree. A Button or Markup `button` in it can run a registered backend action with the values of the design's named inputs (§2, §3); clicks and typed values never reach the agent. The agent can define and delete custom components with `define_component` and `delete_component`; the Components panel lists them, previews each version, and can delete, restore or revert, but not edit definitions.
- Custom components are global: at most 200 active, 500 including deleted, and 20 versions per name; a definition's name, description (300 characters), serialized size (8,000 characters), template (40 nodes, 6 levels, three levels of custom nesting), and each Markup root (200 elements, 12 levels) are capped, and an expanded design is capped at 400 nodes and 24 levels (§4, §5).
- The registered actions are `demo_echo`, which has no side effects, and the fourteen menu actions. Menu actions change only the in-memory demo menu (§5): nothing reaches a real POS, and every change is gone when the API restarts. The agent finds actions with `list_actions` by area and operation, and the three deletes ask in the sandbox before they run.
- Actions run with no authentication: anyone who can reach the API and knows a conversation id and design id can run them, so anyone can change the demo menu, and only actions without lasting effects outside the API are safe to register.
- Menu actions cannot create or edit modifier groups, and generated forms do not show an item's current values.
- Conversations, and the designs remembered for them, are lost when the API restarts; clicking a design the API no longer remembers asks the user to have it shown again. Turn traces (last five per conversation) persist in `genui_traces` across restart; there is still no HTTP route for them.
- The session menu is a placeholder.
- The `components` catalog table is not exposed over HTTP; custom components are exposed only through `/api/custom-components` for the panel, not for editing definitions.
- There is no authentication.
- **`npm run eval`** (§9) runs 20 committed live cases against OpenAI and scores each turn's saved `AgentTrace` with deterministic checks, which can read drawn text (`uiText`) and Markup tags (`uiMarkupTag`): `archive-item` (archive/restore menu item form); `catalog-layout` (stacked card with catalog components); `closed-alert` (alert with no button); `custom-props-shown` (custom component with props shown); `define-and-use-custom` (define then show custom component); `delete-custom` (define then delete custom component); `echo-form` (form with `demo_echo` action); `export-pdf` (button with no matching action); `framed-note` (custom component with children); `invented-action-name` (button must not use an invented action); `markup-bold-tag` (Markup bold tag); `markup-prop-text` (Markup text from a prop); `menu-create-item` (café menu create form); `menu-delete-category` (menu category delete with confirm); `mockup-no-action` (mockup must not call `list_actions`); `newsletter-no-action` (signup button with no action); `off-topic-refusal` (non-UI question, no design tools); `price-tag` (Markup price label); `simple-heading` (catalog heading via `render_ui`); `sms-no-action` (SMS button with no action). The CLI writes one JSON log file per case (or per attempt with `--repeat`) under a gitignored `eval-logs` directory; the runner uses in-memory ports and does not write `genui_traces`.

**Planned**

- Authentication, before any real action ships.
- A live CapheVietPOS adapter for the `PosMenu` port, behind authentication, so the same menu actions change the café's real menu; nothing built on the port changes.
- Real, side-effecting actions (saving or sending data, for example), registered in `server/actions/` once authentication exists.

# Architecture

genui-prototype is a UI generator. A host agent (the CapheViet POS agent is planned) offers its model one tool, `generate_ui` (`GENERATE_UI_TOOL` in [shared/generate.ts](../shared/generate.ts)), and calls `POST /api/generate` with a plain-language prompt. The API makes one **OpenAI** JSON-mode call (plus at most two repairs), checks the design it gets back, and answers with a validated UI tree and short notes for the person. A **Vite + TypeScript** preview page draws the tree in a sandbox and lets a person click its buttons. The API is **Fastify** and owns a **Postgres** database accessed through **Drizzle**.

Related: [README](../README.md)

## Index

1. [System overview](#1-system-overview)
2. [Preview page](#2-preview-page)
3. [API](#3-api)
4. [A generation, end to end](#4-a-generation-end-to-end)
5. [Data](#5-data)
6. [Environments](#6-environments)
7. [Configuration](#7-configuration)
8. [Repository layout](#8-repository-layout)
9. [Build, test, and CI](#9-build-test-and-ci)
10. [Current limits and what's next](#10-current-limits-and-whats-next)
11. [History](#11-history)

## 1. System overview

```mermaid
flowchart LR
  Host["CapheViet POS agent (planned)"] --> Routes["API routes"]
  Preview["Preview page, sandbox and Components panel"] --> Routes
  Routes --> Gen["Generator"]
  Routes --> Designs["Design store"]
  Gen --> Checks["UI checks and custom component expander"]
  Gen --> Actions["Action registry and demo menu"]
  Gen --> OpenAI["OpenAI (one JSON call, up to 2 repairs)"]
  Routes --> Actions
  Checks --> DB[("Postgres genui")]
  Eval["Eval CLI"] --> Gen
```

- **The browser only talks to its own origin.** The web server serves the preview page and proxies `/api` to the API, so there is no CORS setup.
- **The API follows ports and adapters.** The generator and the routes depend on small interfaces (`ComponentLlm`, `ComponentRepository`, `CustomComponentRepository`, `PosMenu`). The OpenAI, Drizzle and in-memory demo menu adapters implement them, and [server/index.ts](../server/index.ts) is the one place that wires real adapters in (it passes them to `buildApp` in [server/app.ts](../server/app.ts), which builds the Fastify app and is what tests use). Tests swap in fakes.
- **Eval runs beside the HTTP API, not through it.** `npm run eval` ([server/eval/cli.ts](../server/eval/cli.ts)) loads committed JSON cases and calls `generateComponent` directly with the OpenAI adapter (same model and [prompt](../server/generate/prompt.ts) as the API), with in-memory catalog, custom-component and menu ports ([server/eval/runner.ts](../server/eval/runner.ts)), so nothing touches Postgres or the browser (§9).
- **Types shared by both sides** (request and response bodies, component and custom component types, the `generate_ui` tool definition) live in [shared/](../shared/), so the browser and the API can't disagree about the wire format. So do the Markup rules ([shared/markup.ts](../shared/markup.ts)), which the API checks and the browser applies again before drawing (§3).

## 2. Preview page

```
┌──────────────────────────────────────────────────────────────┐
│ Describe a UI                                   [Components] │
├──────────────────────────────────────────────────────────────┤
│                                                 [ a prompt ] │
│ Replaced by a newer design.                                  │
│ [ older design, controls disabled ]                          │
│ notes                                                        │
│ reply: "Done!", a failure or a confirm question              │
│                                             [ newer prompt ] │
│ [ newest design, live ]                                      │
│ notes, or the error                                          │
├──────────────────────────────────────────────────────────────┤
│ [ prompt box                                 ]  [ Generate ] │
└──────────────────────────────────────────────────────────────┘
```

- **Layout:** one column ([src/main.ts](../src/main.ts)): a header with the title and the **Components** button, a scrolling transcript, and the composer pinned at the bottom. The transcript code is in [src/chat.ts](../src/chat.ts). Nothing is saved in the browser, so a reload clears the transcript.
- **Prompt and Generate:** the prompt box takes at most `MAX_PROMPT_CHARS` (4000, in [shared/generate.ts](../shared/generate.ts)) characters; Enter sends and Shift+Enter adds a new line. Sending clears the box, adds the prompt to the transcript as text, and adds a reply that shows "Generating…" while [src/generateClient.ts](../src/generateClient.ts) posts it to `POST /api/generate`. **Generate** is disabled until the answer comes back. Network and HTTP failures resolve to an error message, so there is always something to show.
- **Transcript:** shows "Designs you ask for appear here." until the first prompt. Each reply becomes the design with its `notes` directly below, or a red box when the design still had problems after its tries or the request failed. The transcript scrolls to the newest prompt. Each design keeps its own `id` and sends it back as `designId` with its action clicks. Only the newest design is live: a newer design disables every control in the older ones, drops an unanswered confirm question, and labels each older one "Replaced by a newer design." An error reply replaces nothing.
- **Renderer:** [src/sandbox/](../src/sandbox/) draws each design. `components.ts` has one function per catalog component (a map typed by `RENDERED_COMPONENTS`, so a missing one fails typecheck), and `render.ts` walks the tree and gives each renderer its tree path (`tree.children.0`); every drawn control and action button carries it in `data-path`, and every Card in `data-card`, Markup elements counted on the received `root` before filtering (`tree.children.0.props.root.children.1`), so the paths match the API's. Tree text goes in only through `textContent` or named attributes, never as HTML; image URLs are re-checked for http(s); a component the browser has no function for draws as a dashed "Unknown component" box. Inputs, checkboxes and selects work as normal form controls; a Button with an `action` prop, or a Markup `button` with an `action`, runs that action (below), and any other button does nothing. `src/sandbox/componentNames.test.ts` fails if the catalog and `RENDERED_COMPONENTS` differ.
- **Drawing Markup:** the `Markup` renderer in `components.ts` first passes its `root` through `filterMarkup` ([src/sandbox/markup.ts](../src/sandbox/markup.ts)), which drops anything outside the allowlist by the same `sanitizeMarkup` rules the API checked (§3), so a tree that slipped past the API still can't draw more. It then builds the elements one by one (`createElementNS` inside an `svg`), setting attributes with `setAttribute`, styles with `style.setProperty` and text with `textContent`, inside a wrapper with `contain: content; overflow: hidden`, so nothing in it can cover the page. Its images load with no referrer, its buttons never submit, an `input` without a `maxlength` gets 1000, and only an enabled `button` with an `action` sends a click.
- **Action clicks:** a click reads fields only inside its own design's element, because designs in one page share tree paths. It first makes sure every named field the button sends can be seen: if one is hidden (by `display`, `visibility` or opacity) or less than 1px wide or tall, nothing is sent and the design's reply says "This design has a hidden field, so the action was not sent." It then checks those fields with the browser's own validation (a required field left empty shows its message and nothing is sent), and posts `{ designId, action, values }` to `POST /api/actions/run` (§3) through [src/actionsClient.ts](../src/actionsClient.ts). `values` holds the named TextInput, Checkbox and Select fields and Markup `input` and `select` fields the clicked button sends (the ones inside its nearest Card, nested Cards included, or all of the design's when it has no Card; the same rule the API applies, `sendsInput` in [shared/formScope.ts](../shared/formScope.ts)), keyed by its `name` (checkboxes as booleans, the rest as strings); password fields are never sent. The result appears in the design's reply, below its notes, in place of the one before. A design's action buttons are disabled while its action request is in flight or its confirm question is shown, and the newest design's while a generation runs. A result that comes back after a newer design was drawn still shows under its own design. Network and HTTP failures show as a failed result. For an action that asks first (the three menu deletes), the API answers the click with its question instead of running it (§3). The reply shows the question, with **Yes** and **Cancel**; **Yes** resends the same request, with the values read for the first click, as `confirmed: true`; **Cancel** sends nothing and leaves the form usable. A question that comes back after a newer design was drawn is dropped.
- **Used forms:** `ok: true` shows a green reply, "Done!" and the action's message, and locks the used form. `lockScope(tree, buttonPath, stale)` in [src/lockScope.ts](../src/lockScope.ts) picks the part: the clicked button's nearest Card when `stale` (§3) names nothing other than that Card, otherwise the whole design (`"tree"`), as it does for a button outside every Card. Locked controls are disabled, dimmed and lose `data-action`, so nothing turns them back on and clicking them sends nothing. A locked Card shows a Done badge, a fully locked design a Done label. When only a Card locked and the design still has working buttons, the reply adds "The other forms here still work."; when the whole design locked because a dropdown outside the clicked Card went stale, it adds "The other forms here are out of date now, so ask again for a fresh one." A failed result, a hidden-field refusal or **Cancel** locks nothing, so the person can fix the form and retry. The lock lives only in the page: the API still runs a repeated request.
- **Components panel:** the **Components** button in the header opens a panel over the transcript ([src/customComponentsPanel.ts](../src/customComponentsPanel.ts)), which talks to the custom components route (§3) through [src/customComponentsClient.ts](../src/customComponentsClient.ts) and loads the list each time it opens. It lists every custom component with its description, version and last update, deleted ones under "Deleted" with **Restore**. Selecting one shows its version and category, a preview (the component with its example props, expanded by the API and drawn by the sandbox renderer in the panel, with its action buttons stripped so they send nothing) or the problems that kept it from expanding, and its versions, newest first, each earlier one with **Revert to version N**. Its header has **Delete**, or **Restore** when it is deleted. After each change the panel reloads the list and the selection, and a failure (such as the route's limit or "unavailable" message) shows at its top. The page never creates or edits a definition: custom components are read-only building blocks here.
- **Stack:** plain TypeScript and DOM APIs, no UI framework; styling with Tailwind. Code is in [src/](../src/): the shell, the chat transcript, the generate and actions clients, the sandbox renderer, and the Components panel and its client.

## 3. API

| Part | Role |
|---|---|
| **Routes** ([server/routes/](../server/routes/)) | `GET /api/health` returns `{ ok, db, agent }`: whether Postgres answers and whether an OpenAI key is set. `POST /api/generate` designs a UI from a prompt (below). `POST /api/actions/run` runs the action a sandbox button click names, with no model call (below). `/api/custom-components` serves the Components panel: list every custom component, read one with a preview, soft-delete, restore and revert to an earlier version |
| **Generator** ([server/generate/](../server/generate/)) | `generate.ts`: `generateComponent(prompt, deps)`, one JSON-mode model call plus at most two repairs (§4). `context.ts`: the catalog, Markup rules, registered actions, dropdown values and listed custom components as messages. `prompt.ts`: the system prompt and the repair messages. `checkDesign.ts`: `checkDesign`, which every design passes before it is returned (§4) |
| **Design store** ([server/designs.ts](../server/designs.ts)) | `createDesignStore({ max })`: designs by id, in memory; past `max` (500 in `buildApp`) the oldest is dropped. The generate route remembers each successful design; the action route reads it |
| **Custom components** ([server/customComponents/](../server/customComponents/)) | `definition.ts`: `validateDefinition` checks a definition's shape, template, Markup and action names before save. `expand.ts`: `expandTree` substitutes custom components for their current version's template (with instance props and a `{$children: true}` slot), repeats a `{$each: <array prop>, as}` entry once per item (at most 100; `{$item}` inside `as` is the item or one of its fields, allowed in a children array of a template node or Markup element, one level only), reports deleted components, loops and nesting limits, and rewrites validator paths so errors name the custom component and version (§4) |
| **Custom components route** ([server/routes/customComponents.ts](../server/routes/customComponents.ts)) | `GET /api/custom-components` lists every component (deleted included), up to 500. `GET /api/custom-components/:name` returns the current version, every version's metadata, and a preview (`preview` is the expanded example tree, or `previewErrors` lists why it wouldn't expand). `DELETE /api/custom-components/:name` soft-deletes; `POST .../restore` undoes that; `POST .../revert` with `{ version }` saves a copy of that version as the new current one. Names must match `^[A-Z][A-Za-z0-9]*$`. A repository failure answers 503 with a fixed message; refusals (limit, deleted, and the like) use 404 or 409 with the repository's message |
| **Actions** ([server/actions/](../server/actions/)) | The action registry: named handlers a Button click can run, each with a closed `input_schema` whose properties are all strings or booleans, and optionally an `area` (snake_case, what it works on), an `operation` (`create`, `edit`, `archive`, `delete`, `attach`, `detach` or `other`; both count as `other` when missing), dropdown sources for string inputs (`choices`, each a named `ChoiceSource` that lists current values), and a `confirm` question whose `{input}` placeholders name declared properties. Values are checked against the schema before a handler runs; a handler gets 10 seconds (then its signal is aborted and the result is "took too long"), a throw becomes an `ok: false` result, and result messages are cut to 500 characters. `listChoices` returns a source's current values. `index.ts` registers `demo_echo`, which has no side effects and replies "Demo action received: <text>"; [server/index.ts](../server/index.ts) adds the menu actions after it |
| **Menu actions** ([server/actions/menu/](../server/actions/menu/)) | `createMenuActions(menu)`: fourteen actions over a `PosMenu`. Items: create, update (name, description, category), archive or unarchive, set or clear the image. Modifier groups: attach to and detach from an item, delete. Sizes: add, update (name, SKU), set the price, remove. Categories: create, rename, delete. Their `item`, `size`, `category` and `group` inputs are dropdowns over four shared sources (`menu_items`, `menu_item_sizes` as "Item (Size)", `menu_categories`, `menu_modifier_groups`, archived items included, sorted by folded name) and are resolved by name when the action runs: the exact name first, then a unique match after `foldName`. Prices are typed in dollars (`parsePrice` strips `$` and `,`). In the update actions an empty field stays as it is, and an update with every field empty is refused. A `PosMenuError`, from the menu or from resolving a name, becomes an `ok: false` result with its message. The three deletes (`menu_remove_size`, `menu_delete_category`, `menu_delete_modifier_group`) have a confirm question. Name helpers (`cleanName`, `foldName`, `sizeLabel`) are in [server/text/names.ts](../server/text/names.ts) |
| **UI checks** ([server/ui/](../server/ui/)) | `validateTree.ts`: the tree checks `checkDesign` runs (§4). `bindings.ts`: finds a tree's named inputs and action Buttons, each with its nearest Card. [shared/formScope.ts](../shared/formScope.ts) decides form scope (`nearestCard`, `sendsInput`). `checkAction.ts`: whether a click may run an action with the values sent. `staleScopes.ts`: which scopes of a design hold a dropdown that can now send a value its source no longer offers |
| **Ports** ([server/ports/](../server/ports/)) | `ComponentLlm`: one JSON-answering model call with no tools. `ComponentRepository`: read the component catalog. `CustomComponentRepository`: list, read, save, soft-delete and restore custom component definitions with versions (§5); the generator only reads it. `PosMenu`: the café menu as a point-of-sale system holds it (categories, modifier groups, items and their sizes, prices as integer minor units), mirroring CapheVietPOS's `MenuStore` at its commit 60764e5 so a live CapheVietPOS adapter can implement it; expected failures reject with a `PosMenuError` (`validation` or `not_found`). `fakes/`: in-memory versions for tests and eval |
| **Adapters** ([server/adapters/](../server/adapters/)) | `openai/`: `createOpenAIComponentLlm`, one Chat Completions call with `response_format: json_object`. `db/`: Drizzle client, schema, migrations, the catalog repository, `DrizzleCustomComponentRepository`, and the catalog seed. `pos/`: `createInMemoryPosMenu`, the demo café menu (a copy of `fixtures.ts`, CapheVietPOS's placeholder menu) with CapheVietPOS's menu rules, such as refusing a negative price, two categories (or two sizes of one item) whose names differ only in accents, or deleting a category or modifier group an item still uses (§5) |
| **Catalog** ([server/catalog/](../server/catalog/)) | `components.ts`: the predefined UI components, the source of truth for the `components` table, including `Markup` (allowlisted HTML and SVG as a JSON tree; valid in designs and in custom component templates, checked in [shared/markup.ts](../shared/markup.ts)). `validate.ts`: the rules every entry follows (§5) |
| **App** ([server/app.ts](../server/app.ts)) | `buildApp` creates the Fastify app: trust proxy, the rate limiter, and the routes. `server/index.ts` wires the adapters, the demo menu and the action registry and listens |
| **Config** ([server/config.ts](../server/config.ts)) | The only place the API reads environment variables (§7) |

**Generate route.** `POST /api/generate` takes `{ prompt }` ([shared/generate.ts](../shared/generate.ts)) and answers with a `GenerateResponse`.

- **Body checks:** the body must be a JSON object with a non-empty `prompt` (trimmed) of at most 4000 characters; otherwise 400. Bodies over 32 KB get a 413.
- **Not configured:** without an OpenAI key (or the catalog repository) it answers 503 "The generator is not configured: set OPENAI_API_KEY."
- **Success:** 200 `{ ok: true, id, tree, notes, attempts }`. `id` is a random UUID under which the checked, expanded tree is remembered in the design store; `notes` is the model's text for the person, trimmed and cut to 500 characters, possibly empty; `attempts` is the number of model calls (1 to 3).
- **Design still wrong:** 422 `{ ok: false, error, problems, attempts }` with the problems from the last attempt (at most 20), after three model calls.
- **Failures:** a failed model call is 502 "The model request failed."; an unreadable custom component repository is 503 "Custom components are unavailable." A generation is cut off after `GENERATE_TIMEOUT_MS` (90 seconds) and when the client disconnects; an aborted request gets no answer.
- **Logging:** one info line per generation with the design id, `ok`, attempts, problem count, prompt and completion tokens, and `durationMs`. The prompt, the design and the notes may hold personal data and are never logged.

**Request limits.**

- **Body size:** a 32 KB `bodyLimit` on the generate and action routes; a larger body gets a 413. Custom component routes allow 1 KB (enough for `{ "version": n }` on revert). Malformed JSON gets a 400.
- **Rate limit:** `@fastify/rate-limit` allows `AGENT_RATE_LIMIT_PER_MINUTE` requests per client IP per minute on each of the generate, action and custom components routes (fixed window; IPv6 clients are grouped by /64). The routes share the settings but are counted separately. Past it the route answers 429 with a `Retry-After` header and "Too many messages. Try again in N seconds." It runs before the body is read.
- **Store:** counters live in process memory, so each API instance counts on its own.
- **Trust proxy:** the client IP comes from the socket unless `TRUST_PROXY` (number of proxy hops) is set, in which case Fastify reads `X-Forwarded-For`. nginx sets that header and the production `api` uses `TRUST_PROXY=1`, which is safe only because the API's port is not published. Where clients can reach the API directly, leave it off: they could spoof the header and dodge the limit.

**Action route.** `POST /api/actions/run` takes `{ designId, action, values, confirmed? }` ([shared/api.ts](../shared/api.ts)) and never calls the model.

- **Body checks:** `designId` and `action` must be non-empty strings, `values` an object of at most 100 strings or booleans, and `confirmed`, if present, a boolean; otherwise 400.
- **Design check:** the route looks up the design by `designId` in the design store (§5). If it is gone (after a restart, or after 500 newer designs), it answers 409 "This design is no longer available. Generate it again." (`DESIGN_GONE_MESSAGE`). Otherwise `checkActionRequest` requires an enabled Button or Markup `button` in that design with this `action`, and every value must belong to a named input that button sends and fit it (a button sends everything inside its nearest Card, Cards nested inside it included, or the whole design when it has no Card; with several buttons for the action, the first whose scope takes every value is used): a string of at most 1000 characters for a TextInput or Markup `input`, a boolean for a Checkbox or Markup checkbox `input`, one of the options (or "") for a Select or Markup `select`. If several inputs in a scope share a name, a value is accepted when it fits any of them and refused when any of them is a password field. A name no scope has is refused with `This design has no input named "<name>" next to a "<action>" button.` (without "next to…" when the button is outside every Card). A failed check is a 400 whose message names the input, never the value.
- **Confirmation:** values the action's schema doesn't declare are dropped. If the action has a `confirm` question and the request doesn't say `confirmed: true`, nothing runs: the response is 200 `{ ok: false, message, confirm }`, where `message` and `confirm` are both the question with each `{input}` replaced by its value (`(none)` when empty), cut to 500 characters. The caller asks it and resends with `confirmed: true` (§2).
- **Run:** the registry runs the handler with the declared values; its abort signal fires if the client disconnects. The response is 200 `{ ok, message }`, whether the handler succeeded or not.
- **Stale scopes:** after a run with `ok: true`, the answer also has `stale` ([server/ui/staleScopes.ts](../server/ui/staleScopes.ts)): the scopes of the design holding a dropdown that can now send a value its source no longer offers. A Select or Markup `select` is bound to a source when an enabled button that sends it runs an action whose `choices` name it; each bound source is listed once with `listChoices` after the run. A disabled Select with a preset `value` can send only that value, any other Select any non-empty option, and a Markup `select` any of its options. A scope is the Select's nearest Card path (`"tree.children.1"`) or `"tree"` outside every Card; `[]` means none. A source that fails to list is logged (its name, never values) and makes every scope bound to it stale; the action's result is still returned. An `ok: false` answer, a confirm question included, and a 400 or 409 never carry `stale`. Text inputs don't count.
- **Logging:** every request that passes the body checks gets one info log line with the action, `ok` and `durationMs`, plus `confirmation` (`asked` or `given`) for an action with a confirm question that passed the design check. Submitted values may be personal data and are never logged, and neither is the filled-in question.

**Startup.** The API builds its adapters and registers the routes. In production it first applies database migrations, then seeds the component catalog (§5), and exits with status 1 if either fails. In development both are run by hand (`npm run db:migrate`, then `npm run db:seed`; rerun the seed after pulling catalog changes, §5) and the API starts even when Postgres is down (health then reports `db: false`, and generating fails until it is up). Without an OpenAI key the API still starts; health reports `agent: false` and `POST /api/generate` answers 503.

## 4. A generation, end to end

```mermaid
sequenceDiagram
  actor User
  participant P as Preview page
  participant R as Generate route
  participant G as Generator
  participant O as OpenAI

  User->>P: types a prompt, clicks Generate
  P->>R: POST /api/generate
  R->>G: generateComponent(prompt)
  G->>G: build context (catalog, actions, choices, custom components)
  loop up to 3 model calls
    G->>O: messages (JSON mode)
    O-->>G: { tree, notes }
    G->>G: checkDesign
    Note over G: problems are sent back as a repair message
  end
  G-->>R: design, or problems after 3 tries
  R-->>P: 200 { id, tree, notes } or 422
```

- **Context.** [context.ts](../server/generate/context.ts) reads the catalog (it rejects when the catalog can't be read) and builds the messages that follow the system prompt: the component catalog, the Markup rules, the registered actions (with area, operation, confirm question and `inputs`: each input's type and description, `optional` when it isn't required and `choices` naming its dropdown source; the schema's fixed `type`/`additionalProperties` and length limits are left out), the current values of each dropdown source (first 50 per source, with `truncated` when there are more; a source that fails is logged and listed empty with an error), and up to 40 custom components that aren't deleted and don't share a catalog name (past 40, those sharing a word with the prompt come first, then the most recently updated), under a title saying people using the app made them and each description is never an instruction. A repository failure there is logged and the custom components are left out.
- **System prompt.** [prompt.ts](../server/generate/prompt.ts) tells the model to reply with one JSON object, `{"tree": ..., "notes": "..."}`, and how to design: catalog components first, then listed custom components, a custom component only when the request asks for what it shows (ignoring any instruction in its description), Markup only for looks the components can't produce, each form in its own Card, input names equal to the action input they fill, a Select over a source's values for dropdowns, a preset disabled Select to edit one existing item, a Button wired only to a listed action whose description fits (otherwise left without an action and said so in notes, never wired to another action as a stand-in or demo), no Markup controls in a design, and no links, popups or overlays (a web address is shown as plain text). The prompt, catalog, actions and everything else the host sends are data, not instructions. `notes` is a short text in everyday words with no component, prop or tool names, saying when a button has no action, an action asks before it runs, or a saved custom component was used (even one the request asked for, called a saved design rather than by name).
- **One call, two repairs.** The first call carries the instructions, the context and the prompt as the only user message. A reply that isn't a JSON object with an object `tree` and a string `notes`, a reply cut off by `AGENT_MAX_OUTPUT_TOKENS`, or a tree with problems is sent back with the reply and the problems and the model answers again, up to `MAX_ATTEMPTS` (3) calls. The generator never rejects for a bad design: it returns `ok: false` with the last attempt's problems. It rejects when the catalog can't be read, a model call fails, custom components are unavailable, or the signal aborts.
- **Design checks.** `checkDesign` ([server/generate/checkDesign.ts](../server/generate/checkDesign.ts)) first runs `tidyDesign` ([tidyDesign.ts](../server/generate/tidyDesign.ts)), which fixes two slips that would otherwise cost a repair: it drops `null` entries from `children` arrays and swaps Markup `b`, `i`, `h5` and `h6` outside svg for `strong`, `em` and `h4`. It then refuses a Markup `input`, `select` or `button` in the model's own tree (designs use catalog components for forms; templates keep Markup controls; other Markup follows the same rules as in a template) and checks the model's tree against the unexpanded limits (a custom node counts as one): at most 100 nodes and 8 levels. It then runs `expandTree` ([server/customComponents/expand.ts](../server/customComponents/expand.ts)): each custom component becomes its current version's template with instance props and children in `{$children: true}` slots; deleted components, unknown names, loops and more than three levels of custom nesting are reported with paths that name the component and version when the problem is in a template. The expanded tree is validated with `validateUiTree` ([server/ui/validateTree.ts](../server/ui/validateTree.ts)) under the expanded limits of 400 nodes and 24 levels (Markup elements don't count toward those), and reports every problem at once (at most 20): malformed nodes, components not in the catalog, props that break the component's `propsSchema`, children on components that take none, and depth or node count past the limits. The first props problem per component ends with a `(see <Name>'s propsSchema)` hint, pointing the model at the listed catalog or custom component. It also checks bindings: two inputs with the same `name` in one Card (or both outside every Card), or in different Cards that one button would send together; a Button or Markup `button` `action` that is not registered; a required property of an action that no named input fills (for each button that isn't disabled, among the inputs it sends); an input of the wrong kind for the property it fills (a boolean needs a Checkbox or Markup checkbox `input`, a string a TextInput, Select or Markup `input`/`select`); and a password TextInput bound to an action property. Dropdowns and edit forms are checked too: `checkDesign` loads the current values of each dropdown source that a Button's action names for an input present in the expanded tree (a source that fails to load is logged and left unchecked). An input filling a property with a loaded source must be a Select or Markup `select`, and each of its options must be one of the source's values. A Select's optional `value` must be one of its options, and a `disabled` Select needs a `value`. An enabled Button for an `edit` action that has optional properties is refused when the inputs it sends include none of them, since that form could change nothing. When the design is valid, the **expanded** tree is what the route returns and remembers; an empty children array on a component whose children is none is removed first. Per-component props validators are compiled once per `updatedAt` and cached.

- **Custom component definitions.** `validateDefinition` ([server/customComponents/definition.ts](../server/customComponents/definition.ts)) checks a whole definition: name `^[A-Z][A-Za-z0-9]*$` (not a catalog name; unique ignoring case), description at most 300 characters with no control characters, category and `children` like the catalog, `propsSchema` and `exampleProps` like a catalog entry, a template of at most 40 nodes and 6 levels with at most one `{$children: true}` slot when `children` is `any`, Markup only inside the template with the same allowlist and size limits as §3 (200 elements and 12 levels on each Markup root), template buttons whose `action` is registered, no string that looks like a `{{...}}` placeholder, and every declared prop used by a `{"$prop": "<name>"}` in the template. The serialized definition must fit in 8,000 characters. The template is expanded and checked like a design under the 400-node and 24-level limits. The generator does not write definitions: they reach Postgres only through the repository, and the eval runner uses `validateDefinition` to check the custom components a case seeds.

## 5. Data

| Data | Where | Lifetime |
|---|---|---|
| Generated designs | API memory, in the design store, keyed by the `id` the generate route returned | The newest 500; one more evicts the oldest. Lost when the API restarts. The action route checks clicks against them (§3) |
| Demo menu | API memory: one `createInMemoryPosMenu` per API instance, built from [server/adapters/pos/fixtures.ts](../server/adapters/pos/fixtures.ts) (four categories, three modifier groups and seven items, one of them archived; prices in USD) | Reset to the fixtures every time the API starts. Shared by every design and everyone using that API instance, so one person's menu actions change what everyone sees; several instances would each have their own |
| UI components | [server/catalog/components.ts](../server/catalog/components.ts), copied to Postgres `components` table by the seed | The file is the source of truth; the table can be dropped and reseeded at any time. Schema changes only through committed Drizzle migrations |
| Custom components | Postgres `custom_components` and `custom_component_versions` tables via `CustomComponentRepository` | Read-only building blocks: the generator lists them to the model and expands them, and the Components panel can delete, restore and revert them, but nothing creates or edits a definition over HTTP. At most 200 not deleted and 500 counting deleted ones; at most 20 versions per name. The seed never reads or writes these tables |

**`components` table:** a catalog of predefined UI components. Columns: `id`, `name` (unique), `description`, `category` (check: `layout`, `text`, `input`, or `display`), `children` (check: `none` or `any`), `props_schema` (JSON Schema), `example_props` (JSON), and timestamps. Rendering lives in browser code keyed by `name`, so no render spec is stored. The API's `ComponentRepository` is read-only (`list`, `get`, `getByName`); only the seed writes rows. The generator reads it for its context and checks; no HTTP route exposes it (§10).

**Custom component tables.** `custom_components` holds one row per name (`id`, `name` with a unique index on `lower(name)`, `current_version`, `deleted_at`, timestamps). `custom_component_versions` holds every saved definition (`component_id`, `version`, `description`, `category`, `children`, `props_schema`, `example_props`, `template`, `created_at`); rows are only ever inserted. A save adds the next version and updates `current_version`; a delete sets `deleted_at` without removing versions; restore clears `deleted_at` when under the active limit; revert copies an earlier version's fields into a new save. Limits and refusals are enforced in [server/ports/CustomComponentRepository.ts](../server/ports/CustomComponentRepository.ts) and the Drizzle adapter. Types and limits are in [shared/customComponents.ts](../shared/customComponents.ts).

**Catalog and seed.** `server/catalog/components.ts` exports the thirteen predefined components: the twelve basic ones (`Stack`, `Card`, `Divider`, `Heading`, `Text`, `Button`, `TextInput`, `Checkbox`, `Select`, `Image`, `Badge`, `Alert`) and `Markup` (§3). Text content is a prop, so only `Stack` and `Card` take children. `validateCatalog` (Ajv, the shared strict instance in `server/validation/jsonSchema.ts`) checks that every name matches `^[A-Z][A-Za-z0-9]*$` and is unique, the description is non-empty, `propsSchema` is valid JSON Schema with `type: "object"`, `additionalProperties: false`, and a `description` on every property, and every `default` and `exampleProps` is valid against it. `seedComponents(db, catalog)` (`server/adapters/db/seed.ts`) validates first and, on any problem, throws listing them all and writes nothing. Otherwise, in one transaction, it inserts missing entries, updates rows whose fields differ (setting `updated_at`), deletes rows whose name left the catalog, leaves the rest untouched, and returns `{ added, updated, removed, unchanged }`. Running it twice ends in the same state. It touches only the `components` table.

- **Development:** `npm run db:seed` after `npm run db:migrate` prints `components: N added, N updated, N removed, N unchanged`. Catalog changes reach Postgres only through the seed, so run it again after pulling them; until then the generator checks against the old rows (for example, it rejects the Button `action` and input `name` props until the seed adds them).
- **Production:** the API seeds right after migrating on start, logs the same counts, and exits with status 1 if the seed fails. The catalog is bundled into the API, so the image needs no extra files.

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
- **Generate timeout:** reads from the API time out after 120 seconds in nginx, longer than the 90-second generation cap.
- **Ports:** `web` (8080) and `db` (5432) are published; the API is reached through nginx. If a host port is taken, remap it in an uncommitted `docker-compose.override.yml`.

## 7. Configuration

| Variable | Default | Used by |
|---|---|---|
| `OPENAI_API_KEY` | none (the generator is off without it) | API |
| `AGENT_MODEL` | `gpt-4.1` | API |
| `AGENT_MAX_OUTPUT_TOKENS` | `4096` (output tokens allowed per model call) | API |
| `DATABASE_URL` | `postgres://genui:genui@localhost:5432/genui` | API, migrations |
| `AGENT_RATE_LIMIT_PER_MINUTE` | `20` (requests per IP per minute, counted separately on the generate, action and custom components routes) | API |
| `TRUST_PROXY` | off (number of proxy hops to trust; `1` in the production `api`) | API |
| `API_PORT` / `API_HOST` | `3001` / `127.0.0.1` (`0.0.0.0` in containers) | API |
| `LOG_LEVEL` | `info` | API |
| `API_PROXY_TARGET` | `http://localhost:3001` | Vite dev server |

For local development, copy [.env.example](../.env.example) to `.env.local` and set `OPENAI_API_KEY`. The `.env.local` file is ignored by git and kept out of Docker builds.

## 8. Repository layout

One npm package, no monorepo.

```
genui-prototype/
├── src/            preview page: shell, chat transcript, generate, actions and custom components clients, Components panel, sandbox
├── server/         Fastify API
│   ├── routes/     health, generate, action and custom-component endpoints
│   ├── generate/   generator, its prompt and context, and the design checks
│   ├── designs.ts  the in-memory design store
│   ├── eval/       case files, checks, runner, log writer, and CLI (`npm run eval`)
│   ├── actions/    action registry, confirm questions, and demo_echo
│   │   └── menu/   the menu actions, their dropdown sources, name and price parsing
│   ├── customComponents/  definition checks and expanding custom components into catalog trees
│   ├── ui/         UI tree, binding and action-click checks
│   ├── catalog/    component catalog file and its validation
│   ├── text/       comparing menu names (shared by the demo menu and the menu actions)
│   ├── ports/      interfaces the app depends on
│   └── adapters/   OpenAI, Postgres (Drizzle) and seed
│       └── pos/    the in-memory demo café menu and its fixtures
├── shared/         types, wire formats, GENERATE_UI_TOOL, custom component and Markup rules shared by both sides
├── docs/           this file
├── .github/        CI workflow
├── Dockerfile      web image (build + nginx)
├── Dockerfile.api  API image (esbuild bundle + production dependencies)
└── docker-compose.yml, nginx.conf, vite.config.ts, drizzle.config.ts, tsconfig*.json
```

Runtime dependencies are the API's: `fastify`, `@fastify/rate-limit`, `openai`, `drizzle-orm`, `pg`, and `ajv` with `ajv-formats`. Everything else (Vite, TypeScript, Tailwind, tsx, esbuild, drizzle-kit) is a development dependency.

## 9. Build, test, and CI

| Command | Does |
|---|---|
| `npm run dev` | Runs the web dev server and the API together |
| `npm run build` / `npm run build:api` | Builds the preview page to `dist/` / bundles the API to `server-dist/` |
| `npm run typecheck` | Type-checks the preview page, the Vite config, and the API |
| `npm test` | Runs the test suite (Node's test runner) |
| `npm run db:generate` / `npm run db:migrate` | Creates a migration from the schema / applies migrations to `DATABASE_URL` |
| `npm run db:seed` | Brings the `components` table in line with the catalog file and prints the counts; run it after pulling catalog changes |
| `npm run eval` | Runs every committed eval case through the generator (OpenAI, same model and prompt as the API); writes one JSON file per case under a gitignored `eval-logs` directory and prints one result line per case, a `first-try` line and the log directory path; add `-- --repeat N` (1 to 10) to run each case N times, with `<id>.<k>.json` logs, `[k/N]` result lines, and a `rate <id> <passes>/<N>` line per case (a plain run is unchanged); add `-- --case <id>`, once per case, to run only those cases (an unknown id is refused before any model call); needs `OPENAI_API_KEY` and is not run in CI |

- **Tests** use a fake model, so they need no OpenAI key. Database tests run only when `DATABASE_URL` is set. They share one database, so `npm test` runs test files one at a time.
- **CI** ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs on every pull request and on pushes to `main`: it starts Postgres, then install, typecheck, tests (including the database tests), and both builds on Node 24. It does not run `npm run eval`. `main` accepts changes only through pull requests that pass it.

## 10. Current limits and what's next

**Today**

- A prompt is at most 4000 characters and request bodies at 32 KB. The generate, action and custom components routes each allow 20 requests per IP per minute by default (§3). The rate limit is per IP, not per user, and it is in memory, so each API instance counts on its own.
- A generation is one model call plus at most two repairs, cut off after 90 seconds. A design that still has problems after three calls is not shown (422).
- Designs, and the ids that name them, are lost when the API restarts, and past 500 newer designs the oldest is dropped; clicking a design the API no longer remembers asks the person to generate it again.
- A Button or Markup `button` in a design can run a registered backend action with the values of the design's named inputs (§2, §3); clicks and typed values never reach the model. The Components panel lists custom components, previews each version, and can delete, restore or revert, but not edit definitions. Nothing creates a custom component yet.
- Custom components are global: at most 200 active, 500 including deleted, and 20 versions per name; a definition's name, description (300 characters), serialized size (8,000 characters), template (40 nodes, 6 levels, three levels of custom nesting), and each Markup root (200 elements, 12 levels) are capped, and an expanded design is capped at 400 nodes and 24 levels (§4, §5).
- The registered actions are `demo_echo`, which has no side effects and whose description tells the model to use it only when a request asks for it, and the fourteen menu actions. Menu actions change only the in-memory demo menu (§5): nothing reaches a real POS, and every change is gone when the API restarts. The three deletes ask in the sandbox before they run.
- Menu actions cannot create or edit modifier groups, and generated forms do not show an item's current values.
- There is no authentication. Anyone who can reach the API can generate designs, and anyone who knows a design id can run its actions, so anyone can change the demo menu; only actions without lasting effects outside the API are safe to register.
- The `components` catalog table is not exposed over HTTP; custom components are exposed only through `/api/custom-components` for the panel.
- **`npm run eval`** (§9) runs the 31 committed live cases in [server/eval/cases/](../server/eval/cases/) against OpenAI and scores each generation with deterministic checks: `maxAttempts`, `uiComponent`, `noUiComponent`, `uiButtonAction`, `noButtonAction`, `uiNamedInput`, `uiText`, `uiMarkupTag`, `uiProps` (a node of the component whose props include the listed values), `agentComponent` (the component is in the model's own tree, before expansion), `notesMaxWords`, `notesExcludes` and `notesMentions` (the notes contain one of the listed texts, ignoring case). A case can seed `customComponents` into the run's in-memory repository. `cases.test.ts` checks the committed cases without the model: each file is named after its id, every check names a component, prop, action, action input or Markup tag that exists, and every seed saves. Each case's log holds the prompt, checks, failures, every attempt, and the final tree and notes.

**Planned**

- Authentication, before any real action ships.
- The CapheViet POS agent registering `GENERATE_UI_TOOL` and calling the generate and action routes.
- A live CapheVietPOS adapter for the `PosMenu` port, behind authentication, so the same menu actions change the café's real menu; nothing built on the port changes.
- Real, side-effecting actions (saving or sending data, for example), registered in `server/actions/` once authentication exists.
- Pre-built custom components for action forms (a card shell, dropdown pickers, a price field), which first need a way to save custom components; build order and open questions are in [prebuilt-elements.md](prebuilt-elements.md).

## 11. History

genui started as a chat shell: a left-hand chat pane with a tool-using agent that streamed its replies to the browser over server-sent events, kept conversations in memory (identified by a conversation id), could define and delete custom components itself, and saved a trace of every turn to a second Postgres database, `genui_traces`. Redis was added so rate limits and conversations could be shared between instances. All of that was removed when genui became a one-call generator: the chat pane, the agent loop and its per-turn caps, the SSE stream, conversations, the `/api/agent/*` routes, the tool registry, trace storage and Redis are gone. The generator, the design store, the action route, the Components panel and the eval harness replaced them.

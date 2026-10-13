---
id: wire-api-services
priority: 50
depends:
  - port-agent-loop
  - openai-llm-adapter
  - postgres-components-store
  - chat-pane-streaming
touches:
  - server/index.ts
scope: small
---

# Wire the agent, OpenAI adapter, and database into the API

## Sources

- [Agent API plan — Step 5, Adapter scaffold](../../docs/plans/agent-api-and-database.md#8-step-5--adapter-scaffold) (`server/index.ts` builds the adapters)
- [Agent API plan — Step 4, Postgres and the components table](../../docs/plans/agent-api-and-database.md#7-step-4--postgres-and-the-components-table) (migrations on start)
- [Agent API plan — Target shape](../../docs/plans/agent-api-and-database.md#2-target-shape)

## Context

Earlier goals built each piece separately and left `server/index.ts` for this goal. That file currently registers only the health plugin at `/api/health`, with no `pingDb`, so it reports `db:false`. The pieces available:

- From `port-agent-loop`, in `server/routes/agent.ts`: `agentRouter`, a Fastify plugin taking `{ llm?: AgentLlm; tools: ToolRegistry }` that serves `POST /chat` as an SSE stream. `server/agent/loop.ts` exports `SYSTEM_PROMPT`.
- From `openai-llm-adapter`, in `server/adapters/openai/OpenAILlm.ts`: `createOpenAILlm({ apiKey, model, systemPrompt, maxRetries? }) → AgentLlm`.
- From `api-foundation`, in `server/agent/tools.ts`: `emptyToolRegistry`. `server/config.ts` provides `config` (`apiPort`, `apiHost`, `openai.apiKey`, `openai.model`, `databaseUrl`, `logLevel`) and `agentAvailable`. `server/routes/health.ts` takes `{ pingDb? }`.
- From `postgres-components-store`, in `server/adapters/db/`:
  - `createDb(url) → { db, pool, ping, close }`, which doesn't connect until first use.
  - `runMigrations(db, folder?)`, with the folder relative to the working directory.
  - `DrizzleComponentRepository`, which implements `ComponentRepository`.
  - A Compose `db` service on `localhost:5432` (`genui`/`genui`/`genui`).
- From `chat-pane-streaming`: the browser posts prompts to `/api/agent/chat` and renders the stream.

`server/index.ts` is the only place that builds real adapters. No HTTP routes or agent tools use the repository yet. It only needs to be built and reachable from the app, so a later plan can add `/api/components` routes or tools without touching this wiring.

## Scope

All edits are in `server/index.ts`:

1. Build `const database = createDb(config.databaseUrl)` and `const components = new DrizzleComponentRepository(database.db)`. Make the repository available on the app with `app.decorate("components", components)`, plus a `declare module "fastify"` augmentation typing `components: ComponentRepository`.
2. When `process.env.NODE_ENV === "production"`, `await runMigrations(database.db)` before listening. If it fails, log the error and exit non-zero. In development, migrations stay manual (`npm run db:migrate`), and the API starts even when Postgres is down.
3. Register health with `{ pingDb: database.ping }`.
4. Build `llm = agentAvailable ? createOpenAILlm({ apiKey: config.openai.apiKey, model: config.openai.model, systemPrompt: SYSTEM_PROMPT }) : undefined`, and register `agentRouter` at `/api/agent` with `{ llm, tools: emptyToolRegistry }`.
5. Add an `onClose` hook that calls `database.close()`.
6. After `listen`, log one startup line with the address, `agent: openai | not configured (set OPENAI_API_KEY)`, and the database host. Never log the password or the API key.

## Acceptance

- With `docker compose up -d db`, `npm run db:migrate`, and `npm run dev`:
  - `GET /api/health` returns `{"ok":true,"db":true,"agent":<key set>}`.
  - With Postgres stopped, it returns `"db":false`, and the API keeps serving.
- With `OPENAI_API_KEY` set, `POST /api/agent/chat` streams `text` events and then `done`. A follow-up message on the same `conversationId` gets an answer that uses the earlier turn, because history is kept in memory.
- Without `OPENAI_API_KEY`, the chat route streams one `error` event naming the variable, and the browser shows it as an error line.
- In the browser at `http://localhost:5173`, a prompt streams a reply into the thread, and Stop ends it mid-stream.
- With `NODE_ENV=production` and a fresh database, starting the API creates the `components` table. Starting with an unreachable database exits non-zero with a logged error.
- Stopping the server closes the Postgres pool, so no open handles keep the process alive.

## Validation

- `npm run typecheck`, `npm test`, `npm run build`, and `npm run build:api`, all exiting 0.
- `docker compose up -d db && npm run db:migrate && npm run dev`, then:
  - `curl -s localhost:5173/api/health` returns `"db":true`.
  - `curl -N -X POST localhost:5173/api/agent/chat -H 'content-type: application/json' -d '{"conversationId":"t1","message":"hi"}'` streams `data: {"type":"text",...}` lines, then `data: {"type":"done"}`. This needs `OPENAI_API_KEY` in `.env.local`; without it, expect a single `error` event.
- Manual browser check at `http://localhost:5173`: send a prompt, watch it stream, send a long prompt, and press Stop.
- `docker compose down -v && docker compose up -d db`, then `NODE_ENV=production DATABASE_URL=postgres://genui:genui@localhost:5432/genui node server-dist/index.mjs` creates the table. Check with `docker compose exec db psql -U genui -d genui -c '\dt'`.

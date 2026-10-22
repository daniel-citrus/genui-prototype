# genui-prototype

A Vite + TypeScript chat shell backed by a Fastify agent API (OpenAI, streamed over SSE) and Postgres, with Docker for dev and production.

Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Local (Node 24+)

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Create your env file, then set `OPENAI_API_KEY` in it. It is the only required value; `AGENT_MODEL` and `DATABASE_URL` are shown commented out, and every variable with its default is in `server/config.ts`:

   ```bash
   cp .env.example .env.local
   ```

3. Start Postgres:

   ```bash
   docker compose up -d db
   ```

4. Apply the migrations (catalog and traces on the same Postgres instance), then seed the component catalog:

   ```bash
   npm run db:migrate
   npm run db:migrate:traces
   npm run db:seed
   ```

   Run `npm run db:seed` again whenever you pull changes to `server/catalog/components.ts`. The development API does not reseed on start, and until the seed runs `render_ui` checks designs against the old catalog (for example, it rejects the Button `action` and input `name` props that let a design's buttons run actions).

5. Start the API (port 3001) and the web app (port 5173) together:

   ```bash
   npm run dev
   ```

Open http://localhost:5173. `curl -s localhost:5173/api/health` should show `{"ok":true,"db":true,"agent":true,"traces":true}` when both Postgres databases are up (same instance: `genui` and `genui_traces`; see `TRACE_DATABASE_URL` in `server/config.ts`). Without a key the app still runs, with `"agent":false`, and the chat replies with an error asking for `OPENAI_API_KEY`.

`npm run dev:web` and `npm run dev:api` start either half alone.

**Redis (optional).** The per-IP rate limits on chat and on action clicks count in memory by default, and the app runs fine without Redis. To keep the counts in Redis instead, run `docker compose up -d redis` and add `REDIS_URL=redis://localhost:6379` to `.env.local`; `curl -s localhost:5173/api/health` then shows `"redis":true` alongside `db`, `agent`, and `traces`.

**Port 5432 taken?** The `db` service publishes host port 5432. If another Postgres already holds it, map a different host port (e.g. `"5433:5432"`) in an uncommitted `docker-compose.override.yml` using `ports: !override`, set `DATABASE_URL=postgres://genui:genui@localhost:5433/genui` in `.env.local`, and run `DATABASE_URL=postgres://genui:genui@localhost:5433/genui npm run db:migrate` (drizzle-kit does not read `.env.local`; `npm run db:seed` does).

### Other scripts

```bash
npm test              # unit tests (catalog DB tests need DATABASE_URL; traces DB tests need TRACE_DATABASE_URL)
npm run typecheck     # app, Vite config, and server
npm run build         # web bundle → dist/
npm run build:api     # API bundle → server-dist/index.mjs
npm run preview       # serve dist/ on :4173
npm run db:generate   # new migration after editing server/adapters/db/schema.ts
npm run db:generate:traces   # new migration after editing server/adapters/traces/schema.ts
npm run db:migrate:traces    # ensure genui_traces exists and apply traces migrations
npm run db:seed       # sync the components table with server/catalog/components.ts (rerun after pulling catalog changes)
npm run db:studio     # browse the database
npm run eval          # live OpenAI eval cases (needs OPENAI_API_KEY; same model as chat; not run in CI)
```

## Docker

Compose passes `OPENAI_API_KEY` and `AGENT_MODEL` from your shell environment (it does not read `.env.local`):

```bash
export OPENAI_API_KEY=sk-...
```

**Development** (Vite HMR and `tsx watch`, source mounted):

```bash
docker compose up dev
```

This brings up `db`, `api-dev` (port 3001), and `dev` (port 5173). Open http://localhost:5173. The development API does not migrate or seed on start: run `npm run db:migrate && npm run db:migrate:traces && npm run db:seed` against the Compose database from the host once, and again after pulling migration or catalog changes (or start the production flow, which migrates and seeds on start).

**Production** (API image + nginx):

```bash
docker compose up web --build
```

This brings up `db`, `api` (migrates the database and seeds the component catalog on start), and `web`. Open http://localhost:8080; nginx serves the app and proxies `/api/` to the API without buffering, so replies stream.

Or build the images directly:

```bash
docker build -t genui-prototype .
docker build -f Dockerfile.api -t genui-prototype-api .
```

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

4. Apply the migrations, then seed the component catalog:

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

5. Start the API (port 3001) and the web app (port 5173) together:

   ```bash
   npm run dev
   ```

Open http://localhost:5173. `curl -s localhost:5173/api/health` should show `{"ok":true,"db":true,"agent":true}`. Without a key the app still runs, with `"agent":false`, and the chat replies with an error asking for `OPENAI_API_KEY`.

`npm run dev:web` and `npm run dev:api` start either half alone.

**Redis (optional).** The per-IP chat rate limit counts in memory by default, and the app runs fine without Redis. To keep the counts in Redis instead, run `docker compose up -d redis` and add `REDIS_URL=redis://localhost:6379` to `.env.local`; `curl -s localhost:5173/api/health` then shows `"redis":true`.

**Port 5432 taken?** The `db` service publishes host port 5432. If another Postgres already holds it, map a different host port (e.g. `"5433:5432"`) in an uncommitted `docker-compose.override.yml` using `ports: !override`, set `DATABASE_URL=postgres://genui:genui@localhost:5433/genui` in `.env.local`, and run `DATABASE_URL=postgres://genui:genui@localhost:5433/genui npm run db:migrate` (drizzle-kit does not read `.env.local`; `npm run db:seed` does).

### Other scripts

```bash
npm test              # unit tests (database tests run only when DATABASE_URL is set)
npm run typecheck     # app, Vite config, and server
npm run build         # web bundle → dist/
npm run build:api     # API bundle → server-dist/index.mjs
npm run preview       # serve dist/ on :4173
npm run db:generate   # new migration after editing server/adapters/db/schema.ts
npm run db:seed       # sync the components table with server/catalog/components.ts
npm run db:studio     # browse the database
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

This brings up `db`, `api-dev` (port 3001), and `dev` (port 5173). Open http://localhost:5173. The development API does not migrate or seed on start: run `npm run db:migrate && npm run db:seed` against the Compose database once from the host (or start the production flow once, which does both).

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

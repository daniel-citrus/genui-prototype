# genui-prototype

A UI generator. A host agent (the planned CapheViet POS agent) hands genui a plain-language prompt and gets back a validated UI design. One `POST /api/generate` makes one OpenAI JSON call (plus at most two repairs) and checks the design against the component catalog, the registered actions and any saved custom components. A Vite + TypeScript preview page draws the design in a sandbox. The API is Fastify on Postgres, with Docker for dev and production.

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

   Run `npm run db:seed` again whenever you pull changes to `server/catalog/components.ts`. The development API does not reseed on start, and until the seed runs the generator checks designs against the old catalog (for example, it rejects the Button `action` and input `name` props that let a design's buttons run actions).

5. Start the API (port 3001) and the web app (port 5173) together:

   ```bash
   npm run dev
   ```

Open http://localhost:5173, type what you want in the prompt box and click Generate. The design appears in the sandbox, with the generator's notes under the prompt, and the Components button lists the saved custom components. `curl -s localhost:5173/api/health` should show `{"ok":true,"db":true,"agent":true}` when Postgres is up. Without a key the app still runs, with `"agent":false`, and generating answers with an error asking for `OPENAI_API_KEY`.

## Generate a UI

```bash
curl -s localhost:5173/api/generate \
  -H 'content-type: application/json' \
  -d '{"prompt":"A form to add a new menu item with a name and a category"}'
```

The prompt is at most 4000 characters. A success is 200 `{ ok: true, id, tree, notes, attempts }`: `tree` is the design (`{ component, props?, children? }`), `notes` is a short text for the person (for example, that a button has no action yet), `id` names the design for the action route, and `attempts` counts model calls (1 to 3). When the design still has problems after the repairs, the answer is 422 `{ ok: false, error, problems, attempts }`. Other answers: 400 for a bad body, 429 past the rate limit, 502 when the model call fails, 503 without `OPENAI_API_KEY` (or when custom components are unavailable). A generation is cut off after 90 seconds.

The generator remembers the newest 500 designs in memory. When a person clicks a design's button, the host runs its action with `POST /api/actions/run`:

```bash
curl -s localhost:5173/api/actions/run \
  -H 'content-type: application/json' \
  -d '{"designId":"<id from generate>","action":"demo_echo","values":{"text":"hi"}}'
```

The answer is `{ ok, message }`. An action with a confirm question answers `{ ok: false, message, confirm }` first; send the same request again with `"confirmed": true` once the person says yes. A design the API no longer remembers (after a restart, or past 500 newer ones) answers 409: generate it again.

### Registering the tool in a host agent

`GENERATE_UI_TOOL` in [`shared/generate.ts`](shared/generate.ts) is the tool definition (`name: "generate_ui"`, `description`, JSON-schema `parameters` with one `prompt` string). Offer it to the host agent's model as a function tool. When the model calls it, POST the arguments to `/api/generate`, give the model the `notes` (or the `error`) from the response, and draw `tree` for the person; later button clicks go to `/api/actions/run` with the `id` as `designId`.

**Limits.** Rate limits count requests per client IP in the memory of each API instance (`AGENT_RATE_LIMIT_PER_MINUTE`, default 20 per minute for each of generate, actions and custom components), so several instances each count on their own. There is no authentication yet: anyone who can reach the API can generate designs and, knowing a design id, run its actions.

`npm run dev:web` and `npm run dev:api` start either half alone.

**Port 5432 taken?** The `db` service publishes host port 5432. If another Postgres already holds it, map a different host port (e.g. `"5433:5432"`) in an uncommitted `docker-compose.override.yml` using `ports: !override`, set `DATABASE_URL=postgres://genui:genui@localhost:5433/genui` in `.env.local`, and run `DATABASE_URL=postgres://genui:genui@localhost:5433/genui npm run db:migrate` (drizzle-kit does not read `.env.local`; `npm run db:seed` does).

### Other scripts

```bash
npm test              # unit tests (catalog DB tests need DATABASE_URL)
npm run typecheck     # app, Vite config, and server
npm run build         # web bundle → dist/
npm run build:api     # API bundle → server-dist/index.mjs
npm run preview       # serve dist/ on :4173
npm run db:generate   # new migration after editing server/adapters/db/schema.ts
npm run db:seed       # sync the components table with server/catalog/components.ts (rerun after pulling catalog changes)
npm run db:studio     # browse the database
npm run eval          # live OpenAI eval cases through the generator; gitignored eval-logs JSON per case; `-- --repeat N` (1-10) reruns each case, logs <id>.<k>.json; `-- --case <id>` (repeatable) runs only those cases (needs OPENAI_API_KEY; same model as the API; not run in CI)
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

This brings up `db`, `api-dev` (port 3001), and `dev` (port 5173). Open http://localhost:5173. The development API does not migrate or seed on start: run `npm run db:migrate && npm run db:seed` from the host first (the `db` service publishes port 5432).
**Production** (API image + nginx):

```bash
docker compose up web --build
```

This brings up `db`, `api` (migrates the database and seeds the component catalog on start), and `web`. Open http://localhost:8080; nginx serves the app and proxies `/api/` to the API without buffering, so a slow generation isn't cut short (reads time out after 120 seconds).

Or build the images directly:

```bash
docker build -t genui-prototype .
docker build -f Dockerfile.api -t genui-prototype-api .
```

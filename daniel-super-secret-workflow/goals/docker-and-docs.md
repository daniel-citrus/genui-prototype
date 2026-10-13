---
id: docker-and-docs
priority: 60
depends:
  - wire-api-services
touches:
  - Dockerfile.api
  - docker-compose.yml
  - nginx.conf
  - docs/ARCHITECTURE.md
  - README.md
scope: medium
---

# Run the API and database in Docker, and document the new architecture

## Sources

- [Agent API plan — Step 6, Docker, docs, and checks](../../docs/plans/agent-api-and-database.md#9-step-6--docker-docs-and-checks)
- [Agent API plan — Target shape](../../docs/plans/agent-api-and-database.md#2-target-shape)

## Context

By this point the API is complete and runs locally:

- `npm run dev:api` serves `/api/health` and `/api/agent/chat` (SSE).
- `npm run build:api` bundles it with esbuild to `server-dist/index.mjs`, with dependencies left external.
- In production (`NODE_ENV=production`), it runs Drizzle migrations from `server/adapters/db/migrations` (relative to the working directory) before listening, and exits non-zero if they fail.
- It reads `API_PORT` (3001), `API_HOST` (default `127.0.0.1`; must be `0.0.0.0` in containers), `OPENAI_API_KEY`, `AGENT_MODEL` (default `gpt-4.1`), `DATABASE_URL`, and `LOG_LEVEL`.
- Vite proxies `/api` to `process.env.API_PROXY_TARGET ?? "http://localhost:3001"`.

Docker today:

- `Dockerfile`: a Node 24 build stage, then `nginx:1.27-alpine` serving `dist/` with `nginx.conf`, which has only an SPA `try_files` fallback.
- `docker-compose.yml`:
  - `dev`: `node:24-alpine`, repo mounted, `npm ci && npm run dev -- --host 0.0.0.0 --port 5173`, port 5173, `CHOKIDAR_USEPOLLING`.
  - `web`: builds `Dockerfile`, port `8080:80`.
  - `db`: `postgres:17-alpine`, user, password, and database `genui`, port 5432, volume `pgdata`, with a `pg_isready` healthcheck.

Note that `npm run dev` now starts **both** API and web through `concurrently`. The web-only script is `dev:web`.

`docs/ARCHITECTURE.md` still says there is no backend, database, or API. `README.md` covers only the frontend.

## Scope

1. **`Dockerfile.api`:**
   - Build stage: `node:24-alpine`, `npm ci`, copy the source, `npm run build:api`.
   - Runtime stage: `node:24-alpine`, `WORKDIR /app`, `npm ci --omit=dev`, copy `server-dist/` and `server/adapters/db/migrations/` to the same relative paths.
   - `ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3001`, `EXPOSE 3001`, and `CMD ["node", "server-dist/index.mjs"]`.
2. **`docker-compose.yml`:**
   - `api-dev`: `node:24-alpine`, repo mounted at `/app`, `npm ci && npm run dev:api`. Environment `API_HOST=0.0.0.0`, `DATABASE_URL=postgres://genui:genui@db:5432/genui`, and `OPENAI_API_KEY` / `AGENT_MODEL` passed through from the host env. Port 3001, and it starts after `db` is healthy (`depends_on` with `condition: service_healthy`).
   - `dev`: change its command to run `npm run dev:web -- --host 0.0.0.0 --port 5173` (not `dev`, which would start a second API). Add `API_PROXY_TARGET=http://api-dev:3001` and start it after `api-dev`. To avoid two containers racing `npm ci` on the shared `node_modules`, let only `api-dev` run `npm ci`, or give each service its own `node_modules` volume. Pick one and note it in a Compose comment.
   - `api`: built from `Dockerfile.api`, with `DATABASE_URL` pointing at `db`, the OpenAI variables passed through, and a start after `db` is healthy. No published port is needed.
   - `web`: starts after `api`.
   - Keep `db` as it is.
3. **`nginx.conf`:** add `location /api/ { proxy_pass http://api:3001; proxy_http_version 1.1; proxy_set_header Connection ""; proxy_buffering off; proxy_cache off; proxy_read_timeout 300s; }` before the SPA fallback, so SSE streams aren't buffered.
4. **`docs/ARCHITECTURE.md`:** update the intro, Purpose, User interface (the chat now streams agent replies), Runtime shapes (diagram and mode table with API and database), Repository layout (`server/`, `shared/`, `drizzle.config.ts`, `Dockerfile.api`), Build and typecheck (all new scripts, including `test`, `build:api`, and `db:*`), and Docker. Describe what exists, not what is planned. Mention that conversations are in memory, the agent has no tools yet, and the `components` table (`name`, `spec`, `props_schema`) has a repository but no routes.
5. **`README.md`:** local setup steps:
   1. `npm ci`
   2. `cp .env.example .env.local`, then set `OPENAI_API_KEY`
   3. `docker compose up -d db`
   4. `npm run db:migrate`
   5. `npm run dev`

   Also add `npm test`, `npm run build:api`, the Compose dev flow (`docker compose up dev`, which brings up `api-dev` and `db`), and the production flow (`docker compose up web --build`).

## Acceptance

- `docker compose up web --build` (with `OPENAI_API_KEY` in the shell env) starts `db`, `api`, and `web`. The API applies migrations on start.
  - `curl -s localhost:8080/api/health` returns `{"ok":true,"db":true,"agent":true}`.
  - A prompt typed at `http://localhost:8080` streams its reply progressively, not all at once.
- `docker compose up dev` starts `db`, `api-dev`, and `dev`. `http://localhost:5173` serves the app with HMR, and `curl -s localhost:5173/api/health` reaches `api-dev` with `"db":true` (after `npm run db:migrate` against the Compose database, or a first production start).
- `docker build -f Dockerfile.api .` succeeds, and the image contains no dev dependencies or TypeScript sources beyond the bundle and migrations.
- `docs/ARCHITECTURE.md` and `README.md` match the repository: every documented script exists in `package.json`, and every documented service exists in `docker-compose.yml`. Neither still says there is no backend.

## Validation

- `docker compose up -d web --build`, then `curl -s localhost:8080/api/health`, and `curl -N -X POST localhost:8080/api/agent/chat -H 'content-type: application/json' -d '{"conversationId":"d1","message":"hi"}'`, which shows events arriving incrementally. Needs Docker and `OPENAI_API_KEY`; without the key, expect `"agent":false` and a single `error` event.
- `docker compose down && docker compose up -d dev`, then `curl -s localhost:5173/api/health`.
- `docker compose exec api ls /app`: only `node_modules`, `package*.json`, `server-dist`, and `server`, with migrations only under `server`.
- `npm run typecheck && npm test && npm run build && npm run build:api` still exit 0.
- Read through both docs against `package.json` and `docker-compose.yml`.

---
id: remove-redis
priority: 20
depends: []
touches:
  - server/adapters/redis
  - server/rateLimit.ts
  - server/rateLimit.test.ts
  - server/rateLimit.redis.test.ts
  - server/app.ts
  - server/app.test.ts
  - server/index.ts
  - server/config.ts
  - server/routes/health.ts
  - server/routes/health.test.ts
  - package.json
  - package-lock.json
  - docker-compose.yml
  - .env.example
  - .github/workflows/ci.yml
scope: small
---

# Remove Redis and count rate limits in memory

## Sources

- [Simplify genui plan — R11](../plans/simplify-to-generator-tool.md#r11-remove-redis)

## Context

genui is being cut down to a one-call UI generator tool. Redis is optional today and only holds `@fastify/rate-limit` counters: `server/adapters/redis/client.ts` builds the client, `server/rateLimit.ts` passes it to `@fastify/rate-limit`, config reads `REDIS_URL`, `ioredis` is a dependency, `docker-compose.yml` and `.github/workflows/ci.yml` have a `redis` service, and `server/routes/health.ts` returns `{ ok, db, agent, redis, traces }`. This goal removes Redis only; the `traces` health key and the traces database stay until a later goal.

## Scope

- Delete `server/adapters/redis/` and `server/rateLimit.redis.test.ts`.
- Remove the `ioredis` dependency (update `package.json` and `package-lock.json`).
- Remove `REDIS_URL` from `server/config.ts` and `.env.example`.
- Remove the Compose `redis` service and the `api` service's dependency on it; remove the CI `redis` service and its env.
- `registerRateLimit` takes no store option; counts live in process memory.
- Health no longer includes `redis`. Keep every other key it returns today.
- Update call sites in `server/app.ts` and `server/index.ts`.

## Acceptance

- None of the paths, dependency, env var, Compose service or CI service listed in Scope exist anymore.
- `registerRateLimit` has no store option.
- Health responds without a `redis` key and other keys are unchanged.
- The rate-limit tests in `server/rateLimit.test.ts` still pass.
- `git grep -i -e ioredis -e REDIS_URL -- server src shared package.json .env.example docker-compose.yml .github` finds nothing.

## Validation

- `npm run typecheck` passes.
- `npm test` passes (database tests are skipped without `DATABASE_URL`).
- `npm run build` and `npm run build:api` pass.

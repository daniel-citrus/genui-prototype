---
id: redis-store
priority: 50
depends:
  - ip-rate-limit
touches:
  - package.json
  - package-lock.json
  - server/adapters/redis/client.ts
  - server/adapters/redis/client.test.ts
  - server/rateLimit.ts
  - server/rateLimit.redis.test.ts
  - server/app.ts
  - server/index.ts
  - server/config.ts
  - server/routes/health.ts
  - server/routes/health.test.ts
  - docker-compose.yml
  - .github/workflows/ci.yml
scope: medium
---

# Keep rate-limit counts in Redis when REDIS_URL is set

## Sources

- [Request limits plan: R7, R8, R9, R10, R11, Security](./request-limits.md#r7-redis-store-when-configured)

## Context

This builds on `ip-rate-limit`, which provides the in-memory chat rate limit:

- `server/rateLimit.ts` exports `RATE_LIMIT_NAMESPACE` (`genui-rate-limit:`), `ChatRateLimitOptions` (`max`, `timeWindowMs?`, `nameSpace?`) and `registerRateLimit(app, opts)`. The last registers `@fastify/rate-limit` with `global: false` and `skipOnError: true`.
- `buildApp(deps)` in `server/app.ts` takes `rateLimit: ChatRateLimitOptions`.
- The chat route opts in with `config: { rateLimit: {} }`.

In-memory counts reset whenever the API restarts and aren't shared between instances.

Other current state:

- **Health:** `server/routes/health.ts` returns `{ ok: true, db, agent }`. `db` comes from an optional `pingDb`, and there is no health test yet. The pattern to mirror is `DbHandle` in `server/adapters/db/client.ts`, whose `ping()` never rejects and whose `close()` ends the pool.
- **Shutdown:** `server/index.ts` closes the database in an `onClose` hook and calls `app.close()` on SIGINT and SIGTERM.
- **Tests:** database tests skip without `DATABASE_URL`, and `npm test` runs files one at a time.
- **CI:** `.github/workflows/ci.yml` runs a `postgres:17-alpine` service and sets `DATABASE_URL`.

The plugin needs an `ioredis` client (it is tested against `ioredis` ^6; use the named `Redis` export). With `skipOnError: true` it silently lets a request through when the store fails; it logs nothing itself. ioredis's defaults retry for a long time and queue commands while disconnected. `connectTimeout`, `maxRetriesPerRequest` and `enableOfflineQueue` exist in ioredis 6.

## Scope

- Add `ioredis` (^6) to `dependencies` with `npm install`.
- Add `server/adapters/redis/client.ts`:

  ```ts
  export interface RedisHandle {
    client: Redis;
    /** Resolves whether Redis answered PING; never rejects. */
    ping(): Promise<boolean>;
    close(): Promise<void>;
  }
  export function createRedis(url: string, log: { warn(msg: string): void; info(msg: string): void }): RedisHandle;
  ```

  - Client options: `connectTimeout: 500`, `maxRetriesPerRequest: 1`, `enableOfflineQueue: false`, with the default reconnect strategy, so the API recovers without a restart.
  - On `error`, call `log.warn` once until the next `ready` (once per outage, not once per request). Include the host only, never the URL's credentials.
  - `close()` calls `quit()`, falling back to `disconnect()` if that fails.
- `server/rateLimit.ts`: add optional `redis?: Redis` to `ChatRateLimitOptions` and pass it to the plugin. Without it, behavior is unchanged (memory).
- `server/app.ts`:
  - Add optional `redis?: RedisHandle` to `AppDeps`.
  - Pass `redis.client` into the rate-limit options.
  - Pass `pingRedis: redis.ping` to `healthRouter`.
  - Register `onClose` to call `redis.close()`.
- `server/routes/health.ts`: `HealthOptions` adds an optional `pingRedis` (async, resolves a boolean). The body becomes `{ ok: true, db, agent, redis }`, where `redis` is `null` without `pingRedis`, the ping result otherwise, and `false` if it throws.
- `server/config.ts`: `redisUrl: env.REDIS_URL || undefined`.
- `server/index.ts`: when `config.redisUrl` is set, call `createRedis(config.redisUrl, app-compatible logger)` and pass it to `buildApp`. The API must start while Redis is down. If `buildApp` needs the handle before the app's logger exists, a small adapter over a Pino child logger is fine.
- `docker-compose.yml`:
  - Add `redis`: `image: redis:8-alpine`, `command: redis-server --save "" --appendonly no`, `ports: "6379:6379"`, and a healthcheck of `redis-cli ping`.
  - The production `api` gets `REDIS_URL: redis://redis:6379` and `depends_on` `redis` with `condition: service_healthy`.
  - `api-dev` is unchanged and keeps the in-memory store.
- `.github/workflows/ci.yml`: add a `redis` service (`redis:8-alpine`, port 6379, a `redis-cli ping` health command) and `REDIS_URL: redis://localhost:6379` next to `DATABASE_URL`.

## Acceptance

- With `REDIS_URL` set (in `server/rateLimit.redis.test.ts`, skipped without it):
  - the 21st request from one IP gets the 429 with `retry-after` and the "Too many messages" message, and a second IP passes;
  - a count survives closing one `buildApp` instance and building a new one on the same Redis;
  - keys start with the test's namespace and have a TTL no longer than the window.
- Each Redis test run uses a unique `nameSpace` (for example with a random suffix), so leftover counts never leak between runs.
- With `REDIS_URL` pointing at a closed port (for example `redis://127.0.0.1:1`), which needs no running Redis:
  - a chat request through `buildApp` still streams, and its limiter step finishes within 1 second;
  - `ping()` resolves `false`;
  - `log.warn` is called once across repeated errors;
  - the warn text doesn't contain a password embedded in the URL.
- `close()` resolves even while disconnected, and the test process exits with no open handles.
- `GET /api/health` returns `redis: null` without `pingRedis`, `true` or `false` from a fake ping, and `false` when the ping throws (`server/routes/health.test.ts`).
- Without `REDIS_URL`, nothing connects to Redis and the rate limit behaves exactly as before.

## Validation

- `npm run typecheck` passes.
- `npm test` passes without `REDIS_URL`: the Redis store tests skip, and the fail-open, close and health tests run with no Redis.
- `npm run build:api` succeeds with `ioredis` external.
- Optional, when Docker is available locally: `docker run -d --rm -p 6379:6379 redis:8-alpine`, then `REDIS_URL=redis://localhost:6379 npm test` runs the Redis store tests.

## After merge

- CI on the PR runs `server/rateLimit.redis.test.ts` instead of skipping it.
- `docker compose up web --build`: health shows `"redis":true`. After `docker compose stop redis`, chat still works, one warning is logged and health shows `"redis":false`. After `docker compose start redis`, limiting resumes without restarting the API.

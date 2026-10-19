---
id: ip-rate-limit
priority: 40
depends:
  - app-factory
touches:
  - package.json
  - package-lock.json
  - server/rateLimit.ts
  - server/rateLimit.test.ts
  - server/app.ts
  - server/index.ts
  - server/config.ts
  - server/routes/agent.ts
  - nginx.conf
  - docker-compose.yml
scope: medium
---

# Limit each client IP to 20 chat messages a minute

## Sources

- [Request limits plan: R4, R5, R6, Security](./request-limits.md#r4-per-ip-chat-rate-limit)

## Context

Every chat message costs at least one OpenAI call, there is no login, and nothing limits how many messages a client sends. `server/agent/guardrails.ts` caps steps, tool calls and tokens within one turn only.

This builds on `app-factory`, which provides `buildApp(deps: AppDeps)` in `server/app.ts`. It creates Fastify, adds the custom JSON parser and the error handler, and registers `healthRouter` (`/api/health`) and `agentRouter` (`/api/agent`). The error handler sends `{ error: { code, message } }` with `err.statusCode`, and the browser (`src/agentClient.ts`) shows `error.message`.

- **Config:** `server/config.ts` is the only file that reads the environment. Its `port(value, fallback)` helper parses positive integers.
- **nginx:** `nginx.conf` proxies `/api/` to `api:3001` without forwarding the client IP. As things stand, every production request would appear to come from nginx, and all users would share one limit.
- **Compose:** in `docker-compose.yml` the production `api` service isn't published, so only nginx can reach it. `api-dev` publishes 3001.

`@fastify/rate-limit` 11.x supports Fastify 5 (the repo has 5.12.6). Facts about it that matter here:

- It is wrapped with fastify-plugin. Registered with `global: false` on the root before the routes, it applies to any route that sets `config.rateLimit`.
- Its default key is `request.ip`, with IPv6 grouped by `/64`.
- On the limit, it sets the `retry-after` header to `Math.ceil(ttl / 1000)` and throws whatever `errorResponseBuilder(req, context)` returns, with `context.ttl` in milliseconds. That object reaches the app's error handler.
- It runs in `onRequest`, before the body is read.

## Scope

- Add `@fastify/rate-limit` (^11) to `dependencies` with `npm install`, so `package-lock.json` pins it.
- Add `server/rateLimit.ts`:

  ```ts
  export const RATE_LIMIT_NAMESPACE = "genui-rate-limit:";
  export interface ChatRateLimitOptions {
    max: number;            // per IP per window
    timeWindowMs?: number;  // default 60_000
    nameSpace?: string;     // default RATE_LIMIT_NAMESPACE
  }
  export async function registerRateLimit(app: FastifyInstance, opts: ChatRateLimitOptions): Promise<void>;
  export function tooManyMessages(ttlMs: number): string;
  ```

  - `registerRateLimit` registers the plugin with `global: false`, `max`, `timeWindow`, `nameSpace`, `skipOnError: true`, and `errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, message: tooManyMessages(ctx.ttl) })`.
  - `tooManyMessages` returns "Too many messages. Try again in N seconds.", with N = `Math.max(1, Math.ceil(ttlMs / 1000))`, and "1 second" when N is 1.
  - The `redis-store` goal later adds an optional `redis` field, so keep the options object open to extension.
- `server/app.ts`: add `trustProxy?: number | false` and `rateLimit: ChatRateLimitOptions` to `AppDeps`. Pass `trustProxy` (default `false`) to `Fastify({ trustProxy })`, and `await registerRateLimit(app, deps.rateLimit)` before registering the routers.
- `server/routes/agent.ts`: add `config: { rateLimit: {} }` to the chat route's options, which opts in with the global settings. No other route opts in. The parallel `message-length` goal adds `bodyLimit` to the same options object.
- `server/config.ts`:
  - `rateLimitPerMinute: port(env.AGENT_RATE_LIMIT_PER_MINUTE, 20)`.
  - `trustProxy`: the positive integer in `env.TRUST_PROXY`, otherwise `false`. Export a small parser so it can be tested.
- `server/index.ts`: pass `trustProxy: config.trustProxy` and `rateLimit: { max: config.rateLimitPerMinute }` to `buildApp`.
- `nginx.conf`: in `location /api/`, add `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`.
- `docker-compose.yml`: set `TRUST_PROXY: "1"` on the production `api` service only. `api-dev` is reachable directly, so it must not trust the header.

## Acceptance

- Through `buildApp` with a fake LLM and `app.inject({ remoteAddress })`, requests 1–20 from one IP in a window pass, and request 21 gets:
  - status 429;
  - a `retry-after` header;
  - a JSON body whose `error.message` matches `^Too many messages\. Try again in \d+ seconds?\.$`, with the number equal to `retry-after`.
- A second `remoteAddress` still passes while the first is limited.
- `GET /api/health` is never limited, even after the chat limit is hit.
- `max` from the options is honored, for example a limit of 2 with the 3rd request refused.
- Requests the route rejects with 400 also count, because the limit runs first.
- `tooManyMessages(34000)` returns "Too many messages. Try again in 34 seconds.", and `tooManyMessages(1)` and `tooManyMessages(0)` return "… in 1 second.".
- With `trustProxy: false`, an `x-forwarded-for` header is ignored: requests that share a `remoteAddress` share a count.
- With `trustProxy: 1`, requests with different `x-forwarded-for` values get separate counts.
- The `TRUST_PROXY` parser maps unset, `0`, `abc` and `true` to `false`, and `1` to `1`.
- A missing or invalid `AGENT_RATE_LIMIT_PER_MINUTE` gives 20.

## Validation

- `npm run typecheck` passes.
- `npm test` passes, including the new `server/rateLimit.test.ts`. It runs with no database or Redis: use `buildApp`, a fake `AgentLlm` and `emptyToolRegistry` from `server/agent/tools`.
- `npm run build:api` succeeds and `server-dist/index.mjs` imports `@fastify/rate-limit` as an external package.

## After merge

- In the dev app, the 21st chat message within a minute shows "Too many messages. Try again in N seconds." in the chat.
- `docker compose up web --build`: the `api` request logs show the client's IP in `remoteAddress`, not nginx's container address.

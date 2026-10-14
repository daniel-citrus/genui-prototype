---
id: request-limits-docs
priority: 90
depends:
  - message-length
  - redis-store
touches:
  - docs/ARCHITECTURE.md
  - README.md
  - .env.example
  - docs/request-limits.md
scope: small
---

# Document the request limits and their settings

## Sources

- [Request limits plan: R12, Assumptions](../plans/request-limits.md#r12-docs)

## Context

This builds on `message-length` and `redis-store` (which itself built on `ip-rate-limit`). Together they shipped:

- **Message cap:** `MAX_MESSAGE_CHARS = 4000` in `shared/api.ts`, used for the chat textarea's `maxlength` and by the chat route, which answers 400 "Message is too long (max 4000 characters)." past it.
- **Body limit:** a 32 KB `bodyLimit` on `POST /api/agent/chat` (413).
- **Rate limit:** `@fastify/rate-limit` on the chat route only, `AGENT_RATE_LIMIT_PER_MINUTE` per IP per minute (default 20). Past it, a 429 with `Retry-After` and "Too many messages. Try again in N seconds.". It is a fixed window, IPv6 is grouped by /64, and it runs before the body is read.
- **Trust proxy:** `TRUST_PROXY` (proxy hops, default off) feeds Fastify's `trustProxy`. nginx forwards `X-Forwarded-For`, and the production `api` sets `TRUST_PROXY=1`. That is safe only because the production API's port isn't published.
- **Redis:** optional, via `REDIS_URL`, with keys under `genui-rate-limit:`. It fails open: requests pass when Redis is down, with one warning per outage. Health reports `redis: true | false | null`. Compose has a `redis` service (`redis:8-alpine`, no persistence, 6379), which the production `api` uses, and CI runs a Redis service.
- **Server setup:** it lives in `buildApp` in `server/app.ts`, while `server/index.ts` wires the adapters and listens.

Read the merged code to confirm each detail before documenting it. If something differs from this list, the code wins.

The docs today:

- `docs/ARCHITECTURE.md` §10 still says "there are no limits yet on message size or request rate". Its overview and production diagrams have no Redis. §3 describes health as `{ ok, db, agent }`. §7 lists the settings.
- `.env.example` lists `OPENAI_API_KEY` and commented defaults.
- `README.md` covers local setup and Docker.
- `docs/request-limits.md` is the original proposal. The plan decided to remove it once shipped, since the architecture doc becomes the record.

## Scope

- `docs/ARCHITECTURE.md`:
  - Add Redis and the rate limit to the §1 overview diagram and the §6 production diagram.
  - Describe the message cap, body limit, rate limit (chat route only, per IP, fixed window, fail-open with Redis) and trust proxy in §3 and §4.
  - Update the health body in §3.
  - Add `AGENT_RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY` and `REDIS_URL` with their defaults to §7.
  - Mention `server/app.ts` in the API description, and the Redis service in §9 CI.
  - Update §10 "Today".
  - Keep the existing "Tools that use the rendered components." line and its link in §10 as they are.
- `.env.example`: add the three variables, commented, with defaults. Next to `TRUST_PROXY`, warn that it must stay off where clients can reach the API directly.
- `README.md`: say Redis is optional, and that `docker compose up -d redis` plus `REDIS_URL=redis://localhost:6379` in `.env.local` turns it on locally.
- Delete `docs/request-limits.md`, and remove or retarget any link to it in `docs/` and `README.md`.

## Acceptance

- `docs/ARCHITECTURE.md` describes every shipped limit and setting above, and no longer says there are no limits on message size or request rate.
- Both architecture diagrams show Redis as optional.
- `.env.example` and `docs/ARCHITECTURE.md` §7 list the same three new variables with the same defaults.
- `README.md` explains how to start Redis locally and that the app runs without it.
- `docs/request-limits.md` is gone, and nothing in `docs/` or `README.md` links to it.

## Validation

- `grep -rn "request-limits.md" docs README.md` prints nothing.
- `grep -n "no limits yet" docs/ARCHITECTURE.md` prints nothing.
- `npm run typecheck` and `npm test` still pass (no code changes expected).

## After merge

- Read `docs/ARCHITECTURE.md` and check that the Mermaid diagrams render on GitHub.

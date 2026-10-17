import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";

export const RATE_LIMIT_NAMESPACE = "genui-rate-limit:";

export interface ChatRateLimitOptions {
  /** Requests allowed per IP per window. */
  max: number;
  /** Window length; default 60_000. */
  timeWindowMs?: number;
  /** Key prefix in the store; default RATE_LIMIT_NAMESPACE. */
  nameSpace?: string;
  /** Shared store; omit to count in memory. */
  redis?: Redis;
}

/** The message shown to the user when they hit the limit. */
export function tooManyMessages(ttlMs: number): string {
  const seconds = Math.max(1, Math.ceil(ttlMs / 1000));
  return `Too many messages. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
}

/** Registers the limiter; only routes with `config.rateLimit` are limited. */
export async function registerRateLimit(
  app: FastifyInstance,
  opts: ChatRateLimitOptions,
): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    max: opts.max,
    timeWindow: opts.timeWindowMs ?? 60_000,
    nameSpace: opts.nameSpace ?? RATE_LIMIT_NAMESPACE,
    redis: opts.redis,
    skipOnError: true,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      message: tooManyMessages(ctx.ttl),
    }),
  });
}

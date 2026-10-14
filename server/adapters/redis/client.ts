import { Redis } from "ioredis";

export interface RedisHandle {
  client: Redis;
  /** Resolves whether Redis answered PING; never rejects. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

interface RedisLog {
  warn(msg: string): void;
  info(msg: string): void;
}

/** Host (and port) of a connection URL, without credentials, for logs. */
function redisHost(url: string): string {
  try {
    return new URL(url).host || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Builds the client. It connects in the background and reconnects on its own;
 * commands fail fast while Redis is down instead of queueing.
 */
export function createRedis(url: string, log: RedisLog): RedisHandle {
  const host = redisHost(url);
  const client = new Redis(url, {
    connectTimeout: 500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  // Warn once per outage, not once per failed attempt or request.
  let warned = false;
  client.on("error", () => {
    if (warned) return;
    warned = true;
    log.warn(`redis unavailable (${host}); rate limiting is skipped until it returns`);
  });
  client.on("ready", () => {
    if (warned) log.info(`redis connection restored (${host})`);
    warned = false;
  });

  return {
    client,
    async ping() {
      try {
        return (await client.ping()) === "PONG";
      } catch {
        return false;
      }
    },
    async close() {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}

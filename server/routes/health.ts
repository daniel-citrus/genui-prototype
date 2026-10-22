import type { FastifyPluginAsync } from "fastify";
import { agentAvailable } from "../config";

export interface HealthOptions {
  /** Resolves whether the database answers. Without it, `db` is false. */
  pingDb?: () => Promise<boolean>;
  /** Resolves whether Redis answers. Without it, `redis` is null. */
  pingRedis?: () => Promise<boolean>;
  /** Resolves whether the traces database answers. Without it, `traces` is false. */
  pingTraces?: () => Promise<boolean>;
}

/** `GET /` → `{ ok: true, db, agent, redis, traces }`. */
export const healthRouter: FastifyPluginAsync<HealthOptions> = async (app, opts) => {
  app.get("/", async () => {
    let db = false;
    if (opts.pingDb) {
      try {
        db = await opts.pingDb();
      } catch {
        db = false;
      }
    }
    let redis: boolean | null = null;
    if (opts.pingRedis) {
      try {
        redis = await opts.pingRedis();
      } catch {
        redis = false;
      }
    }
    let traces = false;
    if (opts.pingTraces) {
      try {
        traces = await opts.pingTraces();
      } catch {
        traces = false;
      }
    }
    return { ok: true, db, agent: agentAvailable, redis, traces };
  });
};

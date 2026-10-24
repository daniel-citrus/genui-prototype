import type { FastifyPluginAsync } from "fastify";
import { agentAvailable } from "../config";

export interface HealthOptions {
  /** Resolves whether the database answers. Without it, `db` is false. */
  pingDb?: () => Promise<boolean>;
  /** Resolves whether the traces database answers. Without it, `traces` is false. */
  pingTraces?: () => Promise<boolean>;
}

/** `GET /` → `{ ok: true, db, agent, traces }`. */
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
    let traces = false;
    if (opts.pingTraces) {
      try {
        traces = await opts.pingTraces();
      } catch {
        traces = false;
      }
    }
    return { ok: true, db, agent: agentAvailable, traces };
  });
};

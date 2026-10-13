import type { FastifyPluginAsync } from "fastify";
import { agentAvailable } from "../config";

export interface HealthOptions {
  /** Resolves whether the database answers. Without it, `db` is false. */
  pingDb?: () => Promise<boolean>;
}

/** `GET /` → `{ ok: true, db, agent }`. */
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
    return { ok: true, db, agent: agentAvailable };
  });
};

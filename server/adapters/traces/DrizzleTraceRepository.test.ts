import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AgentTrace } from "../../agent/trace";
import { MAX_TRACES_PER_CONVERSATION } from "../../ports/TraceRepository";
import { createTracesDb, type TracesDbHandle } from "./client";
import { DrizzleTraceRepository } from "./DrizzleTraceRepository";
import { runMigrations } from "./migrate";
import { agentTraces } from "./schema";

const tracesDatabaseUrl = process.env.TRACE_DATABASE_URL;
const catalogDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://genui:genui@localhost:5432/genui";

function trace(conversationId: string, userText: string): AgentTrace {
  return {
    conversationId,
    userText,
    endedBy: "reply",
    steps: 1,
    toolCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    completions: [],
  };
}

describe(
  "DrizzleTraceRepository",
  { skip: tracesDatabaseUrl ? false : "TRACE_DATABASE_URL is not set" },
  () => {
    let handle: TracesDbHandle;
    let repo: DrizzleTraceRepository;

    before(async () => {
      handle = createTracesDb(tracesDatabaseUrl!, catalogDatabaseUrl);
      await runMigrations(handle.db, catalogDatabaseUrl, tracesDatabaseUrl!);
      repo = new DrizzleTraceRepository(handle.db);
    });

    after(async () => {
      await handle.db.delete(agentTraces);
      await handle.close();
    });

    it("returns saved traces oldest first", async () => {
      await repo.save(trace("c1", "first"));
      await repo.save(trace("c1", "second"));
      await repo.save(trace("c1", "third"));
      assert.deepEqual(
        (await repo.listByConversation("c1")).map((t) => t.userText),
        ["first", "second", "third"],
      );
    });

    it(`drops the oldest trace after ${MAX_TRACES_PER_CONVERSATION} saves for one conversation`, async () => {
      for (let i = 1; i <= MAX_TRACES_PER_CONVERSATION + 1; i++) {
        await repo.save(trace("c-cap", `t${i}`));
      }
      const texts = (await repo.listByConversation("c-cap")).map((t) => t.userText);
      assert.equal(texts.length, MAX_TRACES_PER_CONVERSATION);
      assert.deepEqual(texts, ["t2", "t3", "t4", "t5", "t6"]);
    });

    it("lists traces after closing the pool and opening a new one", async () => {
      await repo.save(trace("c-restart", "persisted"));
      await handle.close();

      const reopened = createTracesDb(tracesDatabaseUrl!, catalogDatabaseUrl);
      try {
        const again = new DrizzleTraceRepository(reopened.db);
        assert.deepEqual(
          (await again.listByConversation("c-restart")).map((t) => t.userText),
          ["persisted"],
        );
      } finally {
        await reopened.db.delete(agentTraces);
        await reopened.close();
      }

      handle = createTracesDb(tracesDatabaseUrl!, catalogDatabaseUrl);
      repo = new DrizzleTraceRepository(handle.db);
    });
  },
);

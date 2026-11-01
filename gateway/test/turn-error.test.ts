import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { explainCodexError, readFailureNotice, readTurnCompletion } from "../src/codex/turn-error.ts";
import { request, startHarness } from "./harness.ts";

describe("回合错误提示", () => {
  it("把额度用完和其他失败说成能看懂的话", () => {
    assert.equal(
      explainCodexError({ message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded" }),
      "额度已用完，这一轮没有完成。 You've hit your usage limit.",
    );
    assert.match(
      explainCodexError({ message: "upstream 503", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 503 } } }),
      /^连接模型失败。/,
    );
    assert.equal(explainCodexError({ message: "目录不存在 ghp_secret" }), "目录不存在 [redacted]");
    const completed = readTurnCompletion({
      threadId: "thr",
      turn: { id: "turn", status: "failed", error: { message: "rate limit", codexErrorInfo: "usageLimitExceeded" } },
    });
    assert.equal(completed.status, "failed");
    assert.match(completed.error ?? "", /额度已用完/);
    assert.equal(readTurnCompletion({ turn: { id: "turn", status: "completed" } }).error, undefined);
    assert.match(readFailureNotice({ error: { message: "quota exceeded" } }).error, /额度已用完/);
  });

  it("失败原因留在当前任务上，成功后不再带着", async () => {
    const harness = await startHarness();
    try {
      const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
      const created = await request(harness.port, "POST", "/api/projects", { name: "甲", path: harness.root }, login.cookie);
      const projectId = (created.json.project as { id: number }).id;
      const started = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "跑一下" }, login.cookie);
      const threadId = String(started.json.threadId);
      const turnId = String(started.json.turnId);
      const explained = explainCodexError({ message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded" });
      harness.engine.emit({ type: "failure", threadId, turnId, error: explained });
      const taskOf = (body: { task?: unknown }) => body.task as { status: string; error: string | null };
      const midway = await request(harness.port, "GET", `/api/threads/${threadId}/timeline`, undefined, login.cookie);
      assert.equal(taskOf(midway.json).status, "running");
      assert.match(String(taskOf(midway.json).error), /额度已用完/);
      harness.engine.emit({ type: "turn", threadId: "", turnId, status: "failed" });
      const failed = await request(harness.port, "GET", `/api/threads/${threadId}/timeline`, undefined, login.cookie);
      assert.equal(taskOf(failed.json).status, "failed");
      assert.match(String(taskOf(failed.json).error), /额度已用完/);
      const again = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "再来", threadId }, login.cookie);
      harness.engine.emit({ type: "turn", threadId, turnId: String(again.json.turnId), status: "completed" });
      const done = await request(harness.port, "GET", `/api/threads/${threadId}/timeline`, undefined, login.cookie);
      assert.equal(taskOf(done.json).status, "completed");
      assert.equal(taskOf(done.json).error, null);
      harness.engine.startTurn = async () => {
        throw new Error("You've hit your usage limit");
      };
      const denied = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "还有", threadId }, login.cookie);
      assert.equal(denied.status, 400);
      assert.match(String(denied.json.error), /额度已用完/);
    } finally {
      await harness.close();
    }
  });
});

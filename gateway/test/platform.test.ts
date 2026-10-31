import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../src/config.ts";
import { openDatabase, tableNames } from "../src/db.ts";
import { resolveProjectPath } from "../src/paths.ts";
import { request, startHarness } from "./harness.ts";

const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("配置", () => {
  it("缺少必填项时拒绝启动", async () => {
    assert.throws(() => parseConfig({ bindHost: "127.0.0.1" }), /配置缺少必填项/);
    const dir = mkdtempSync(path.join(tmpdir(), "codex-web-config-"));
    const configPath = path.join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ bindHost: "127.0.0.1", bindPort: 8787 }));
    const indexPath = path.join(gatewayRoot, "src", "index.ts");
    const output = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", "--experimental-transform-types", indexPath, configPath], {
        cwd: gatewayRoot,
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stderr }));
    });
    assert.notEqual(output.code, 0);
    assert.match(output.stderr, /配置缺少必填项/);
  });
});

describe("平台数据与登录", () => {
  it("只创建平台表，不创建会话正文表", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "codex-web-db-"));
    const db = openDatabase(dir);
    const names = tableNames(db);
    db.close();
    for (const name of ["users", "sessions", "projects", "tasks", "approvals"]) {
      assert.ok(names.includes(name), name);
    }
    assert.equal(names.some((name) => /message|conversation|transcript|timeline/i.test(name)), false);
  });

  it("正确密码进入工作区，错误密码不建立会话，退出后不能再读项目", async () => {
    const harness = await startHarness();
    try {
      const wrong = await request(harness.port, "POST", "/api/login", { password: "nope" });
      assert.equal(wrong.status, 401);
      const sessions = harness.db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number };
      assert.equal(sessions.count, 0);

      const loggedIn = await request(harness.port, "POST", "/api/login", { password: "secret" });
      assert.equal(loggedIn.status, 200);
      const created = await request(harness.port, "POST", "/api/projects", { name: "demo", path: harness.root }, loggedIn.cookie);
      assert.equal(created.status, 201);

      const visible = await request(harness.port, "GET", "/api/projects", undefined, loggedIn.cookie);
      assert.equal(visible.status, 200);
      assert.match(JSON.stringify(visible.json), /demo/);

      const loggedOut = await request(harness.port, "POST", "/api/logout", {}, loggedIn.cookie);
      assert.equal(loggedOut.status, 200);
      const after = await request(harness.port, "GET", "/api/projects", undefined, loggedIn.cookie);
      assert.equal(after.status, 401);
      assert.equal(JSON.stringify(after.json).includes("demo"), false);
    } finally {
      await harness.close();
    }
  });

  it("匿名请求不能读取项目、会话、任务和审批", async () => {
    const harness = await startHarness();
    try {
      const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
      await request(harness.port, "POST", "/api/projects", { name: "hidden", path: harness.root }, login.cookie);
      const paths = ["/api/projects", "/api/projects/1/threads", "/api/threads/thr_1/timeline", "/api/approvals/appr"];
      for (const pathname of paths) {
        const response = await request(harness.port, pathname.endsWith("/appr") ? "POST" : "GET", pathname, pathname.endsWith("/appr") ? { decision: "accept" } : undefined);
        assert.equal(response.status, 401, pathname);
        assert.equal(JSON.stringify(response.json).includes("hidden"), false);
      }
    } finally {
      await harness.close();
    }
  });
});

describe("Codex 网关", () => {
  it("版本不符时拒绝启动，新建会话出现在列表中", async () => {
    await assert.rejects(() => startHarness({ version: "0.0.1", allowed: ["9.9.9-test"] }), /不在允许范围内/);

    const harness = await startHarness();
    try {
      const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
      const created = await request(harness.port, "POST", "/api/projects", { name: "demo", path: harness.root }, login.cookie);
      const project = created.json.project as { id: number };
      const started = await request(
        harness.port,
        "POST",
        `/api/projects/${project.id}/threads`,
        { text: "你好" },
        login.cookie,
      );
      assert.equal(started.status, 201);
      const listed = await request(harness.port, "GET", `/api/projects/${project.id}/threads`, undefined, login.cookie);
      const threads = listed.json.threads as { id: string }[];
      assert.equal(threads.some((thread) => thread.id === (started.json.threadId as string)), true);
      harness.engine.emit({
        type: "turn",
        threadId: String(started.json.threadId),
        turnId: String(started.json.turnId),
        status: "completed",
      });
      const removed = await request(
        harness.port,
        "POST",
        `/api/threads/${started.json.threadId}/delete`,
        { projectId: project.id },
        login.cookie,
      );
      assert.equal(removed.status, 200);
      const after = await request(harness.port, "GET", `/api/projects/${project.id}/threads`, undefined, login.cookie);
      const remaining = after.json.threads as { id: string }[];
      assert.equal(remaining.some((thread) => thread.id === (started.json.threadId as string)), false);
    } finally {
      await harness.close();
    }
  });

  it("拒绝根目录外的路径，并在已有任务时拒绝第二个 turn", async () => {
    const harness = await startHarness();
    const outside = mkdtempSync(path.join(tmpdir(), "codex-web-outside-"));
    try {
      assert.throws(() => resolveProjectPath(outside, [harness.root]), /项目路径不在允许的根目录内/);
      const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
      const rejected = await request(harness.port, "POST", "/api/projects", { name: "bad", path: outside }, login.cookie);
      assert.equal(rejected.status, 400);
      const created = await request(harness.port, "POST", "/api/projects", { name: "demo", path: harness.root }, login.cookie);
      const project = created.json.project as { id: number };
      const first = await request(harness.port, "POST", `/api/projects/${project.id}/threads`, { text: "第一句" }, login.cookie);
      assert.equal(first.status, 201);
      const second = await request(harness.port, "POST", `/api/projects/${project.id}/threads`, { text: "第二句" }, login.cookie);
      assert.equal(second.status, 409);
      assert.equal(harness.engine.startTurnCalls, 1);
      const task = harness.db.prepare("SELECT status FROM tasks WHERE id = ?").get(Number(first.json.taskId)) as { status: string };
      assert.equal(task.status, "running");
      harness.engine.emit({
        type: "approval",
        threadId: String(first.json.threadId),
        turnId: String(first.json.turnId),
        approvalId: "appr-busy",
        kind: "command",
        text: "ls",
      });
      const third = await request(harness.port, "POST", `/api/projects/${project.id}/threads`, { text: "第三句" }, login.cookie);
      assert.equal(third.status, 409);
      const waiting = harness.db.prepare("SELECT status FROM tasks WHERE id = ?").get(Number(first.json.taskId)) as { status: string };
      assert.equal(waiting.status, "waiting_approval");
      assert.equal(harness.engine.startTurnCalls, 1);
    } finally {
      await harness.close();
    }
  });

  it("断开后仍可提交审批，重连时先返回已落盘记录再返回进行中的输出", async () => {
    const harness = await startHarness();
    try {
      const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
      const created = await request(harness.port, "POST", "/api/projects", { name: "demo", path: harness.root }, login.cookie);
      const project = created.json.project as { id: number };
      const started = await request(harness.port, "POST", `/api/projects/${project.id}/threads`, { text: "执行" }, login.cookie);
      const threadId = started.json.threadId as string;
      const turnId = started.json.turnId as string;
      harness.engine.persisted.get(threadId)?.push({ id: "persisted-1", kind: "userMessage", text: "执行" });
      harness.engine.pushLive(threadId, { id: "live-1", kind: "commandExecution", text: "npm test\nrunning" });
      harness.engine.emit({
        type: "approval",
        threadId,
        turnId,
        approvalId: "appr-1",
        kind: "command",
        text: "npm test",
      });

      const firstView = await request(harness.port, "GET", `/api/threads/${threadId}/timeline`, undefined, login.cookie);
      const items = firstView.json.items as { id: string }[];
      const ids = items.map((item) => item.id);
      const persistedIndex = ids.indexOf("persisted-1");
      const liveIndex = ids.indexOf("live-1");
      assert.ok(persistedIndex >= 0 && liveIndex > persistedIndex);

      const dropped = harness.runtime.subscribe(() => undefined);
      dropped();
      const decision = await request(harness.port, "POST", "/api/approvals/appr-1", { decision: "accept" }, login.cookie);
      assert.equal(decision.status, 200);
      assert.deepEqual(harness.engine.approvalCalls, [{ approvalId: "appr-1", decision: "accept" }]);

      const again = await request(harness.port, "GET", `/api/threads/${threadId}/timeline`, undefined, login.cookie);
      const againIds = (again.json.items as { id: string }[]).map((item) => item.id);
      assert.ok(againIds.indexOf("live-1") > againIds.indexOf("persisted-1"));
    } finally {
      await harness.close();
    }
  });

  it("app-server 消失时标记 interrupted 且不自动重放，原会话仍可继续", async () => {
    const harness = await startHarness();
    try {
      const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
      const created = await request(harness.port, "POST", "/api/projects", { name: "demo", path: harness.root }, login.cookie);
      const project = created.json.project as { id: number };
      const started = await request(harness.port, "POST", `/api/projects/${project.id}/threads`, { text: "长任务" }, login.cookie);
      const calls = harness.engine.startTurnCalls;
      harness.engine.crash();
      const task = harness.db.prepare("SELECT status FROM tasks WHERE thread_id = ?").get(String(started.json.threadId)) as { status: string };
      assert.equal(task.status, "interrupted");
      assert.equal(harness.engine.startTurnCalls, calls);
      const continued = await request(
        harness.port,
        "POST",
        `/api/projects/${project.id}/threads`,
        { text: "继续", threadId: started.json.threadId },
        login.cookie,
      );
      assert.equal(continued.status, 201);
      assert.equal(continued.json.threadId, started.json.threadId);
      assert.equal(harness.engine.startTurnCalls, calls + 1);
    } finally {
      await harness.close();
    }
  });

  it("浏览器断开不中断 turn，白名单外的方法不会转发", async () => {
    const harness = await startHarness();
    try {
      const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
      const created = await request(harness.port, "POST", "/api/projects", { name: "demo", path: harness.root }, login.cookie);
      const project = created.json.project as { id: number };
      const started = await request(harness.port, "POST", `/api/projects/${project.id}/threads`, { text: "保持运行" }, login.cookie);
      const before = harness.engine.invocations.length;
      const raw = await request(harness.port, "POST", "/api/engine", { method: "turn/start", params: {} }, login.cookie);
      assert.equal(raw.status, 403);
      assert.equal(harness.engine.invocations.length, before);

      await new Promise<void>((resolve, reject) => {
        const requestStream = fetch(`http://127.0.0.1:${harness.port}/api/threads/${started.json.threadId}/events`, {
          headers: { cookie: login.cookie ?? "" },
        });
        requestStream
          .then(async (response) => {
            assert.equal(response.status, 200);
            await response.body?.cancel();
            resolve();
          })
          .catch(reject);
      });
      const task = harness.db.prepare("SELECT status FROM tasks WHERE id = ?").get(Number(started.json.taskId)) as { status: string };
      assert.equal(task.status, "running");
      assert.equal(harness.engine.interruptCalls, 0);
    } finally {
      await harness.close();
    }
  });

  it("Codex 未登录时不创建执行中的任务", async () => {
    const harness = await startHarness({ loggedIn: false });
    try {
      const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
      const account = await request(harness.port, "GET", "/api/account", undefined, login.cookie);
      assert.equal((account.json as { loggedIn: boolean }).loggedIn, false);
      const created = await request(harness.port, "POST", "/api/projects", { name: "demo", path: harness.root }, login.cookie);
      const project = created.json.project as { id: number };
      const started = await request(harness.port, "POST", `/api/projects/${project.id}/threads`, { text: "不应该开始" }, login.cookie);
      assert.equal(started.status, 409);
      assert.match(String(started.json.error), /登录 Codex/);
      const count = harness.db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
      assert.equal(count.count, 0);
      assert.equal(harness.engine.startTurnCalls, 0);
    } finally {
      await harness.close();
    }
  });
});


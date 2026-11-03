import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setGitRunner } from "../src/git.ts";
import { mergeTimeline } from "../src/runtime.ts";
import { request, startHarness } from "./harness.ts";

function gitRepo(root: string): string {
  const repo = path.join(root, "repo");
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.email", "codex-web@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "codex-web"], { cwd: root });
  writeFileSync(path.join(root, "readme.txt"), "hello\n");
  execFileSync("git", ["add", "readme.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });
  void repo;
  return root;
}

async function loginProject(git = false) {
  const harness = await startHarness();
  if (git) gitRepo(harness.root);
  const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
  const created = await request(harness.port, "POST", "/api/projects", { name: "demo", path: harness.root }, login.cookie);
  const project = created.json.project as { id: number };
  return { harness, cookie: login.cookie, projectId: project.id };
}

describe("并行、队列和检出", () => {
  it("完成后才跑队列，停止和重启都不自动开跑", async () => {
    const { harness, cookie, projectId } = await loginProject();
    try {
      const started = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "第一句" }, cookie);
      const threadId = String(started.json.threadId);
      const queued = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "排队的一句", threadId }, cookie);
      assert.equal(queued.json.queued, true);
      await request(harness.port, "POST", `/api/threads/${threadId}/interrupt`, {}, cookie);
      await harness.runtime.whenIdle();
      assert.equal(harness.engine.startTurnCalls, 1);
      const stopped = harness.db.prepare("SELECT status FROM tasks WHERE thread_id = ?").get(threadId) as { status: string };
      assert.equal(stopped.status, "interrupted");
      const stillQueued = harness.db.prepare("SELECT COUNT(*) AS count FROM thread_queue WHERE thread_id = ?").get(threadId) as { count: number };
      assert.equal(stillQueued.count, 1);

      const again = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "继续", threadId }, cookie);
      assert.equal(again.status, 201);
      const second = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "完成后再说", threadId }, cookie);
      assert.equal(second.json.queued, true);
      harness.engine.emit({ type: "turn", threadId, turnId: String(again.json.turnId), status: "completed" });
      await harness.runtime.whenIdle();
      assert.equal(harness.engine.startTurnCalls, 3);
      harness.engine.crash();
      await harness.runtime.whenIdle();
      assert.equal(harness.engine.startTurnCalls, 3);
    } finally {
      await harness.close();
    }
  });

  it("两条活动任务在进程退出时都标成中断", async () => {
    const { harness, cookie, projectId } = await loginProject();
    try {
      const first = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "甲" }, cookie);
      const second = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "乙" }, cookie);
      const calls = harness.engine.startTurnCalls;
      harness.engine.crash();
      const rows = harness.db.prepare("SELECT status FROM tasks ORDER BY id").all() as { status: string }[];
      assert.deepEqual(rows.map((row) => row.status), ["interrupted", "interrupted"]);
      assert.equal(harness.engine.startTurnCalls, calls);
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
    } finally {
      await harness.close();
    }
  });

  it("Git 仓库默认单独检出，显式目录和普通目录不创建 worktree", async () => {
    const { harness, cookie, projectId } = await loginProject(true);
    try {
      const worktree = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "默认检出", cwd: harness.root }, cookie);
      assert.equal(worktree.status, 201);
      const place = harness.db.prepare("SELECT mode, cwd, branch FROM thread_places WHERE thread_id = ?").get(String(worktree.json.threadId)) as {
        mode: string;
        cwd: string;
        branch: string;
      };
      assert.equal(place.mode, "worktree");
      assert.equal(place.branch.startsWith("codex/"), true);
      const beside = path.join(path.dirname(harness.root), `${path.basename(harness.root)}-worktrees`);
      assert.equal(place.cwd.startsWith(beside), true);
      assert.equal(place.cwd.includes(place.branch.replaceAll("/", "-")), true);
      assert.equal(place.cwd === harness.root || place.cwd.startsWith(`${harness.root}${path.sep}`), false);
      assert.equal(existsSync(place.cwd), true);

      harness.engine.emit({ type: "turn", threadId: String(worktree.json.threadId), turnId: String(worktree.json.turnId), status: "completed" });
      const local = await request(
        harness.port,
        "POST",
        `/api/projects/${projectId}/threads`,
        { text: "直接改目录", directory: "local" },
        cookie,
      );
      const localPlace = harness.db.prepare("SELECT mode, cwd FROM thread_places WHERE thread_id = ?").get(String(local.json.threadId)) as {
        mode: string;
        cwd: string;
      };
      assert.equal(localPlace.mode, "local");
      assert.equal(localPlace.cwd, harness.root);
    } finally {
      await harness.close();
    }
    const plain = await loginProject(false);
    try {
      const started = await request(plain.harness.port, "POST", `/api/projects/${plain.projectId}/threads`, { text: "普通目录" }, plain.cookie);
      const place = plain.harness.db.prepare("SELECT mode, cwd FROM thread_places WHERE thread_id = ?").get(String(started.json.threadId)) as {
        mode: string;
        cwd: string;
      };
      assert.equal(place.mode, "local");
      assert.equal(place.cwd, plain.harness.root);
    } finally {
      await plain.harness.close();
    }
  });

  it("删除先移除检出，失败则保留；归档不删目录", async () => {
    const { harness, cookie, projectId } = await loginProject(true);
    try {
      const started = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "要归档" }, cookie);
      const threadId = String(started.json.threadId);
      harness.engine.emit({ type: "turn", threadId, turnId: String(started.json.turnId), status: "completed" });
      const place = harness.db.prepare("SELECT cwd FROM thread_places WHERE thread_id = ?").get(threadId) as { cwd: string };
      const running = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "还在跑", threadId }, cookie);
      const denied = await request(harness.port, "POST", `/api/threads/${threadId}/delete`, { projectId }, cookie);
      assert.equal(denied.status, 409);
      assert.equal(existsSync(place.cwd), true);
      harness.engine.emit({ type: "turn", threadId, turnId: String(running.json.turnId), status: "completed" });

      await request(harness.port, "POST", `/api/threads/${threadId}/archive`, { projectId }, cookie);
      const hidden = await request(harness.port, "GET", `/api/projects/${projectId}/threads`, undefined, cookie);
      assert.equal((hidden.json.threads as { id: string }[]).some((thread) => thread.id === threadId), false);
      assert.equal(existsSync(place.cwd), true);
      const archived = await request(harness.port, "GET", `/api/projects/${projectId}/threads?archived=1`, undefined, cookie);
      assert.equal((archived.json.threads as { id: string }[]).some((thread) => thread.id === threadId), true);
      await request(harness.port, "POST", `/api/threads/${threadId}/unarchive`, { projectId }, cookie);
      const back = await request(harness.port, "GET", `/api/projects/${projectId}/threads`, undefined, cookie);
      assert.equal((back.json.threads as { id: string }[]).some((thread) => thread.id === threadId), true);

      setGitRunner(() => Promise.reject(new Error("remove failed")));
      const failed = await request(harness.port, "POST", `/api/threads/${threadId}/delete`, { projectId }, cookie);
      assert.equal(failed.status, 400);
      const kept = await request(harness.port, "GET", `/api/projects/${projectId}/threads`, undefined, cookie);
      assert.equal((kept.json.threads as { id: string }[]).some((thread) => thread.id === threadId), true);
      setGitRunner(null);
      const removed = await request(harness.port, "POST", `/api/threads/${threadId}/delete`, { projectId }, cookie);
      assert.equal(removed.status, 200);
      assert.equal(existsSync(place.cwd), false);
    } finally {
      setGitRunner(null);
      await harness.close();
    }
  });

  it("会话级允许只跳过同类审批", async () => {
    const { harness, cookie, projectId } = await loginProject();
    try {
      const started = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "跑命令" }, cookie);
      const threadId = String(started.json.threadId);
      const turnId = String(started.json.turnId);
      harness.engine.emit({
        type: "approval",
        threadId,
        turnId,
        approvalId: "cmd-1",
        kind: "item/commandExecution/requestApproval",
        text: "npm test",
      });
      const once = await request(harness.port, "POST", "/api/approvals/cmd-1", { decision: "accept" }, cookie);
      assert.equal(once.status, 200);
      harness.engine.emit({
        type: "approval",
        threadId,
        turnId,
        approvalId: "cmd-2",
        kind: "item/commandExecution/requestApproval",
        text: "npm test",
      });
      const pending = await request(harness.port, "GET", `/api/threads/${threadId}/timeline`, undefined, cookie);
      assert.equal((pending.json.approvals as { id: string }[]).some((item) => item.id === "cmd-2"), true);
      await request(harness.port, "POST", "/api/approvals/cmd-2", { decision: "acceptForSession" }, cookie);
      harness.engine.emit({
        type: "approval",
        threadId,
        turnId,
        approvalId: "cmd-3",
        kind: "item/commandExecution/requestApproval",
        text: "npm test",
      });
      await harness.runtime.whenIdle();
      const skipped = await request(harness.port, "GET", `/api/threads/${threadId}/timeline`, undefined, cookie);
      assert.equal((skipped.json.approvals as { id: string }[]).some((item) => item.id === "cmd-3"), false);
      assert.equal(harness.engine.approvalCalls.some((call) => call.approvalId === "cmd-3" && call.decision === "accept"), true);
      harness.engine.emit({
        type: "approval",
        threadId,
        turnId,
        approvalId: "file-1",
        kind: "item/fileChange/requestApproval",
        text: "readme.txt",
      });
      const fileAsk = await request(harness.port, "GET", `/api/threads/${threadId}/timeline`, undefined, cookie);
      assert.equal((fileAsk.json.approvals as { id: string }[]).some((item) => item.id === "file-1"), true);
    } finally {
      await harness.close();
    }
  });

  it("改过的模型会传给引擎，没改过的不会", async () => {
    const { harness, cookie, projectId } = await loginProject();
    try {
      const started = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "先这样" }, cookie);
      assert.equal(harness.engine.applied.length, 0);
      const threadId = String(started.json.threadId);
      harness.engine.emit({ type: "turn", threadId, turnId: String(started.json.turnId), status: "completed" });
      await request(harness.port, "POST", `/api/threads/${threadId}/settings`, { model: "gpt-test", sandbox: "workspace-write", approvalPolicy: "on-request" }, cookie);
      await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "换模型", threadId }, cookie);
      assert.equal(harness.engine.applied.at(-1)?.launch.model, "gpt-test");
      assert.equal(harness.engine.applied.at(-1)?.launch.sandbox, "workspace-write");
      assert.equal(harness.engine.applied.at(-1)?.launch.approvalPolicy, "on-request");
    } finally {
      await harness.close();
    }
  });

  it("长提示收成短标题，分叉保留原会话", async () => {
    const { harness, cookie, projectId } = await loginProject(true);
    try {
      const prompt = "请把侧栏标题收短，不要把这整句提示原样放在列表里。";
      const started = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: prompt }, cookie);
      const threadId = String(started.json.threadId);
      const listed = await request(harness.port, "GET", `/api/projects/${projectId}/threads`, undefined, cookie);
      const thread = (listed.json.threads as { id: string; title: string; status: string }[]).find((item) => item.id === threadId);
      assert.ok(thread);
      assert.notEqual(thread?.title, prompt);
      assert.equal(JSON.stringify(listed.json).includes("今天"), false);
      assert.equal(JSON.stringify(listed.json).includes("dateGroup"), false);
      const view = await request(harness.port, "GET", `/api/threads/${threadId}/timeline`, undefined, cookie);
      assert.equal((view.json.items as { text: string }[]).some((item) => item.text === prompt), true);
      await request(harness.port, "POST", `/api/threads/${threadId}/rename`, { projectId, name: "短名字" }, cookie);
      const renamed = await request(harness.port, "GET", `/api/projects/${projectId}/threads`, undefined, cookie);
      assert.equal((renamed.json.threads as { id: string; title: string }[]).find((item) => item.id === threadId)?.title, "短名字");
      const still = await request(harness.port, "GET", `/api/threads/${threadId}/timeline`, undefined, cookie);
      assert.equal((still.json.items as { text: string }[]).some((item) => item.text === prompt), true);
      harness.engine.emit({ type: "turn", threadId, turnId: String(started.json.turnId), status: "completed" });
      const forked = await request(harness.port, "POST", `/api/threads/${threadId}/fork`, { projectId }, cookie);
      const after = await request(harness.port, "GET", `/api/projects/${projectId}/threads`, undefined, cookie);
      const ids = (after.json.threads as { id: string }[]).map((item) => item.id);
      assert.equal(ids.includes(threadId), true);
      assert.equal(ids.includes(String(forked.json.threadId)), true);
      const forkPlace = harness.db.prepare("SELECT cwd, mode FROM thread_places WHERE thread_id = ?").get(String(forked.json.threadId)) as {
        cwd: string;
        mode: string;
      };
      assert.equal(forkPlace.mode, "worktree");
      assert.notEqual(forkPlace.cwd, harness.root);
    } finally {
      await harness.close();
    }
  });

  it("落盘里的空正文不会盖住已经流过来的文字", () => {
    const merged = mergeTimeline(
      [{ id: "msg-1", kind: "agentMessage", text: "" }],
      [{ id: "msg-1", kind: "agentMessage", text: "好" }],
    );
    assert.equal(merged[0]?.text, "好");
  });

  it("增量文字在条目完成前就出现在时间线里", async () => {
    const { harness, cookie, projectId } = await loginProject();
    try {
      const started = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "说一个字" }, cookie);
      const threadId = String(started.json.threadId);
      harness.engine.emit({ type: "delta", threadId, itemId: "msg-1", kind: "agentMessage", text: "好" });
      const view = await request(harness.port, "GET", `/api/threads/${threadId}/timeline`, undefined, cookie);
      const partial = (view.json.items as { id: string; text: string }[]).find((item) => item.id === "msg-1");
      assert.equal(partial?.text, "好");
      const stream = await fetch(`http://127.0.0.1:${harness.port}/api/threads/${threadId}/events`, {
        headers: { cookie: cookie ?? "" },
      });
      assert.equal(stream.status, 200);
      const reader = stream.body?.getReader();
      if (!reader) throw new Error("没有事件流");
      const decoder = new TextDecoder();
      let buffer = "";
      const nextEvent = async () => {
        while (!buffer.includes("\n\n")) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("事件流提前结束");
          buffer += decoder.decode(chunk.value, { stream: true });
        }
        const split = buffer.indexOf("\n\n");
        const raw = buffer.slice(0, split).replace(/^data: /, "");
        buffer = buffer.slice(split + 2);
        return JSON.parse(raw) as { type?: string; text?: string; items?: unknown };
      };
      await nextEvent();
      const listsBefore = harness.engine.invocations.filter((name) => name === "listPersistedItems").length;
      harness.engine.emit({ type: "delta", threadId, itemId: "msg-1", kind: "agentMessage", text: "的" });
      const streamed = await nextEvent();
      assert.equal(streamed.type, "delta");
      assert.equal(streamed.text, "的");
      assert.equal(streamed.items, undefined);
      assert.equal(harness.engine.invocations.filter((name) => name === "listPersistedItems").length, listsBefore);
      await reader.cancel();
    } finally {
      await harness.close();
    }
  });

  it("Git diff 能返回，普通目录拒绝提交，失败里没有凭据", async () => {
    const { harness, cookie, projectId } = await loginProject(true);
    try {
      const started = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "看 diff", directory: "local" }, cookie);
      const threadId = String(started.json.threadId);
      writeFileSync(path.join(harness.root, "readme.txt"), "hello\nchanged\n");
      const diff = await request(harness.port, "POST", `/api/threads/${threadId}/git`, { projectId, action: "diff" }, cookie);
      assert.match(String(diff.json.diff), /changed/);
      const pr = await request(harness.port, "POST", `/api/threads/${threadId}/git`, { projectId, action: "pr", title: "更新" }, cookie);
      assert.equal(pr.json.url, undefined);
      assert.equal(String(pr.json.error ?? "").includes("ghp_"), false);
      assert.match(String(pr.json.error), /不存在|gh|pull request|failed|error/i);
    } finally {
      await harness.close();
    }
    const plain = await loginProject(false);
    try {
      const started = await request(plain.harness.port, "POST", `/api/projects/${plain.projectId}/threads`, { text: "提交" }, plain.cookie);
      const commit = await request(
        plain.harness.port,
        "POST",
        `/api/threads/${started.json.threadId}/git`,
        { projectId: plain.projectId, action: "commit", message: "nope" },
        plain.cookie,
      );
      assert.equal(commit.status, 400);
      assert.match(String(commit.json.error), /不是 Git 仓库/);
    } finally {
      await plain.harness.close();
    }
  });

  it("白名单外的方法不会转发", async () => {
    const { harness, cookie } = await loginProject();
    try {
      const before = harness.engine.invocations.length;
      const raw = await request(harness.port, "POST", "/api/engine", { method: "thread/fork" }, cookie);
      assert.equal(raw.status, 403);
      assert.equal(harness.engine.invocations.length, before);
    } finally {
      await harness.close();
    }
  });
});

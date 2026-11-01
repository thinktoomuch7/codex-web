import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { request, startHarness } from "./harness.ts";

async function loginProject() {
  const harness = await startHarness();
  const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
  const created = await request(harness.port, "POST", "/api/projects", { name: "甲项目", path: harness.root }, login.cookie);
  const project = created.json.project as { id: number };
  return { harness, cookie: login.cookie, projectId: project.id };
}

describe("最近列表和时间线窗口", () => {
  it("两个项目的会话按最近活动排在一起", async () => {
    const { harness, cookie, projectId } = await loginProject();
    try {
      const nested = path.join(harness.root, "nested-b");
      mkdirSync(nested, { recursive: true });
      const created = await request(harness.port, "POST", "/api/projects", { name: "乙项目", path: nested }, cookie);
      const otherId = (created.json.project as { id: number }).id;
      const older = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "先说甲" }, cookie);
      const newer = await request(harness.port, "POST", `/api/projects/${otherId}/threads`, { text: "再说乙" }, cookie);
      harness.db.prepare("UPDATE tasks SET updated_at = ? WHERE thread_id = ?").run(1, String(older.json.threadId));
      const listed = await request(harness.port, "GET", "/api/threads/recent", undefined, cookie);
      const threads = listed.json.threads as { id: string; title: string; projectName: string; updatedAt: number }[];
      assert.equal(threads[0]?.id, String(newer.json.threadId));
      assert.equal(threads[1]?.id, String(older.json.threadId));
      assert.equal(threads[0]?.projectName, "乙项目");
      assert.equal(threads[1]?.projectName, "甲项目");
      assert.equal(JSON.stringify(listed.json).includes("dateGroup"), false);
      assert.equal(JSON.stringify(listed.json).includes("cwd"), false);
      assert.equal(threads[0] && "dateGroup" in threads[0], false);
    } finally {
      await harness.close();
    }
  });

  it("打开时补记引擎里的会话，正文片段不再列出全部会话", async () => {
    const { harness, cookie, projectId } = await loginProject();
    try {
      harness.engine.threads.push({ id: "from-engine", cwd: harness.root, title: "引擎里的一条很长的会话标题需要收短处理才不会占满侧栏" });
      const synced = await request(harness.port, "POST", "/api/threads/recent/sync", {}, cookie);
      const threads = synced.json.threads as { id: string; title: string; projectName: string }[];
      const found = threads.find((thread) => thread.id === "from-engine");
      assert.equal(found?.projectName, "甲项目");
      assert.notEqual(found?.title, "引擎里的一条很长的会话标题需要收短处理才不会占满侧栏");
      assert.equal(found?.title.endsWith("…"), true);
      const lists = () => harness.engine.invocations.filter((name) => name === "listThreads").length;
      const before = lists();
      harness.engine.emit({ type: "delta", threadId: "from-engine", itemId: "m", kind: "agentMessage", text: "字" });
      const again = await request(harness.port, "GET", "/api/threads/recent", undefined, cookie);
      assert.equal(again.status, 200);
      assert.equal(lists(), before);
      assert.equal(projectId > 0, true);
    } finally {
      await harness.close();
    }
  });

  it("时间线只返回末尾窗口，更早的记录还在", async () => {
    const { harness, cookie, projectId } = await loginProject();
    try {
      const started = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "窗口" }, cookie);
      const threadId = String(started.json.threadId);
      const persisted = Array.from({ length: 45 }, (_, index) => ({
        id: `n${index}`,
        kind: "userMessage",
        text: `t${index}`,
      }));
      harness.engine.persisted.set(threadId, persisted);
      const view = await request(harness.port, "GET", `/api/threads/${threadId}/timeline`, undefined, cookie);
      const items = view.json.items as { id: string }[];
      assert.equal(items.length, 40);
      assert.equal(items[0]?.id, "n5");
      assert.equal(view.json.older, true);
      assert.ok(view.json.task);
      const earlier = await request(harness.port, "GET", `/api/threads/${threadId}/timeline?before=n5`, undefined, cookie);
      const olderItems = earlier.json.items as { id: string }[];
      assert.equal(olderItems.length, 5);
      assert.equal(olderItems[0]?.id, "n0");
      assert.equal(earlier.json.older, false);
      assert.equal(harness.engine.persisted.get(threadId)?.length, 45);
    } finally {
      await harness.close();
    }
  });

  it("重连先给已有记录，之后的片段不含整份时间线", async () => {
    const { harness, cookie, projectId } = await loginProject();
    try {
      const started = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "流" }, cookie);
      const threadId = String(started.json.threadId);
      harness.engine.emit({ type: "delta", threadId, itemId: "msg-1", kind: "agentMessage", text: "好" });
      const open = async () => {
        const stream = await fetch(`http://127.0.0.1:${harness.port}/api/threads/${threadId}/events`, {
          headers: { cookie: cookie ?? "" },
        });
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
          return JSON.parse(raw) as { type?: string; text?: string; items?: { text: string }[] };
        };
        return { reader, nextEvent };
      };
      const first = await open();
      const snapshot = await first.nextEvent();
      assert.equal(snapshot.type, undefined);
      assert.equal(snapshot.items?.some((item) => item.text.includes("好")), true);
      const listsBefore = harness.engine.invocations.filter((name) => name === "listPersistedItems").length;
      harness.engine.emit({ type: "delta", threadId, itemId: "msg-1", kind: "agentMessage", text: "的" });
      const streamed = await first.nextEvent();
      assert.equal(streamed.type, "delta");
      assert.equal(streamed.text, "的");
      assert.equal(streamed.items, undefined);
      assert.equal(harness.engine.invocations.filter((name) => name === "listPersistedItems").length, listsBefore);
      await first.reader.cancel();
      const second = await open();
      const restored = await second.nextEvent();
      assert.equal(restored.items?.some((item) => item.text.includes("好的")), true);
      harness.engine.emit({ type: "delta", threadId, itemId: "msg-1", kind: "agentMessage", text: "呀" });
      const tail = await second.nextEvent();
      assert.equal(tail.type, "delta");
      assert.equal(tail.items, undefined);
      await second.reader.cancel();
      const still = harness.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = 'running'").get() as { count: number };
      const another = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "同时再来一条" }, cookie);
      assert.equal(another.status, 201);
      assert.equal(still.count >= 1, true);
    } finally {
      await harness.close();
    }
  });
});

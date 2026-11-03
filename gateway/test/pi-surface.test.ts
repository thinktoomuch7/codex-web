import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { OFFICIAL_EXTRAS } from "../src/codex/types.ts";
import { setTerminalBackend, terminalSession } from "../src/terminal.ts";
import { request, startHarness } from "./harness.ts";

describe("目录、文件和终端", () => {
  it("可以新建子目录，并拒绝会话目录之外的读取", async () => {
    const harness = await startHarness();
    const outside = mkdtempSync(path.join(tmpdir(), "codex-web-secret-"));
    writeFileSync(path.join(outside, "secret.txt"), "nope");
    try {
      const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
      const created = await request(harness.port, "POST", "/api/directories", { parent: harness.root, name: "child" }, login.cookie);
      assert.equal(created.status, 201);
      assert.equal(existsSync(path.join(harness.root, "child")), true);
      const project = await request(harness.port, "POST", "/api/projects", { name: "demo", path: harness.root }, login.cookie);
      const projectId = (project.json.project as { id: number }).id;
      const started = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "看文件", directory: "local" }, login.cookie);
      const threadId = String(started.json.threadId);
      writeFileSync(path.join(harness.root, "note.txt"), "hello");
      const listed = await request(harness.port, "GET", `/api/threads/${threadId}/files?projectId=${projectId}`, undefined, login.cookie);
      assert.equal((listed.json.entries as { name: string }[]).some((entry) => entry.name === "note.txt"), true);
      const preview = await request(harness.port, "GET", `/api/threads/${threadId}/file?projectId=${projectId}&path=note.txt`, undefined, login.cookie);
      assert.equal(preview.json.text, "hello");
      const escaped = await request(
        harness.port,
        "GET",
        `/api/threads/${threadId}/file?projectId=${projectId}&path=${encodeURIComponent("../secret.txt")}`,
        undefined,
        login.cookie,
      );
      assert.equal(escaped.status, 400);
      const uploaded = await request(
        harness.port,
        "POST",
        `/api/threads/${threadId}/files`,
        { projectId, path: "child/up.txt", data: Buffer.from("up").toString("base64") },
        login.cookie,
      );
      assert.equal(uploaded.status, 201);
      assert.equal(existsSync(path.join(harness.root, "child", "up.txt")), true);
    } finally {
      await harness.close();
    }
  });

  it("选中目录后不用开会话也能列出文件", async () => {
    const harness = await startHarness();
    const outside = mkdtempSync(path.join(tmpdir(), "codex-web-secret-"));
    writeFileSync(path.join(outside, "secret.txt"), "nope");
    try {
      const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
      const project = await request(harness.port, "POST", "/api/projects", { name: "demo", path: harness.root }, login.cookie);
      const projectId = (project.json.project as { id: number }).id;
      writeFileSync(path.join(harness.root, "note.txt"), "hello");
      const listed = await request(harness.port, "GET", `/api/projects/${projectId}/files`, undefined, login.cookie);
      assert.equal(listed.status, 200);
      assert.equal((listed.json.entries as { name: string }[]).some((entry) => entry.name === "note.txt"), true);
      const escaped = await request(
        harness.port,
        "GET",
        `/api/projects/${projectId}/files?path=${encodeURIComponent("../secret.txt")}`,
        undefined,
        login.cookie,
      );
      assert.equal(escaped.status, 400);
    } finally {
      await harness.close();
    }
  });

  it("终端把输出流回来，启动失败时返回原因", async () => {
    const harness = await startHarness();
    setTerminalBackend({
      start(cwd) {
        let push: (chunk: string) => void = () => undefined;
        return {
          write(data) {
            push(data);
          },
          close() {},
          onData(listener) {
            push = listener;
            listener(`cwd:${cwd}\n`);
          },
        };
      },
    });
    try {
      const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
      const project = await request(harness.port, "POST", "/api/projects", { name: "demo", path: harness.root }, login.cookie);
      const projectId = (project.json.project as { id: number }).id;
      const started = await request(harness.port, "POST", `/api/projects/${projectId}/threads`, { text: "终端", directory: "local" }, login.cookie);
      const threadId = String(started.json.threadId);
      const opened = await request(harness.port, "POST", `/api/threads/${threadId}/terminal`, { projectId }, login.cookie);
      assert.equal(opened.status, 201);
      await request(harness.port, "POST", `/api/threads/${threadId}/terminal/input`, { id: opened.json.id, data: "echo hi\n" }, login.cookie);
      const session = terminalSession(String(opened.json.id));
      assert.match(session?.output ?? "", new RegExp(harness.root.replaceAll("\\", "\\\\")));
      assert.match(session?.output ?? "", /echo hi/);
    } finally {
      setTerminalBackend(null);
      await harness.close();
    }

    setTerminalBackend({
      start() {
        throw new Error("终端启动失败。");
      },
    });
    const again = await startHarness();
    try {
      const login = await request(again.port, "POST", "/api/login", { password: "secret" });
      const project = await request(again.port, "POST", "/api/projects", { name: "demo", path: again.root }, login.cookie);
      const projectId = (project.json.project as { id: number }).id;
      const started = await request(again.port, "POST", `/api/projects/${projectId}/threads`, { text: "终端", directory: "local" }, login.cookie);
      const failed = await request(again.port, "POST", `/api/threads/${started.json.threadId}/terminal`, { projectId }, login.cookie);
      assert.equal(failed.status, 400);
      assert.match(String(failed.json.error), /终端启动失败/);
    } finally {
      setTerminalBackend(null);
      await again.close();
    }
  });

  it("当前协议没有用量、压缩和思考档位", async () => {
    const harness = await startHarness();
    try {
      const login = await request(harness.port, "POST", "/api/login", { password: "secret" });
      const extras = await request(harness.port, "GET", "/api/capabilities", undefined, login.cookie);
      assert.deepEqual(extras.json, OFFICIAL_EXTRAS);
      assert.equal(extras.json.usage, false);
      assert.equal(extras.json.compact, false);
      assert.equal(extras.json.thinking, false);
    } finally {
      await harness.close();
    }
  });
});

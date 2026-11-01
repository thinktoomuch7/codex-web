import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AppConfig } from "./config.ts";
import { FakeEngine } from "./codex/fake-engine.ts";
import { openDatabase } from "./db.ts";
import { startServer } from "./http.ts";
import { Runtime } from "./runtime.ts";

const base = mkdtempSync(path.join(tmpdir(), "codex-web-dev-"));
const root = path.join(base, "repo");
const plain = path.join(base, "plain");
mkdirSync(root);
mkdirSync(plain);
writeFileSync(path.join(root, "readme.txt"), "hello\n");
execFileSync("git", ["init"], { cwd: root });
execFileSync("git", ["config", "user.email", "codex-web@example.com"], { cwd: root });
execFileSync("git", ["config", "user.name", "codex-web"], { cwd: root });
execFileSync("git", ["add", "readme.txt"], { cwd: root });
execFileSync("git", ["commit", "-m", "init"], { cwd: root });
const dataDir = mkdtempSync(path.join(tmpdir(), "codex-web-dev-data-"));
const engine = new FakeEngine();
engine.loggedIn = process.env.CODEX_LOGGED_IN === "1";
engine.versionValue = "9.9.9-test";
const startTurn = engine.startTurn.bind(engine);
engine.startTurn = async (threadId, text) => {
  const result = await startTurn(threadId, text);
  engine.emit({ type: "delta", threadId, itemId: `msg-${result.turnId}`, kind: "agentMessage", text: "先" });
  engine.pushLive(threadId, {
    id: `cmd-${result.turnId}`,
    kind: "commandExecution",
    text: "npm test\nrunning",
  });
  engine.emit({
    type: "approval",
    threadId,
    turnId: result.turnId,
    approvalId: `appr-${result.turnId}`,
    kind: "command",
    text: "npm test",
  });
  return result;
};

const config: AppConfig = {
  bindHost: "127.0.0.1",
  bindPort: 8787,
  projectRoots: [base],
  appServerSocket: path.join(dataDir, "missing.sock"),
  allowedCodexVersions: [engine.versionValue],
  httpsProxy: "http://127.0.0.1:7890",
  username: "admin",
  password: "secret",
  dataDir,
};
const db = openDatabase(dataDir);
const runtime = new Runtime(db, engine, config);
await runtime.start();
runtime.addProject("示例项目", root);
runtime.addProject("普通目录", plain);
await startServer(config, runtime);
console.log(`fixture gateway http://127.0.0.1:8787 loggedIn=${engine.loggedIn}`);

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AppConfig } from "./config.ts";
import { FakeEngine } from "./codex/fake-engine.ts";
import { openDatabase } from "./db.ts";
import { startServer } from "./http.ts";
import { Runtime } from "./runtime.ts";

const root = mkdtempSync(path.join(tmpdir(), "codex-web-dev-"));
const dataDir = mkdtempSync(path.join(tmpdir(), "codex-web-dev-data-"));
const engine = new FakeEngine();
engine.loggedIn = process.env.CODEX_LOGGED_IN === "1";
engine.versionValue = "9.9.9-test";
const startTurn = engine.startTurn.bind(engine);
engine.startTurn = async (threadId, text) => {
  const result = await startTurn(threadId, text);
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
  projectRoots: [root],
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
await startServer(config, runtime);
console.log(`fixture gateway http://127.0.0.1:8787 loggedIn=${engine.loggedIn}`);

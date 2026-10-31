import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigFile } from "./config.ts";
import { UnixCodexEngine } from "./codex/unix-engine.ts";
import { openDatabase } from "./db.ts";
import { startServer } from "./http.ts";
import { Runtime } from "./runtime.ts";

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("用法: node src/index.ts <config.json>");
    process.exit(1);
  }

  const config = loadConfigFile(configPath);
  const db = openDatabase(config.dataDir);
  const engine = new UnixCodexEngine(config.appServerSocket);
  const runtime = new Runtime(db, engine, config);
  await engine.connect();
  await runtime.start();
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  const server = await startServer(config, runtime, existsSync(webRoot) ? webRoot : undefined);
  console.log(`codex-web 监听 http://${config.bindHost}:${config.bindPort}`);
  server.on("close", () => db.close());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

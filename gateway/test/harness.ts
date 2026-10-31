import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../src/config.ts";
import { FakeEngine } from "../src/codex/fake-engine.ts";
import { openDatabase } from "../src/db.ts";
import { startServer } from "../src/http.ts";
import { Runtime } from "../src/runtime.ts";

export type Harness = {
  config: AppConfig;
  engine: FakeEngine;
  db: DatabaseSync;
  runtime: Runtime;
  server: Server;
  port: number;
  root: string;
  close: () => Promise<void>;
};

export async function startHarness(options?: { loggedIn?: boolean; version?: string; allowed?: string[] }): Promise<Harness> {
  const root = mkdtempSync(path.join(tmpdir(), "codex-web-root-"));
  const dataDir = mkdtempSync(path.join(tmpdir(), "codex-web-data-"));
  const engine = new FakeEngine();
  engine.loggedIn = options?.loggedIn ?? true;
  engine.versionValue = options?.version ?? "9.9.9-test";
  const config: AppConfig = {
    bindHost: "127.0.0.1",
    bindPort: 0,
    projectRoots: [root],
    appServerSocket: path.join(dataDir, "missing.sock"),
    allowedCodexVersions: options?.allowed ?? [engine.versionValue],
    httpsProxy: "http://127.0.0.1:7890",
    username: "admin",
    password: "secret",
    dataDir,
  };
  const db = openDatabase(dataDir);
  const runtime = new Runtime(db, engine, config);
  try {
    await runtime.start();
  } catch (error) {
    db.close();
    throw error;
  }
  const server = await startServer(config, runtime);
  const address = server.address() as AddressInfo;
  return {
    config,
    engine,
    db,
    runtime,
    server,
    port: address.port,
    root,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          db.close();
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

export async function request(
  port: number,
  method: string,
  pathname: string,
  body?: unknown,
  cookie?: string,
): Promise<{ status: number; json: Record<string, unknown>; cookie?: string }> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie") ?? "";
  const json = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    json,
    cookie: setCookie ? setCookie.split(";")[0] : undefined,
  };
}

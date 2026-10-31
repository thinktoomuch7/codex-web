import { readFileSync } from "node:fs";

export type AppConfig = {
  bindHost: string;
  bindPort: number;
  projectRoots: string[];
  appServerSocket: string;
  allowedCodexVersions: string[];
  httpsProxy: string;
  username: string;
  password: string;
  dataDir: string;
};

const REQUIRED = [
  "bindHost",
  "bindPort",
  "projectRoots",
  "appServerSocket",
  "allowedCodexVersions",
  "httpsProxy",
  "username",
  "password",
  "dataDir",
] as const;

export function parseConfig(raw: unknown): AppConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("配置必须是 JSON 对象");
  }
  const record = raw as Record<string, unknown>;
  const missing = REQUIRED.filter((key) => {
    const value = record[key];
    if (value === undefined || value === null || value === "") return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  });
  if (missing.length > 0) {
    throw new Error(`配置缺少必填项: ${missing.join(", ")}`);
  }
  const bindPort = record.bindPort;
  if (typeof bindPort !== "number" || !Number.isInteger(bindPort) || bindPort <= 0) {
    throw new Error("bindPort 必须是正整数");
  }
  const projectRoots = stringList(record.projectRoots, "projectRoots");
  const allowedCodexVersions = stringList(record.allowedCodexVersions, "allowedCodexVersions");
  return {
    bindHost: String(record.bindHost),
    bindPort,
    projectRoots,
    appServerSocket: String(record.appServerSocket),
    allowedCodexVersions,
    httpsProxy: String(record.httpsProxy),
    username: String(record.username),
    password: String(record.password),
    dataDir: String(record.dataDir),
  };
}

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) {
    throw new Error(`${name} 必须是非空字符串数组`);
  }
  return value;
}

export function loadConfigFile(path: string): AppConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parseConfig(raw);
}

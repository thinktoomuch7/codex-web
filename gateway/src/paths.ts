import { accessSync, constants, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export function resolveReadablePath(candidate: string): string {
  let resolved: string;
  try {
    resolved = realpathSync(candidate);
  } catch {
    throw new Error("这个目录不存在");
  }
  if (!statSync(resolved).isDirectory()) throw new Error("路径不是目录");
  return resolved;
}

export function resolveProjectPath(candidate: string, _roots: string[]): string {
  return resolveReadablePath(candidate);
}

export function createChildDirectory(parent: string, name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/]/.test(trimmed)) throw new Error("目录名不合法");
  const base = resolveReadablePath(parent);
  try {
    accessSync(base, constants.W_OK);
  } catch {
    throw new Error("这个目录不能写入");
  }
  mkdirSync(path.join(base, trimmed));
  return realpathSync(path.join(base, trimmed));
}

export function listReadableDirectory(candidate: string): { path: string; parent: string; entries: { name: string; kind: "dir" | "file" }[] } {
  const resolved = resolveReadablePath(candidate);
  const entries = readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? ("dir" as const) : ("file" as const) }))
    .sort((left, right) => Number(right.kind === "dir") - Number(left.kind === "dir") || left.name.localeCompare(right.name));
  return { path: resolved, parent: path.dirname(resolved), entries };
}

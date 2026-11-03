import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isInside } from "./git.ts";

const TEXT = new Set([".txt", ".md", ".json", ".ts", ".tsx", ".js", ".css", ".html", ".yml", ".yaml", ".toml", ".py", ".go", ".rs", ".sh", ".xml", ".svg"]);

export function resolveWithin(roots: string[], relative: string): string {
  const trimmed = relative.trim().replaceAll("\\", "/");
  if (path.win32.isAbsolute(trimmed) || path.posix.isAbsolute(trimmed) || trimmed.split("/").includes("..")) {
    throw new Error("路径不在当前目录内");
  }
  for (const candidate of roots) {
    let root: string;
    try {
      root = realpathSync(candidate);
    } catch {
      continue;
    }
    const target = trimmed ? path.resolve(root, trimmed) : root;
    if (isInside(root, target)) return target;
  }
  throw new Error("路径不在当前目录内");
}

export function listTree(root: string, relative = ""): { path: string; entries: { name: string; kind: "dir" | "file" }[] } {
  const dir = resolveWithin([root], relative);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error("这个目录不存在");
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? ("dir" as const) : ("file" as const) }))
    .sort((left, right) => Number(right.kind === "dir") - Number(left.kind === "dir") || left.name.localeCompare(right.name));
  return { path: relative.replaceAll("\\", "/"), entries };
}

export function readPreview(root: string, relative: string): { path: string; kind: "text" | "image" | "binary"; text?: string; data?: string } {
  const file = resolveWithin([root], relative);
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error("这个文件不存在");
  const extension = path.extname(file).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension)) {
    return { path: relative, kind: "image", data: readFileSync(file).toString("base64") };
  }
  if (!TEXT.has(extension) && extension !== "") {
    return { path: relative, kind: "binary" };
  }
  return { path: relative, kind: "text", text: readFileSync(file, "utf8").slice(0, 200_000) };
}

export function writeUpload(root: string, relative: string, bytes: Buffer): string {
  const file = resolveWithin([root], relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return relative.replaceAll("\\", "/");
}

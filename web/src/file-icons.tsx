"use client";

import type { CSSProperties } from "react";

type IconName =
  | "_file"
  | "_folder"
  | "_folder_open"
  | "bash"
  | "config"
  | "css"
  | "database"
  | "docker"
  | "env"
  | "git"
  | "graphql"
  | "html"
  | "javascript"
  | "javascript-react"
  | "json"
  | "lock"
  | "npm-lock"
  | "bun-lock"
  | "next"
  | "eslint"
  | "markdown"
  | "ms-word"
  | "pdf"
  | "python"
  | "rust"
  | "sass"
  | "terraform"
  | "toml"
  | "typescript"
  | "typescript-react"
  | "yaml"
  | "go";

function CatppuccinIcon({ name, size = 14 }: { name: IconName; size?: number }) {
  const style = {
    width: size,
    height: size,
    "--catppuccin-icon-light": `url(/icons/catppuccin/latte/${name}.svg)`,
    "--catppuccin-icon-dark": `url(/icons/catppuccin/mocha/${name}.svg)`,
  } as CSSProperties;
  return <span aria-hidden="true" className="catppuccin-file-icon" style={style} />;
}

export function FolderIcon({ size = 14, open = false }: { size?: number; open?: boolean }) {
  return <CatppuccinIcon name={open ? "_folder_open" : "_folder"} size={size} />;
}

const EXTENSION_ICONS: Record<string, IconName> = {
  ts: "typescript",
  tsx: "typescript-react",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript-react",
  py: "python",
  json: "json",
  jsonl: "json",
  css: "css",
  less: "css",
  scss: "sass",
  html: "html",
  htm: "html",
  md: "markdown",
  mdx: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  rs: "rust",
  go: "go",
  sql: "database",
  graphql: "graphql",
  gql: "graphql",
  tf: "terraform",
  hcl: "terraform",
  docx: "ms-word",
  pdf: "pdf",
  lock: "lock",
};

function specialIcon(name: string): IconName | undefined {
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "docker";
  if (name === ".env" || name.startsWith(".env.")) return "env";
  if ([".gitignore", ".gitattributes", ".gitmodules"].includes(name)) return "git";
  if (name === "package-lock.json") return "npm-lock";
  if (name === "bun.lock") return "bun-lock";
  if (["next.config.js", "next.config.mjs", "next.config.cjs", "next.config.ts"].includes(name)) return "next";
  if (name.endsWith(".config.ts") || name.endsWith(".config.js") || name.endsWith(".config.mjs") || name.endsWith(".config.cjs")) return "config";
  return undefined;
}

export function FileIcon({ name, size = 14 }: { name: string; size?: number }) {
  const lower = name.toLowerCase();
  const special = specialIcon(lower);
  if (special) return <CatppuccinIcon name={special} size={size} />;
  const ext = lower.split(".").pop() ?? "";
  return <CatppuccinIcon name={EXTENSION_ICONS[ext] ?? "_file"} size={size} />;
}

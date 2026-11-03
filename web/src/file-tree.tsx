"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { FileIcon, FolderIcon } from "./file-icons";

type Entry = { name: string; kind: "dir" | "file" };

export function FileTree({
  projectId,
  threadId,
  query = "",
  onOpen,
}: {
  projectId: number | null;
  threadId: string | null;
  query?: string;
  onOpen: (path: string) => void;
}) {
  const [children, setChildren] = useState<Record<string, Entry[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({ "": true });
  const [failed, setFailed] = useState("");

  useEffect(() => {
    if (!projectId || !threadId) return;
    let cancelled = false;
    api.files(projectId, threadId, "").then(
      (listed) => {
        if (!cancelled) setChildren({ "": listed.entries });
      },
      (reason: unknown) => {
        if (!cancelled) setFailed(reason instanceof Error ? reason.message : "文件列表失败");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, threadId]);

  async function toggle(path: string) {
    const next = !open[path];
    setOpen((current) => ({ ...current, [path]: next }));
    if (!next || children[path] || !projectId || !threadId) return;
    const listed = await api.files(projectId, threadId, path);
    setChildren((current) => ({ ...current, [path]: listed.entries }));
  }

  if (!projectId || !threadId) return <p className="session-tree-message">打开一条会话后查看文件</p>;
  if (failed) return <p className="sidebar-files-error-text">{failed}</p>;
  return <Branch path="" depth={0} query={query.trim().toLowerCase()} children={children} open={open} onToggle={(path) => void toggle(path)} onOpen={onOpen} />;
}

function Branch({
  path,
  depth,
  query,
  children,
  open,
  onToggle,
  onOpen,
}: {
  path: string;
  depth: number;
  query: string;
  children: Record<string, Entry[]>;
  open: Record<string, boolean>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const entries = (children[path] ?? []).filter((entry) => !query || entry.name.toLowerCase().includes(query));
  return (
    <>
      {entries.map((entry) => {
        const child = path ? `${path}/${entry.name}` : entry.name;
        const expanded = Boolean(open[child]);
        return (
          <div key={child}>
            <FileRow
              name={entry.name}
              kind={entry.kind}
              depth={depth}
              open={expanded}
              title={child}
              onClick={() => (entry.kind === "dir" ? onToggle(child) : onOpen(child))}
            />
            {entry.kind === "dir" && expanded ? (
              <Branch path={child} depth={depth + 1} query={query} children={children} open={open} onToggle={onToggle} onOpen={onOpen} />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function FileRow({
  name,
  kind,
  depth,
  open = false,
  title,
  onClick,
}: {
  name: string;
  kind: "dir" | "file";
  depth: number;
  open?: boolean;
  title?: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      title={title ?? name}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 4,
        width: "100%",
        height: 24,
        paddingLeft: 8 + depth * 14,
        paddingRight: 8,
        border: 0,
        borderRadius: 4,
        background: hovered ? "var(--bg-hover)" : "transparent",
        color: "var(--text)",
        cursor: "pointer",
        font: "inherit",
        fontSize: 12,
        textAlign: "left",
        userSelect: "none",
      }}
    >
      {kind === "dir" ? <TreeChevron open={open} /> : <span style={{ width: 10, flex: "none" }} />}
      <span style={{ display: "flex", flex: "none", alignItems: "center" }}>
        {kind === "dir" ? <FolderIcon size={14} open={open} /> : <FileIcon name={name} size={14} />}
      </span>
      <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
    </button>
  );
}

function TreeChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="var(--text-dim)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "none", transform: open ? "rotate(90deg)" : "none" }}
      aria-hidden="true"
    >
      <polyline points="3 2 7 5 3 8" />
    </svg>
  );
}

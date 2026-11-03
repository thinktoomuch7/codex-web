"use client";

import { type CSSProperties, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";

const panelSurfaceStyle: CSSProperties = {
  overflow: "hidden",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
};

const textInputStyle: CSSProperties = {
  height: 36,
  padding: "0 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  outline: "none",
  background: "var(--bg-panel)",
  color: "var(--text)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
};

const actionButtonStyle: CSSProperties = {
  padding: "6px 16px",
  borderRadius: 6,
  fontSize: 13,
};

const primaryActionStyle: CSSProperties = {
  ...actionButtonStyle,
  border: 0,
  background: "var(--accent)",
  color: "var(--accent-contrast)",
  fontWeight: 600,
};

const secondaryActionStyle: CSSProperties = {
  ...actionButtonStyle,
  border: "1px solid var(--border)",
  background: "none",
  color: "var(--text-muted)",
};

function childPath(parent: string, name: string): string {
  if (parent.endsWith("/") || parent.endsWith("\\")) return `${parent}${name}`;
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent}${separator}${name}`;
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M1.5 3h4l1.5 2h7.5v7.5h-13z" />
    </svg>
  );
}

export function DirectoryPicker({
  initialPath,
  busy = false,
  error,
  onCancel,
  onSelect,
}: {
  initialPath?: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSelect: (path: string) => void;
}) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [parentDirectory, setParentDirectory] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState(initialPath ?? "");
  const [directories, setDirectories] = useState<{ name: string; path: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [directoryName, setDirectoryName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const backdropPressRef = useRef(false);
  const createBackdropPressRef = useRef(false);

  const navigateTo = useCallback(async (directory?: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.browse(directory || "/");
      const nextPath = data.path || directory || "/";
      setCurrentPath(nextPath);
      setParentDirectory(data.parent && data.parent !== nextPath ? data.parent : null);
      setPathInput(nextPath);
      setDirectories(data.entries.filter((entry) => entry.kind === "dir").map((entry) => ({ name: entry.name, path: childPath(nextPath, entry.name) })));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "打不开这个目录");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPortalTarget(document.body);
    void navigateTo(initialPath || undefined);
  }, [initialPath, navigateTo]);

  const closeCreateDialog = () => {
    if (creating) return;
    setCreateOpen(false);
    setDirectoryName("");
    setCreateError(null);
  };

  const handleCreateDirectory = async () => {
    const name = directoryName.trim();
    if (!currentPath || !name || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.createDirectory(currentPath, name);
      setCreateOpen(false);
      setDirectoryName("");
      await navigateTo(created.path);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "没有建成这个目录");
    } finally {
      setCreating(false);
    }
  };

  const hasUncommittedPath = pathInput.trim() !== currentPath;
  const canSelect = Boolean(currentPath) && !hasUncommittedPath && !busy && !loading;

  if (!portalTarget) return null;

  return createPortal(
    <div
      className="directory-picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="选择目录"
      onPointerDown={(event) => {
        backdropPressRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const pressedBackdrop = backdropPressRef.current;
        backdropPressRef.current = false;
        if (pressedBackdrop && event.target === event.currentTarget && !busy) onCancel();
      }}
      onPointerCancel={() => {
        backdropPressRef.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onCancel();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}
    >
      <div className="directory-picker-panel" style={{ ...panelSurfaceStyle, position: "relative", width: 520, maxWidth: "calc(100vw - 16px)", height: "min(620px, calc(100dvh - 16px))", maxHeight: "calc(100dvh - 16px)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, padding: "12px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 15 }}>选择目录</div>
          <button type="button" onClick={onCancel} disabled={busy} title="关闭" aria-label="关闭" style={{ padding: "2px 6px", border: 0, background: "none", color: "var(--text-muted)", fontSize: 20, lineHeight: 1, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}>
            ×
          </button>
        </div>
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const candidate = pathInput.trim();
            if (candidate) void navigateTo(candidate);
          }}
          style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}
        >
          <button className="directory-picker-back" type="button" onClick={() => void navigateTo(parentDirectory ?? undefined)} disabled={loading || !parentDirectory} title="转到上级目录" aria-label="转到上级目录" style={{ width: 36, height: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: parentDirectory ? "pointer" : "default", opacity: parentDirectory ? 1 : 0.45 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          <label htmlFor="directory-path" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
            目录路径
          </label>
          <input
            className="directory-picker-path"
            id="directory-path"
            type="text"
            value={pathInput}
            placeholder="/path/to/project or ~/project"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setPathInput(event.target.value);
              setLoadError(null);
            }}
            style={{ ...textInputStyle, minWidth: 0, flex: 1 }}
          />
          <button className="directory-picker-action" type="submit" disabled={loading || !pathInput.trim()} title="转到目录" style={{ minWidth: 58, height: 36, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: loading || !pathInput.trim() ? "default" : "pointer", opacity: loading || !pathInput.trim() ? 0.6 : 1 }}>
            转到
          </button>
        </form>
        <div className="directory-picker-list" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 10px" }}>
          {loading ? (
            <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 11 }}>正在加载目录…</div>
          ) : directories.length > 0 ? (
            directories.map((entry) => (
              <button
                key={entry.path}
                className="directory-picker-entry"
                type="button"
                onClick={() => void navigateTo(entry.path)}
                title={entry.path}
                style={{ width: "100%", minHeight: 30, display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", border: 0, borderRadius: 5, background: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-mono)", fontSize: 11 }}
              >
                <FolderIcon />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
              </button>
            ))
          ) : (
            <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 11 }}>没有子目录</div>
          )}
          {(loadError || error) && <div style={{ padding: 8, color: "#dc2626", fontSize: 11 }}>{loadError ?? error}</div>}
        </div>
        <div className="directory-picker-footer" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, flexShrink: 0, padding: "10px 18px", borderTop: "1px solid var(--border)" }}>
          <button
            className="directory-picker-action"
            type="button"
            onClick={() => {
              setCreateOpen(true);
              setCreateError(null);
            }}
            disabled={!canSelect}
            style={{ ...secondaryActionStyle, marginRight: "auto", opacity: canSelect ? 1 : 0.6, cursor: canSelect ? "pointer" : "default" }}
          >
            新建目录
          </button>
          <button className="directory-picker-action" type="button" onClick={onCancel} disabled={busy} style={{ ...secondaryActionStyle, cursor: busy ? "default" : "pointer" }}>
            取消
          </button>
          <button
            className="directory-picker-action"
            type="button"
            onClick={() => onSelect(currentPath)}
            disabled={!canSelect}
            title={hasUncommittedPath ? "选择前请先打开此路径" : "选择当前目录"}
            style={{ ...primaryActionStyle, opacity: canSelect ? 1 : 0.6, cursor: canSelect ? "pointer" : "default" }}
          >
            {busy ? "检查中..." : "选择此文件夹"}
          </button>
        </div>
        {createOpen ? (
          <div
            style={{ position: "absolute", inset: 0, zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, background: "rgba(0,0,0,0.35)" }}
            onPointerDown={(event) => {
              createBackdropPressRef.current = event.target === event.currentTarget;
            }}
            onClick={(event) => {
              const pressedBackdrop = createBackdropPressRef.current;
              createBackdropPressRef.current = false;
              if (pressedBackdrop && event.target === event.currentTarget) closeCreateDialog();
            }}
            onPointerCancel={() => {
              createBackdropPressRef.current = false;
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") closeCreateDialog();
            }}
          >
            <form
              role="dialog"
              aria-modal="true"
              aria-label="新建目录"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateDirectory();
              }}
              style={{ ...panelSurfaceStyle, width: 400, maxWidth: "100%" }}
            >
              <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", color: "var(--text)", fontSize: 15, fontWeight: 700 }}>新建目录</div>
              <div style={{ padding: "12px 18px" }}>
                <label htmlFor="new-directory-name" style={{ display: "block", marginBottom: 6, color: "var(--text-muted)", fontSize: 11 }}>
                  目录名
                </label>
                <input
                  id="new-directory-name"
                  value={directoryName}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="请输入目录名"
                  onChange={(event) => {
                    setDirectoryName(event.target.value);
                    setCreateError(null);
                  }}
                  disabled={creating}
                  className="directory-picker-path"
                  style={{ ...textInputStyle, width: "100%", boxSizing: "border-box" }}
                />
                {createError ? <div style={{ marginTop: 7, color: "#dc2626", fontSize: 11, lineHeight: 1.35 }}>{createError}</div> : null}
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button className="directory-picker-action" type="submit" disabled={creating || !directoryName.trim()} style={{ ...primaryActionStyle, flex: 1, opacity: creating ? 0.65 : 1, cursor: creating || !directoryName.trim() ? "default" : "pointer" }}>
                    {creating ? "正在创建…" : "创建"}
                  </button>
                  <button className="directory-picker-action" type="button" onClick={closeCreateDialog} disabled={creating} style={{ ...secondaryActionStyle, flex: 1, cursor: creating ? "default" : "pointer" }}>
                    取消
                  </button>
                </div>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>,
    portalTarget,
  );
}

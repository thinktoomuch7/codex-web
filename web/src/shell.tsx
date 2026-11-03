"use client";

import { useState, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { STATUS_LABEL, type Approval, type Project, type RecentThread, type Task, type TimelineItem } from "./api";
import { DirectoryPicker } from "./directory-picker";
import { FileTree } from "./file-tree";
import { CopyButton, highlighted, MarkdownBody, ThinkingBlock } from "./markdown";
import { TerminalPane } from "./terminal-pane";
import { applyTheme, THEME_LABEL, THEME_OPTIONS } from "@/lib/theme";

type Phase = "loading" | "login" | "work";
type Block = { kind: "user" | "agent" | "checks" | "think"; items: TimelineItem[] };
type Turn = { id: string; user: TimelineItem | null; rest: Block[] };

const CHECK_KINDS = new Set(["commandExecution", "fileChange"]);

function blocks(items: TimelineItem[]): Block[] {
  const result: Block[] = [];
  for (const item of items) {
    if (item.kind === "userMessage") result.push({ kind: "user", items: [item] });
    else if (item.kind === "reasoning") result.push({ kind: "think", items: [item] });
    else if (CHECK_KINDS.has(item.kind)) {
      const last = result.at(-1);
      if (last?.kind === "checks") last.items.push(item);
      else result.push({ kind: "checks", items: [item] });
    } else result.push({ kind: "agent", items: [item] });
  }
  return result;
}

function groupTurns(parts: Block[]): Turn[] {
  const turns: Turn[] = [];
  for (const part of parts) {
    if (part.kind === "user" || turns.length === 0) {
      turns.push({
        id: part.items[0].id,
        user: part.kind === "user" ? part.items[0] : null,
        rest: part.kind === "user" ? [] : [part],
      });
      continue;
    }
    turns.at(-1)?.rest.push(part);
  }
  return turns;
}

function spent(task: Task, now: number): string {
  if (!task?.created_at) return "";
  const running = task.status === "running" || task.status === "waiting_approval";
  const end = running ? now : (task.updated_at ?? now);
  return `${Math.max(0, Math.round((end - task.created_at) / 1000))}s`;
}

export type WorkspaceProps = {
  phase: Phase;
  password: string;
  setPassword: (value: string) => void;
  error: string;
  onLogin: (event: FormEvent) => void;
  loggedIn: boolean;
  projects: Project[];
  projectId: number | null;
  projectGit: boolean;
  threads: RecentThread[];
  threadId: string | null;
  drafting: boolean;
  items: TimelineItem[];
  approvals: Approval[];
  queue: string[];
  task: Task;
  older: boolean;
  draft: string;
  setDraft: (value: string) => void;
  directory: "worktree" | "local";
  setDirectory: (value: "worktree" | "local") => void;
  projectName: string;
  setProjectName: (value: string) => void;
  plusOpen: boolean;
  setPlusOpen: (value: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (value: boolean) => void;
  reviewOpen: boolean;
  setReviewOpen: (value: boolean) => void;
  menuFor: string | null;
  setMenuFor: (value: string | null) => void;
  openChecks: Record<string, boolean>;
  setOpenChecks: (value: Record<string, boolean>) => void;
  busy: boolean;
  findText: string;
  setFindText: (value: string) => void;
  titleQuery: string;
  setTitleQuery: (value: string) => void;
  pane: "chat" | "files" | "git" | "terminal";
  setPane: (value: "chat" | "files" | "git" | "terminal") => void;
  fileDir: string;
  fileEntries: { name: string; kind: "dir" | "file" }[];
  preview: string;
  browsePath: string;
  browseParent: string;
  browseEntries: { name: string; kind: "dir" | "file" }[];
  dirName: string;
  setDirName: (value: string) => void;
  termOut: string;
  termLine: string;
  setTermLine: (value: string) => void;
  termError: string;
  gitFiles: string[];
  showArchived: boolean;
  models: { id: string; name: string }[];
  model: string;
  sandbox: string;
  approvalPolicy: string;
  gitDiff: string;
  gitMessage: string;
  setGitMessage: (value: string) => void;
  gitError: string;
  gitUrl: string;
  now: number;
  transcriptRef: RefObject<HTMLDivElement | null>;
  onLogout: () => void;
  openPlus: () => void;
  loadBrowse: (dir: string) => void;
  pickProject: (id: number) => void;
  beginDraft: () => void;
  chooseThread: (item: RecentThread) => void;
  loadOlder: () => void;
  onTranscriptScroll: () => void;
  onDeleteThread: (item: RecentThread) => void;
  onAddProject: (event: FormEvent) => void;
  onChooseDirectory: (path: string) => Promise<void>;
  sendDraft: () => void;
  onDraftKey: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onStop: () => void;
  onDecision: (approvalId: string, decision: "accept" | "decline" | "acceptForSession") => void;
  onRename: (item: RecentThread) => void;
  onArchive: (item: RecentThread) => void;
  onUnarchive: (item: RecentThread) => void;
  onFork: (item: RecentThread) => void;
  onPin: (item: RecentThread) => void;
  openSettings: () => void;
  openReview: () => void;
  onSettings: (next: { model?: string; sandbox?: string; approvalPolicy?: string }) => void;
  onGit: (action: string) => void;
  showFiles: (dir?: string) => void;
  openPreview: (name: string) => void;
  onUpload: (file: File) => void;
  onDropFiles: (event: DragEvent) => void;
  onQuote: () => void;
  onOpenFile: (path: string) => void;
  openTerm: () => void;
  sendTerm: (event: FormEvent) => void;
  onCreateDirectory: (event: FormEvent) => void;
  toggleArchived: () => void;
};

const iconButton: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  padding: 0,
  background: "none",
  border: "none",
  borderRight: "1px solid var(--border)",
  color: "var(--text-muted)",
  cursor: "pointer",
  flexShrink: 0,
};

export function Workspace(props: WorkspaceProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filesCollapsed, setFilesCollapsed] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [treeNonce, setTreeNonce] = useState(0);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  if (props.phase === "loading") {
    return (
      <div className="web-login-page">
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>正在连接这台服务器</p>
      </div>
    );
  }

  if (props.phase === "login") {
    return (
      <div className="web-login-page">
        <div className="web-login-shell">
          <div className="web-login-brand">
            <div>
              <h1>Codex Web</h1>
              <p>用网页密码进入。它和 Codex 账号不是同一个。</p>
            </div>
          </div>
          <form className="web-login-form" onSubmit={props.onLogin}>
            <div className="web-login-composer">
              <label className="web-login-label" htmlFor="password">
                密码
              </label>
              <input
                id="password"
                type="password"
                placeholder="密码"
                value={props.password}
                onChange={(event) => props.setPassword(event.target.value)}
              />
              <button type="submit">进入</button>
            </div>
            {props.error ? <p className="web-login-error">{props.error}</p> : <p className="web-login-error" />}
          </form>
        </div>
      </div>
    );
  }

  const needle = props.titleQuery.trim().toLowerCase();
  const visibleThreads = props.threads
    .filter((item) => !needle || item.title.toLowerCase().includes(needle))
    .slice()
    .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const pinned = visibleThreads.filter((item) => item.pinned);
  const groups = props.projects.map((project) => ({
    project,
    threads: visibleThreads.filter((item) => item.projectId === project.id && !item.pinned),
  }));
  const thread = props.threads.find((item) => item.id === props.threadId) ?? null;
  const currentProject = props.projects.find((item) => item.id === props.projectId) ?? null;
  const status = props.task ? STATUS_LABEL[props.task.status] ?? props.task.status : "";
  const failure = props.error || props.task?.error || (props.task?.status === "failed" ? "这一轮失败了。" : "");
  const canStop = props.task?.status === "running" || props.task?.status === "waiting_approval";
  const visibleItems = props.items.filter((item) => item.text.trim() !== "" || item.command);
  const turns = groupTurns(blocks(visibleItems));
  const elapsed = spent(props.task, props.now);
  const fresh = props.drafting || !props.threadId;
  const menuThread = visibleThreads.find((item) => item.id === props.menuFor) ?? null;

  function openMenu(item: RecentThread, anchor: HTMLButtonElement) {
    const box = anchor.getBoundingClientRect();
    setMenuPos({ top: box.bottom + 4, left: Math.max(8, box.right - 180) });
    props.setMenuFor(props.menuFor === item.id ? null : item.id);
  }

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "var(--app-viewport-height, 100dvh)",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <div
        className="sidebar-overlay-backdrop"
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.4)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
        }}
      />
      <div
        id="session-sidebar"
        className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}`}
        style={{
          ["--sidebar-width" as string]: "288px",
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          height: "100%",
          minHeight: 0,
          zIndex: 200,
        }}
      >
        <div className={`session-sidebar is-files-below${filesCollapsed ? " is-files-collapsed" : ""}`} style={{ ["--sidebar-files-height" as string]: "280px" }}>
          <div className="sidebar-header">
            <button type="button" className="sidebar-brand" aria-label="Codex Web">
              Codex Web
            </button>
            <span className="sidebar-header-spacer" />
            <button type="button" className="sidebar-new-button" onClick={props.beginDraft} disabled={props.projects.length === 0} title="新会话">
              <PlusIcon />
              <span className="sidebar-new-label">新建</span>
            </button>
            <button
              type="button"
              className={`sidebar-search-toggle${searchOpen ? " is-active" : ""}`}
              aria-label="搜索会话"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((open) => !open)}
            >
              <SearchIcon />
            </button>
          </div>
          <div className="sidebar-panel sidebar-sessions-panel" role="region" aria-label="会话">
            {searchOpen ? (
              <div className="sidebar-search">
                <input
                  className="sidebar-search-input"
                  type="search"
                  aria-label="搜索会话"
                  placeholder="搜索会话"
                  value={props.titleQuery}
                  onChange={(event) => props.setTitleQuery(event.target.value)}
                />
              </div>
            ) : null}
            <div className="session-tree is-static">
              <div className="session-tree-scroll">
                <div className="session-tree-inner">
                  {visibleThreads.length === 0 ? <p className="session-tree-message">还没有会话</p> : null}
                  {pinned.map((item) => (
                    <SessionRow
                      key={item.id}
                      item={item}
                      now={props.now}
                      selected={item.id === props.threadId && !props.drafting}
                      menuOpen={props.menuFor === item.id}
                      onSelect={() => void props.chooseThread(item)}
                      onMenu={(anchor) => openMenu(item, anchor)}
                    />
                  ))}
                  {groups.map((group) => (
                    <div key={group.project.id}>
                      <div className="session-tree-row session-tree-group">
                        <button
                          type="button"
                          className="session-tree-group-toggle"
                          aria-expanded={!collapsed[group.project.id]}
                          title={group.project.path}
                          onClick={() => {
                            void props.pickProject(group.project.id);
                            setCollapsed((current) => ({ ...current, [group.project.id]: !current[group.project.id] }));
                          }}
                        >
                          <Chevron open={!collapsed[group.project.id]} />
                          <span className="session-tree-group-name">{group.project.name}</span>
                        </button>
                      </div>
                      {collapsed[group.project.id]
                        ? null
                        : group.threads.map((item) => (
                            <SessionRow
                              key={item.id}
                              item={item}
                              now={props.now}
                              selected={item.id === props.threadId && !props.drafting}
                              menuOpen={props.menuFor === item.id}
                              onSelect={() => void props.chooseThread(item)}
                              onMenu={(anchor) => openMenu(item, anchor)}
                            />
                          ))}
                    </div>
                  ))}
                  <button type="button" className="sidebar-archive-back" style={{ margin: "8px 10px" }} onClick={() => void props.toggleArchived()}>
                    <span>{props.showArchived ? "回到会话" : "已归档"}</span>
                  </button>
                  {props.projects.length === 0 ? (
                    <button type="button" className="sidebar-new-button" style={{ margin: 10 }} onClick={props.openPlus}>
                      选择目录
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <div id="session-sidebar-panel-files" className="sidebar-panel sidebar-files-panel" role="region" aria-label="文件">
            <div className="sidebar-files-section">
              <button
                type="button"
                className="sidebar-files-section-toggle"
                aria-expanded={!filesCollapsed}
                aria-controls="session-sidebar-files-body"
                onClick={() => setFilesCollapsed((value) => !value)}
              >
                <Chevron open={!filesCollapsed} />
                <span className="sidebar-files-section-label">文件</span>
              </button>
              <div className="sidebar-files-keys" role="group" aria-label="文件操作" style={{ flex: "0 0 auto", maxWidth: "none" }}>
                <button type="button" className="sidebar-tool-button" title="选择目录" aria-label="选择目录" aria-expanded={props.plusOpen} onClick={props.openPlus}>
                  <PlusIcon />
                </button>
                <button type="button" className="sidebar-tool-button" title="刷新" aria-label="刷新" disabled={!props.threadId} onClick={() => setTreeNonce((value) => value + 1)}>
                  <RefreshIcon />
                </button>
                <button
                  type="button"
                  className={`sidebar-tool-button${fileSearchOpen ? " is-active" : ""}`}
                  title="搜索文件"
                  aria-label="搜索文件"
                  aria-expanded={fileSearchOpen}
                  onClick={() => {
                    if (filesCollapsed) setFilesCollapsed(false);
                    setFileSearchOpen((value) => !value);
                  }}
                >
                  <SearchIcon />
                </button>
              </div>
            </div>
            <div id="session-sidebar-files-body" className="sidebar-files-body" hidden={filesCollapsed}>
              <div className="sidebar-files-head">
                <div className="project-picker is-row" role="group" aria-label="项目和目录">
                  <button
                    type="button"
                    className={currentProject ? "project-picker-button is-project" : "project-picker-button is-project is-empty"}
                    aria-expanded={props.plusOpen}
                    title={currentProject?.path || "选择项目…"}
                    onClick={props.openPlus}
                  >
                    <span className="project-picker-path">
                      <span>{currentProject?.path || "选择项目…"}</span>
                    </span>
                  </button>
                  {props.projectGit ? (
                    <button type="button" className="project-picker-button" onClick={() => props.setDirectory(props.directory === "worktree" ? "local" : "worktree")}>
                      <BranchIcon />
                      <span className="project-picker-path">
                        <span>{props.directory === "worktree" ? "worktree" : "当前目录"}</span>
                      </span>
                    </button>
                  ) : null}
                </div>
              </div>
              {fileSearchOpen ? (
                <div className="sidebar-search">
                  <input
                    className="sidebar-search-input"
                    aria-label="搜索文件"
                    placeholder="搜索文件…"
                    value={fileQuery}
                    onChange={(event) => setFileQuery(event.target.value)}
                  />
                </div>
              ) : null}
              <div className="sidebar-files-scroll scrollbar-subtle">
                <FileTree
                  key={treeNonce}
                  projectId={props.projectId}
                  threadId={props.drafting ? null : props.threadId}
                  query={fileQuery}
                  onOpen={(path) => void props.onOpenFile(path)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, minHeight: 0, height: "100%" }}>
        <div style={{ flexShrink: 0, background: "var(--bg-panel)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              borderBottom: "1px solid var(--border)",
              height: "calc(36px + env(safe-area-inset-top))",
            }}
          >
            <button type="button" aria-label={sidebarOpen ? "隐藏侧栏" : "显示侧栏"} style={iconButton} onClick={() => setSidebarOpen((open) => !open)}>
              <SidebarIcon open={sidebarOpen} />
            </button>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 12px", color: "var(--text)", fontSize: 13 }}>
              {fresh ? "新会话" : thread?.title || "会话"}
              <span style={{ marginLeft: 8, color: "var(--text-dim)", fontSize: 12 }}>
                {props.loggedIn ? "Codex 已登录" : "Codex 未登录"}
                {status ? ` · ${status}` : ""}
                {elapsed ? ` · ${elapsed}` : ""}
              </span>
            </span>
            <button type="button" aria-label="Git" title="Git" style={{ ...iconButton, borderRight: "none", borderLeft: "1px solid var(--border)" }} onClick={() => void props.openReview()}>
              <BranchIcon />
            </button>
            <button
              type="button"
              aria-label="终端"
              title="终端"
              style={{ ...iconButton, borderRight: "none", borderLeft: "1px solid var(--border)" }}
              onClick={() => {
                props.setPane(props.pane === "terminal" ? "chat" : "terminal");
                if (props.pane !== "terminal") void props.openTerm();
              }}
            >
              <TerminalIcon />
            </button>
            <button type="button" aria-label="设置" title="设置" style={{ ...iconButton, borderRight: "none", borderLeft: "1px solid var(--border)" }} onClick={() => void props.openSettings()}>
              <GearIcon />
            </button>
            <button type="button" aria-label="退出" title="退出" style={{ ...iconButton, borderRight: "none", borderLeft: "1px solid var(--border)" }} onClick={props.onLogout}>
              <LeaveIcon />
            </button>
          </div>
        </div>

        <div className="chat-content relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" onDragOver={(event) => event.preventDefault()} onDrop={props.onDropFiles}>
          {fresh ? <div className="min-h-0 flex-1" /> : (
            <>
              <div
                ref={props.transcriptRef}
                className="scrollbar-subtle min-w-0 flex-1 overflow-x-hidden overflow-y-auto pt-4"
                onScroll={props.onTranscriptScroll}
                onMouseUp={props.onQuote}
              >
                <div style={{ maxWidth: "var(--chat-content-max-width, 820px)", margin: "0 auto", padding: "0 16px 16px" }}>
                  {props.older ? (
                    <button type="button" className="sidebar-tool-button" style={{ width: "auto", padding: "0 8px" }} onClick={() => void props.loadOlder()}>
                      继续查看
                    </button>
                  ) : null}
                  {turns.map((turn) => (
                    <article key={turn.id}>
                      {turn.user ? <UserBubble text={turn.user.text} query={props.findText} /> : null}
                      {turn.rest.map((block) =>
                        block.kind === "checks" ? (
                          <ToolCard
                            key={block.items[0].id}
                            items={block.items}
                            open={props.openChecks[block.items[0].id] !== false}
                            onToggle={() => props.setOpenChecks({ ...props.openChecks, [block.items[0].id]: props.openChecks[block.items[0].id] === false })}
                          />
                        ) : block.kind === "think" ? (
                          <ThinkingBlock key={block.items[0].id} text={block.items.map((item) => item.text).join("\n")} />
                        ) : (
                          <div key={block.items[0].id} data-message-role="assistant" style={{ marginBottom: 16 }}>
                            <CopyButton text={block.items.map((item) => item.text).join("\n")} />
                            {block.items.map((item) => (
                              <MarkdownBody key={item.id} text={item.text} query={props.findText} />
                            ))}
                          </div>
                        ),
                      )}
                    </article>
                  ))}
                </div>
              </div>
              <div style={{ flexShrink: 0 }}>
                {failure ? (
                  <p role="alert" style={{ maxWidth: 820, margin: "0 auto 8px", color: "#dc2626", fontSize: 13 }}>
                    {failure}
                  </p>
                ) : null}
                {props.approvals.map((approval) => (
                  <div key={approval.id} style={{ maxWidth: 820, margin: "0 auto 8px", padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel)" }}>
                    <p style={{ margin: "0 0 8px", color: "var(--text)", fontSize: 13 }}>{approval.kind}</p>
                    <pre style={{ margin: "0 0 8px", whiteSpace: "pre-wrap", color: "var(--text-muted)", fontSize: 12 }}>{approval.payload}</pre>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className="sidebar-new-button" onClick={() => void props.onDecision(approval.id, "accept")}>
                        允许这一次
                      </button>
                      <button type="button" className="sidebar-new-button" onClick={() => void props.onDecision(approval.id, "acceptForSession")}>
                        这一会话都允许
                      </button>
                      <button type="button" className="sidebar-new-button" onClick={() => void props.onDecision(approval.id, "decline")}>
                        拒绝
                      </button>
                    </div>
                  </div>
                ))}
                <Composer {...props} canStop={canStop} fresh={false} />
              </div>
            </>
          )}
          {fresh ? (
            <>
              <div className="new-session-hero" style={{ paddingLeft: 16, paddingRight: 52 }}>
                <div className="new-session-hero-inner" style={{ maxWidth: "var(--chat-content-max-width, 820px)" }}>
                  <div className="new-session-brand">
                    <span className="new-session-logo" style={{ display: "grid", placeItems: "center", borderRadius: 8, background: "var(--accent)", color: "var(--accent-contrast)", fontWeight: 700 }}>
                      C
                    </span>
                    <div className="new-session-brand-text">
                      <span className="new-session-brand-name">Codex Web</span>
                      <span className="new-session-meta">会话留在这台服务器上</span>
                    </div>
                  </div>
                  <div className="new-session-context">
                    <div className="project-picker is-inline">
                      <button type="button" className="project-picker-button is-project" onClick={props.openPlus}>
                        {props.projects.find((item) => item.id === props.projectId)?.name || "选择目录"}
                      </button>
                      {props.projectGit ? (
                        <button type="button" className="project-picker-button" onClick={() => props.setDirectory(props.directory === "worktree" ? "local" : "worktree")}>
                          {props.directory === "worktree" ? "worktree" : "当前目录"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <Composer {...props} canStop={canStop} fresh />
            </>
          ) : null}
        </div>
        {props.pane === "terminal" && props.projectId && props.threadId ? (
          <TerminalPane
            projectId={props.projectId}
            threadId={props.threadId}
            cwd={thread?.cwd || thread?.projectName || ""}
            onClose={() => props.setPane("chat")}
          />
        ) : null}
      </div>

      {menuThread && menuPos ? (
        <div className="sidebar-menu" role="menu" style={{ position: "fixed", top: menuPos.top, left: menuPos.left, zIndex: 400 }}>
          <button type="button" className="sidebar-menu-item" role="menuitem" onClick={() => void props.onPin(menuThread)}>
            <span className="sidebar-menu-label">{menuThread.pinned ? "取消置顶" : "置顶"}</span>
          </button>
          <button type="button" className="sidebar-menu-item" role="menuitem" onClick={() => void props.onRename(menuThread)}>
            <span className="sidebar-menu-label">改名</span>
          </button>
          {props.showArchived ? (
            <button type="button" className="sidebar-menu-item" role="menuitem" onClick={() => void props.onUnarchive(menuThread)}>
              <span className="sidebar-menu-label">取消归档</span>
            </button>
          ) : (
            <button type="button" className="sidebar-menu-item" role="menuitem" onClick={() => void props.onArchive(menuThread)}>
              <span className="sidebar-menu-label">归档</span>
            </button>
          )}
          <button type="button" className="sidebar-menu-item" role="menuitem" onClick={() => void props.onFork(menuThread)}>
            <span className="sidebar-menu-label">分叉</span>
          </button>
          <button
            type="button"
            className="sidebar-menu-item is-danger"
            role="menuitem"
            aria-disabled={menuThread.status === "running" || menuThread.status === "waiting_approval"}
            onClick={() => void props.onDeleteThread(menuThread)}
          >
            <span className="sidebar-menu-label">删除</span>
          </button>
        </div>
      ) : null}

      {props.plusOpen ? (
        <DirectoryPicker
          initialPath={currentProject?.path}
          busy={picking}
          error={pickError}
          onCancel={() => {
            if (picking) return;
            setPickError(null);
            props.setPlusOpen(false);
          }}
          onSelect={(path) => {
            setPicking(true);
            setPickError(null);
            void props.onChooseDirectory(path).then(
              () => {
                setPicking(false);
                props.setPlusOpen(false);
              },
              (reason: unknown) => {
                setPicking(false);
                setPickError(reason instanceof Error ? reason.message : "没有选中这个目录");
              },
            );
          }}
        />
      ) : null}

      {props.settingsOpen ? (
        <div className="settings-dialog-backdrop" onClick={() => props.setSettingsOpen(false)}>
          <div className="settings-dialog-surface" role="dialog" aria-label="设置" onClick={(event) => event.stopPropagation()}>
            <div className="settings-dialog-header">
              <span className="settings-dialog-title">设置</span>
            </div>
            <div style={{ display: "grid", gap: 12, padding: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: 8, padding: "4px 8px", background: "var(--bg)", color: "var(--text)", cursor: "pointer", font: "inherit", fontSize: 12 }}
                    onClick={() => applyTheme(option.id)}
                  >
                    <span data-theme={option.id === "auto" ? "light" : option.id} className="settings-theme-chip" />
                    {THEME_LABEL[option.id]}
                  </button>
                ))}
              </div>
              <input aria-label="在对话中查找" placeholder="在这条对话里查找" value={props.findText} onChange={(event) => props.setFindText(event.target.value)} style={fieldStyle} />
              <label style={labelStyle}>
                沙箱
                <select aria-label="沙箱" disabled={!props.loggedIn || !props.threadId} value={props.sandbox} onChange={(event) => void props.onSettings({ sandbox: event.target.value })} style={fieldStyle}>
                  <option value="">沿用当前</option>
                  <option value="read-only">只读</option>
                  <option value="workspace-write">工作区可写</option>
                  <option value="danger-full-access">完全访问</option>
                </select>
              </label>
              <label style={labelStyle}>
                审批
                <select aria-label="审批策略" disabled={!props.loggedIn || !props.threadId} value={props.approvalPolicy} onChange={(event) => void props.onSettings({ approvalPolicy: event.target.value })} style={fieldStyle}>
                  <option value="">沿用当前</option>
                  <option value="untrusted">每次询问</option>
                  <option value="on-request">按需询问</option>
                  <option value="never">不再询问</option>
                </select>
              </label>
              <button type="button" className="sidebar-new-button" onClick={() => props.setSettingsOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {props.reviewOpen ? (
        <div className="settings-dialog-backdrop" onClick={() => props.setReviewOpen(false)}>
          <div className="settings-dialog-surface" role="dialog" aria-label="Git" onClick={(event) => event.stopPropagation()}>
            <div className="settings-dialog-header">
              <span className="settings-dialog-title">Git</span>
            </div>
            <div style={{ display: "grid", gap: 8, padding: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button type="button" className="sidebar-new-button" onClick={() => void props.onGit("diff")}>查看 diff</button>
                <button type="button" className="sidebar-new-button" onClick={() => void props.onGit("stage")}>暂存</button>
                <button type="button" className="sidebar-new-button" onClick={() => void props.onGit("revert")}>还原</button>
                <button type="button" className="sidebar-new-button" onClick={() => void props.onGit("commit")}>提交</button>
                <button type="button" className="sidebar-new-button" onClick={() => void props.onGit("push")}>推送</button>
                <button type="button" className="sidebar-new-button" onClick={() => void props.onGit("pr")}>拉取请求</button>
              </div>
              <input aria-label="提交说明" placeholder="提交说明" value={props.gitMessage} onChange={(event) => props.setGitMessage(event.target.value)} style={fieldStyle} />
              {props.gitFiles.length > 0 ? <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>{props.gitFiles.join("\n")}</p> : null}
              {props.gitError ? <p role="alert" style={{ margin: 0, color: "#dc2626", fontSize: 12 }}>{props.gitError}</p> : null}
              {props.gitUrl ? <p style={{ margin: 0, fontSize: 12 }}>{props.gitUrl}</p> : null}
              {props.gitDiff ? <pre style={{ maxHeight: 240, overflow: "auto", fontSize: 12 }}>{props.gitDiff}</pre> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Composer(props: WorkspaceProps & { canStop: boolean; fresh: boolean }) {
  return (
    <fieldset
      className="chat-input-shell"
      style={{ display: "flex", flexDirection: "column", minWidth: 0, margin: 0, border: 0, background: "transparent", padding: props.fresh ? "0 52px 8px 16px" : "0 16px 8px" }}
    >
      <div style={{ maxWidth: "var(--chat-content-max-width, 820px)", margin: "0 auto", width: "100%" }}>
        {props.queue.length > 0 ? (
          <div style={{ marginBottom: 8, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", padding: "6px 10px", color: "var(--text-dim)", fontSize: 11 }}>
            排队 {props.queue.length}
          </div>
        ) : null}
        <div
          className="chat-composer-row"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "var(--bg)",
            border: `1px solid ${props.canStop ? "rgba(234,179,8,0.4)" : "color-mix(in srgb, var(--border) 70%, transparent)"}`,
            borderRadius: 14,
            padding: "10px 10px 10px 14px",
            boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)",
          }}
        >
          <textarea
            className="chat-input-textarea"
            aria-label="要发送的话"
            rows={1}
            placeholder={props.canStop ? "这条会话正在执行，发送的话会排队" : "接着说"}
            value={props.draft}
            onChange={(event) => props.setDraft(event.target.value)}
            onKeyDown={props.onDraftKey}
            style={{ flex: 1, minWidth: 0, width: "100%", background: "none", border: "none", outline: "none", resize: "none", color: "var(--text)", fontSize: "var(--chat-content-font-size, 14px)", lineHeight: 1.6, fontFamily: "inherit", minHeight: 24, maxHeight: 200 }}
          />
          <button
            type="button"
            aria-label="发送"
            disabled={props.busy || props.draft.trim() === ""}
            onClick={() => void props.sendDraft()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minHeight: 32,
              padding: "7px 14px",
              border: "none",
              borderRadius: 8,
              background: props.draft.trim() ? "var(--accent)" : "var(--bg-panel)",
              color: props.draft.trim() ? "var(--accent-contrast)" : "var(--text-dim)",
              cursor: props.draft.trim() ? "pointer" : "not-allowed",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            发送
          </button>
        </div>
        <div className="chat-input-controls" style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <label title="添加文件" aria-label="添加文件" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 9, color: "var(--text-muted)", cursor: "pointer" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <input
              type="file"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void props.onUpload(file);
                event.target.value = "";
              }}
            />
          </label>
          <select
            aria-label="模型"
            value={props.model}
            disabled={!props.threadId}
            onChange={(event) => void props.onSettings({ model: event.target.value })}
            style={{ border: 0, background: "transparent", color: "var(--text-muted)", font: "inherit", fontSize: 12 }}
          >
            <option value="">沿用当前</option>
            {props.models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name || item.id}
              </option>
            ))}
          </select>
          <span style={{ flex: 1 }} />
          {props.canStop ? (
            <button type="button" className="sidebar-new-button" onClick={() => void props.onStop()}>
              停止
            </button>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}

function SessionRow({
  item,
  now,
  selected,
  menuOpen,
  onSelect,
  onMenu,
}: {
  item: RecentThread;
  now: number;
  selected: boolean;
  menuOpen: boolean;
  onSelect: () => void;
  onMenu: (anchor: HTMLButtonElement) => void;
}) {
  const running = item.status === "running";
  const waiting = item.status === "waiting_approval";
  return (
    <div className={["session-tree-row session-tree-session", selected ? "is-selected" : "", running ? "is-running" : "", menuOpen ? "is-menu-open" : ""].filter(Boolean).join(" ")}>
      <button type="button" className="session-tree-main" aria-current={selected ? "true" : undefined} onClick={onSelect}>
        <span className="session-tree-title">{item.title}</span>
        <span className={`session-tree-meta${running ? " is-running" : waiting ? " is-awaiting" : ""}`}>
          {item.pinned ? <span className="session-tree-project">{item.projectName}</span> : waiting ? <span className="session-tree-awaiting" role="img" aria-label="等待审批" /> : running ? <span className="session-tree-awaiting" role="img" aria-label="执行中" /> : shortTime(item.updatedAt, now)}
        </span>
      </button>
      <span className="session-tree-actions">
        <button
          type="button"
          className={`session-tree-action session-tree-more-action${menuOpen ? " is-active" : ""}`}
          aria-label={`会话菜单 ${item.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.stopPropagation();
            onMenu(event.currentTarget);
          }}
        >
          <MoreIcon />
        </button>
      </span>
    </div>
  );
}

function UserBubble({ text, query }: { text: string; query: string }) {
  return (
    <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <CopyButton text={text} />
      <div
        style={{
          maxWidth: "85%",
          background: "var(--user-bg)",
          border: "1px solid rgba(59,130,246,0.2)",
          borderRadius: 12,
          padding: "8px 12px",
          fontSize: "calc(14px + var(--chat-font-size-offset, 0px))",
          lineHeight: 1.6,
          color: "var(--text)",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
      >
        {highlighted(text, query)}
      </div>
    </div>
  );
}

function ToolCard({ items, open, onToggle }: { items: TimelineItem[]; open: boolean; onToggle: () => void }) {
  const label = items[0]?.command || items[0]?.kind || "工具";
  return (
    <div style={{ marginBottom: 8, borderRadius: 7, overflow: "hidden", fontSize: 12, border: "1px solid rgba(34,197,94,0.25)", background: "rgba(34,197,94,0.04)" }}>
      <button type="button" onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", minWidth: 0, padding: "6px 10px", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, textAlign: "left" }}>
        <span style={{ color: "#16a34a", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 11, flexShrink: 0 }}>{items[0]?.kind || "tool"}</span>
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{label}</span>
      </button>
      {open
        ? items.map((item) => (
            <pre key={item.id} style={{ margin: 0, padding: "8px 10px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, overflow: "auto", background: "var(--bg-subtle)", borderTop: "1px solid rgba(34,197,94,0.2)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {item.command || item.text}
            </pre>
          ))
        : null}
    </div>
  );
}

function shortTime(updatedAt: number | undefined, now: number): string {
  if (!updatedAt) return "";
  const minutes = Math.max(0, Math.round((now - updatedAt) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}时`;
  return `${Math.round(hours / 24)}天`;
}

function BranchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function LeaveIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`session-tree-chevron${open ? " is-open" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function SidebarIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

const fieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--text)",
  font: "inherit",
  fontSize: 13,
  padding: "6px 8px",
};

const labelStyle: CSSProperties = {
  display: "grid",
  gap: 4,
  color: "var(--text-muted)",
  fontSize: 12,
};

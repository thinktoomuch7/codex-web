import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  api,
  apiUrl,
  STATUS_LABEL,
  type Approval,
  type Project,
  type RecentThread,
  type Task,
  type TimelineItem,
  type TimelineView,
} from "./api";

type Phase = "loading" | "login" | "work";

const CHECK_KINDS = new Set(["commandExecution", "fileChange", "reasoning"]);

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 15V7h8" />
      <circle cx="15" cy="7" r="2" />
    </svg>
  );
}

function canDelete(status: string | null | undefined): boolean {
  return status !== "running" && status !== "waiting_approval";
}

function pieces(text: string, query: string): { text: string; hit: boolean }[] {
  const needle = query.trim();
  if (!needle) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  let index = lower.indexOf(target, cursor);
  while (index >= 0) {
    if (index > cursor) parts.push({ text: text.slice(cursor, index), hit: false });
    parts.push({ text: text.slice(index, index + target.length), hit: true });
    cursor = index + target.length;
    index = lower.indexOf(target, cursor);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts.length > 0 ? parts : [{ text, hit: false }];
}

type Block = { kind: "user" | "agent" | "checks"; items: TimelineItem[] };
type Turn = { id: string; user: TimelineItem | null; rest: Block[] };

function blocks(items: TimelineItem[]): Block[] {
  const result: Block[] = [];
  for (const item of items) {
    if (item.kind === "userMessage") result.push({ kind: "user", items: [item] });
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

function Highlight({ id, text, query }: { id: string; text: string; query: string }) {
  return (
    <>
      {pieces(text, query).map((part, index) =>
        part.hit ? (
          <mark className="find-hit" key={`${id}-${index}`}>
            {part.text}
          </mark>
        ) : (
          <span key={`${id}-${index}`}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectGit, setProjectGit] = useState(false);
  const [threads, setThreads] = useState<RecentThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [task, setTask] = useState<Task>(null);
  const [older, setOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [directory, setDirectory] = useState<"worktree" | "local">("worktree");
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [openChecks, setOpenChecks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [findText, setFindText] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [model, setModel] = useState("");
  const [sandbox, setSandbox] = useState("");
  const [approvalPolicy, setApprovalPolicy] = useState("");
  const [gitDiff, setGitDiff] = useState("");
  const [gitMessage, setGitMessage] = useState("");
  const [gitError, setGitError] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const sending = useRef(false);
  const transcriptRef = useRef<HTMLElement>(null);
  const followLatest = useRef(true);
  const preserveScroll = useRef<number | null>(null);
  const scrolling = useRef(false);

  function applyView(view: TimelineView) {
    setItems(view.items);
    setApprovals(view.approvals);
    setTask(view.task);
    setQueue(view.queue ?? []);
    setOlder(Boolean(view.older));
  }

  useEffect(() => {
    const fixture = import.meta.env.DEV && new URLSearchParams(window.location.search).get("fixture") === "1";
    const open = fixture ? api.login("secret") : Promise.resolve();
    open
      .then(() => Promise.all([api.account(), api.projects(), api.syncRecent()]))
      .then(async ([account, projectList]) => {
        setLoggedIn(account.loggedIn);
        setProjects(projectList.projects);
        setPhase("work");
        const listed = await api.recent();
        setThreads(listed.threads);
        const thread = listed.threads[0] ?? null;
        setProjectId(thread?.projectId ?? projectList.projects[0]?.id ?? null);
        setThreadId(thread?.id ?? null);
        if (thread) applyView(await api.timeline(thread.id));
      })
      .catch(() => setPhase("login"));
  }, []);

  useEffect(() => {
    if (!threadId || phase !== "work") return;
    const source = new EventSource(apiUrl(`/api/threads/${encodeURIComponent(threadId)}/events`));
    source.onmessage = (event) => {
      try {
        const body = JSON.parse(event.data) as
          | { type: "delta"; itemId: string; kind: string; text: string }
          | { type: "item"; item: TimelineItem }
          | { type: "status"; approvals: Approval[]; task: Task; queue?: string[] }
          | TimelineView;
        if ("type" in body && body.type === "delta") {
          setItems((current) => {
            const index = current.findIndex((item) => item.id === body.itemId);
            if (index < 0) return [...current, { id: body.itemId, kind: body.kind, text: body.text }];
            const next = current.slice();
            next[index] = { ...next[index], text: next[index].text + body.text };
            return next;
          });
          return;
        }
        if ("type" in body && body.type === "item") {
          setItems((current) => {
            const index = current.findIndex((item) => item.id === body.item.id);
            if (index < 0) return [...current, body.item];
            const next = current.slice();
            next[index] = body.item;
            return next;
          });
          return;
        }
        if ("type" in body && body.type === "status") {
          setApprovals(body.approvals);
          setTask(body.task);
          setQueue(body.queue ?? []);
          return;
        }
        applyView(body);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "对话刷新失败");
      }
    };
    return () => source.close();
  }, [threadId, phase]);

  useEffect(() => {
    if (phase !== "work") return;
    const source = new EventSource(apiUrl("/api/threads/recent/events"));
    source.onmessage = (event) => {
      if (showArchived) return;
      const body = JSON.parse(event.data) as { threads: RecentThread[] };
      setThreads(body.threads);
    };
    return () => source.close();
  }, [phase, showArchived]);

  useEffect(() => {
    if (task?.status !== "running" && task?.status !== "waiting_approval") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [task?.status, task?.turn_id]);

  useLayoutEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    if (preserveScroll.current != null) {
      scrolling.current = true;
      node.scrollTop = node.scrollHeight - preserveScroll.current;
      preserveScroll.current = null;
      scrolling.current = false;
      return;
    }
    if (!followLatest.current) return;
    scrolling.current = true;
    node.scrollTop = node.scrollHeight;
    scrolling.current = false;
  }, [items, approvals, queue, threadId]);

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api.login(password);
      const [account, projectList] = await Promise.all([api.account(), api.projects(), api.syncRecent()]);
      setLoggedIn(account.loggedIn);
      setProjects(projectList.projects);
      setPhase("work");
      setThreads((await api.recent()).threads);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    }
  }

  async function onLogout() {
    await api.logout();
    setPhase("login");
    setPassword("");
  }

  async function refreshRecent(archived = showArchived) {
    setThreads((await api.recent(archived)).threads);
  }

  function openPlus() {
    setPlusOpen(true);
    setMenuOpen(true);
  }

  async function pickProject(id: number) {
    setProjectId(id);
    setDirectory("worktree");
    const git = await api.projectGit(id);
    setProjectGit(git.git);
  }

  function beginDraft() {
    const nextProject = projectId ?? projects[0]?.id ?? null;
    if (!nextProject) return;
    setProjectId(nextProject);
    setPlusOpen(false);
    setMenuOpen(false);
    setMenuFor(null);
    setError("");
    setDrafting(true);
    setThreadId(null);
    setItems([]);
    setApprovals([]);
    setTask(null);
    setQueue([]);
    setOlder(false);
    setGitDiff("");
    setGitError("");
    setGitUrl("");
    setReviewOpen(false);
    setSettingsOpen(false);
  }

  async function chooseThread(item: RecentThread) {
    setMenuOpen(false);
    setPlusOpen(false);
    setMenuFor(null);
    setDrafting(false);
    setReviewOpen(false);
    setSettingsOpen(false);
    followLatest.current = true;
    setProjectId(item.projectId);
    setThreadId(item.id);
    applyView(await api.timeline(item.id));
  }

  async function loadOlder() {
    const earliest = items[0];
    const node = transcriptRef.current;
    if (!threadId || !earliest || !node) return;
    preserveScroll.current = node.scrollHeight - node.scrollTop;
    followLatest.current = false;
    const view = await api.timeline(threadId, earliest.id);
    setItems((current) => [...view.items, ...current]);
    setOlder(Boolean(view.older));
  }

  function onTranscriptScroll() {
    if (scrolling.current) return;
    const node = transcriptRef.current;
    if (!node) return;
    followLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  }

  async function onDeleteThread(item: RecentThread) {
    if (!canDelete(item.status)) return;
    if (!window.confirm("删除这条会话？对话记录会从服务器上去掉。")) return;
    setError("");
    try {
      await api.deleteThread(item.projectId, item.id);
      if (threadId === item.id) beginDraft();
      setMenuFor(null);
      await refreshRecent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没有删除");
    }
  }

  async function onAddProject(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await api.addProject(projectName, projectPath);
      setProjectName("");
      setProjectPath("");
      const projectList = await api.projects();
      setProjects(projectList.projects);
      setProjectId(created.project.id);
      const git = await api.projectGit(created.project.id);
      setProjectGit(git.git);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目没有登记");
    }
  }

  async function sendDraft() {
    if (sending.current || !projectId || draft.trim() === "") return;
    const text = draft.trim();
    sending.current = true;
    followLatest.current = true;
    setBusy(true);
    setError("");
    try {
      const created = await api.startTurn(
        projectId,
        text,
        drafting || !threadId ? undefined : threadId,
        drafting || !threadId ? (projectGit ? directory : "local") : undefined,
      );
      setDraft("");
      if (created.queued) {
        setQueue((current) => [...current, text]);
        return;
      }
      setDrafting(false);
      setThreadId(created.threadId);
      const listed = await api.recent(showArchived);
      setThreads(listed.threads);
      const mine = listed.threads.find((item) => item.id === created.threadId);
      if (mine) setProjectId(mine.projectId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没有开始");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function onStop() {
    if (!threadId) return;
    setError("");
    await api.interrupt(threadId);
  }

  function onDraftKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendDraft();
    }
  }

  async function onDecision(approvalId: string, decision: "accept" | "decline" | "acceptForSession") {
    setError("");
    await api.approve(approvalId, decision);
  }

  async function onRename(item: RecentThread) {
    const name = window.prompt("短标题", item.title);
    if (!name) return;
    await api.renameThread(item.projectId, item.id, name);
    setMenuFor(null);
    await refreshRecent();
  }

  async function onArchive(item: RecentThread) {
    await api.archiveThread(item.projectId, item.id);
    setMenuFor(null);
    if (threadId === item.id) {
      setThreadId(null);
      setItems([]);
      setDrafting(true);
    }
    await refreshRecent();
  }

  async function onUnarchive(item: RecentThread) {
    await api.unarchiveThread(item.projectId, item.id);
    setMenuFor(null);
    await refreshRecent(true);
  }

  async function onFork(item: RecentThread) {
    const created = await api.forkThread(item.projectId, item.id);
    setMenuFor(null);
    setDrafting(false);
    setProjectId(item.projectId);
    setThreadId(created.threadId);
    applyView(await api.timeline(created.threadId));
    await refreshRecent();
  }

  async function openSettings() {
    setReviewOpen(false);
    setSettingsOpen(true);
    if (!loggedIn || models.length > 0) return;
    const listed = await api.models().catch(() => ({ models: [] }));
    setModels(listed.models);
  }

  async function openReview() {
    if (!projectId) return;
    const git = await api.projectGit(projectId);
    setProjectGit(git.git);
    setSettingsOpen(false);
    setReviewOpen(true);
  }

  async function onSettings(next: { model?: string; sandbox?: string; approvalPolicy?: string }) {
    if (!loggedIn || !threadId) return;
    if (next.model !== undefined) setModel(next.model);
    if (next.sandbox !== undefined) setSandbox(next.sandbox);
    if (next.approvalPolicy !== undefined) setApprovalPolicy(next.approvalPolicy);
    const patch = {
      ...(next.model ? { model: next.model } : {}),
      ...(next.sandbox ? { sandbox: next.sandbox } : {}),
      ...(next.approvalPolicy ? { approvalPolicy: next.approvalPolicy } : {}),
    };
    if (!patch.model && !patch.sandbox && !patch.approvalPolicy) return;
    await api.saveSettings(threadId, patch);
  }

  async function onGit(action: string) {
    if (!projectId || !threadId) return;
    setGitError("");
    setGitUrl("");
    const result = await api.git(projectId, threadId, {
      action,
      message: gitMessage,
      title: gitMessage || "Update",
      paths: action === "stage" || action === "revert" ? ["."] : undefined,
    });
    if (result.diff !== undefined) setGitDiff(result.diff);
    if (result.error) setGitError(result.error);
    if (result.url) setGitUrl(result.url);
  }

  async function toggleArchived() {
    const next = !showArchived;
    setShowArchived(next);
    setPlusOpen(false);
    await refreshRecent(next);
  }

  if (phase === "loading") {
    return (
      <main className="sheet login-sheet">
        <div className="skeleton" style={{ height: 22, width: 140 }} />
      </main>
    );
  }

  if (phase === "login") {
    return (
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <Mark />
            <span>Codex Web</span>
          </div>
          <p className="group-label">这台服务器</p>
          <p className="login-note">项目、会话和审批都留在服务器上。关掉浏览器，正在跑的任务不会停。</p>
        </aside>
        <div className="frame">
          <header className="topbar">
            <span className="brand">
              <Mark />
              <span>Codex Web</span>
            </span>
          </header>
          <main className="sheet fit">
            <div className="title-row">
              <div>
                <h1>进入工作区</h1>
                <p className="sub">用配置里的网页密码。它和 Codex 账号不是同一个。</p>
              </div>
            </div>
            <div className="login-grid">
              <form className="field login-form" onSubmit={onLogin}>
                <label htmlFor="password">密码</label>
                <input id="password" className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
                {error ? <p className="error-line">{error}</p> : null}
                <button className="btn primary" type="submit">
                  进入
                </button>
              </form>
              <section className="login-facts">
                <h2>进去之后</h2>
                <div className="row">
                  <span className="kind">项目</span>
                  <span>只登记允许目录里的路径</span>
                </div>
                <div className="row">
                  <span className="kind">会话</span>
                  <span>记录留在 Codex 里，换一台电脑也能接着看</span>
                </div>
                <div className="row">
                  <span className="kind">任务</span>
                  <span>多条会话可以同时跑，审批和停止都在这条对话里</span>
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const thread = threads.find((item) => item.id === threadId) ?? null;
  const status = task ? STATUS_LABEL[task.status] ?? task.status : "";
  const canStop = task?.status === "running" || task?.status === "waiting_approval";
  const visibleItems = items.filter((item) => item.text.trim() !== "" || item.command);
  const turns = groupTurns(blocks(visibleItems));
  const elapsed = spent(task, now);

  return (
    <div className="app">
      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <Mark />
          <span>Codex Web</span>
        </div>
        <button className="btn" type="button" onClick={openPlus}>
          新聊天
        </button>
        <p className="group-label">{showArchived ? "已归档" : "最近"}</p>
        <div className="thread-list recent-list">
          {threads.length === 0 ? <p className="empty">还没有会话</p> : null}
          {threads.map((item) => (
            <div key={item.id} className="nav-row">
              <button className="nav-item recent-row" type="button" aria-current={item.id === threadId && !drafting ? "page" : undefined} onClick={() => void chooseThread(item)}>
                <span className="nav-copy">
                  <span className="nav-title">{item.title}</span>
                  <small className="recent-project">
                    {item.projectName}
                    {item.status === "running"
                      ? " · 执行中"
                      : item.status === "waiting_approval"
                        ? " · 待审批"
                        : item.status === "interrupted"
                          ? " · 已停止"
                          : item.pending
                            ? " · 待审批"
                            : ""}
                  </small>
                </span>
              </button>
              <button className="nav-delete" type="button" aria-label={`会话菜单 ${item.title}`} onClick={() => setMenuFor((current) => (current === item.id ? null : item.id))}>
                ···
              </button>
              {menuFor === item.id ? (
                <div className="thread-menu" role="menu">
                  {showArchived ? (
                    <button className="btn" type="button" onClick={() => void onUnarchive(item)}>
                      恢复
                    </button>
                  ) : (
                    <>
                      <button className="btn" type="button" onClick={() => void onRename(item)}>
                        改名
                      </button>
                      <button className="btn" type="button" onClick={() => void onArchive(item)}>
                        归档
                      </button>
                      <button className="btn" type="button" onClick={() => void onFork(item)}>
                        分叉
                      </button>
                      <button className="nav-delete" type="button" aria-label={`删除会话 ${item.id}`} disabled={!canDelete(item.status)} onClick={() => void onDeleteThread(item)}>
                        删除
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {plusOpen ? (
          <div className="plus-panel" role="dialog" aria-label="新聊天">
            {projects.map((item) => (
              <button className={item.id === projectId ? "btn primary" : "btn"} key={item.id} type="button" onClick={() => void pickProject(item.id)}>
                {item.name}
              </button>
            ))}
            {projectGit ? (
              <fieldset className="directory-choice">
                <legend>新会话写到哪里</legend>
                <label>
                  <input type="radio" name="directory" checked={directory === "worktree"} onChange={() => setDirectory("worktree")} />
                  单独 worktree
                </label>
                <label>
                  <input type="radio" name="directory" checked={directory === "local"} onChange={() => setDirectory("local")} />
                  直接改这个目录
                </label>
              </fieldset>
            ) : null}
            <button className="btn primary" type="button" onClick={beginDraft} disabled={projects.length === 0}>
              开始
            </button>
            <form className="sidebar-form" onSubmit={onAddProject}>
              <input className="input" aria-label="项目名称" placeholder="项目名称" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
              <input className="input" aria-label="项目路径" placeholder="服务器上的路径" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} />
              <button className="btn" type="submit">
                登记项目
              </button>
            </form>
            <button className="btn ghost" type="button" onClick={() => void toggleArchived()}>
              {showArchived ? "回到最近" : "已归档"}
            </button>
          </div>
        ) : null}
        <button className="btn sidebar-corner" type="button" aria-label="添加" onClick={openPlus}>
          +
        </button>
      </aside>
      <div className="frame">
        <header className="topbar">
          <button className="btn menu-toggle" type="button" onClick={() => setMenuOpen((open) => !open)}>
            目录
          </button>
          <div className="brand">
            <Mark />
            <span>{thread && !drafting ? thread.projectName : "对话"}</span>
          </div>
          <div className="topbar-actions">
            <span className={loggedIn ? "pill pos" : "pill warn"}>{loggedIn ? "Codex 已登录" : "Codex 未登录"}</span>
            <button className="btn ghost" type="button" onClick={() => void onLogout()}>
              退出
            </button>
          </div>
        </header>
        <main className="sheet chat-sheet">
          <div className="title-row">
            <div>
              <h1>{drafting || !thread ? "新会话" : thread.title}</h1>
              {status && !drafting ? <p className="sub">{status}</p> : null}
            </div>
          </div>
          {!loggedIn ? <p className="notice">Codex 未登录。可以查看已有项目，还不能开始新的任务。</p> : null}
          {error ? <p className="error-line">{error}</p> : null}
          <section className="transcript" ref={transcriptRef} onScroll={onTranscriptScroll}>
            <div className="dialogue">
              {older ? (
                <button className="btn ghost" type="button" onClick={() => void loadOlder()}>
                  继续查看
                </button>
              ) : null}
              {visibleItems.length === 0 ? <p className="empty">这条会话还没有对话</p> : null}
              {turns.map((turn, index) => (
                <section className="turn" key={turn.id}>
                  {turn.user ? (
                    <article className="bubble mine">
                      <p>
                        <Highlight id={turn.user.id} text={turn.user.text} query={findText} />
                      </p>
                    </article>
                  ) : null}
                  {turn.rest.length > 0 || (index === turns.length - 1 && elapsed) ? (
                    <div className="reply">
                      {turn.rest.map((block) => {
                        if (block.kind === "agent") {
                          const item = block.items[0];
                          return (
                            <p className="prose" key={item.id}>
                              <Highlight id={item.id} text={item.text} query={findText} />
                            </p>
                          );
                        }
                        const open = Boolean(openChecks[block.items[0].id]);
                        return (
                          <div className="checks" key={block.items[0].id}>
                            <button
                              className="btn ghost"
                              type="button"
                              aria-expanded={open}
                              onClick={() => setOpenChecks((current) => ({ ...current, [block.items[0].id]: !open }))}
                            >
                              检查项 {block.items.length}
                            </button>
                            {open
                              ? block.items.map((item) => (
                                  <div key={item.id}>
                                    {item.command ? <pre className="command-line">{item.command}</pre> : null}
                                    {item.text.trim() ? <pre className="command-line">{item.text}</pre> : null}
                                  </div>
                                ))
                              : null}
                          </div>
                        );
                      })}
                      {index === turns.length - 1 && elapsed ? <p className="reply-time">用时 {elapsed}</p> : null}
                    </div>
                  ) : null}
                </section>
              ))}
              {approvals.map((approval) => {
                let payload: { text?: string } = {};
                try {
                  payload = JSON.parse(approval.payload) as { text?: string };
                } catch {
                  payload = {};
                }
                return (
                  <article className="bubble approval-inline" key={approval.id}>
                    <p>{payload.text || approval.kind}</p>
                    <div className="row">
                      <button className="btn primary" type="button" onClick={() => void onDecision(approval.id, "accept")}>
                        允许这一次
                      </button>
                      <button className="btn" type="button" onClick={() => void onDecision(approval.id, "acceptForSession")}>
                        这一会话都允许
                      </button>
                      <button className="btn" type="button" onClick={() => void onDecision(approval.id, "decline")}>
                        拒绝
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
          {settingsOpen ? (
            <div className="tool-layer" role="dialog" aria-label="自定义">
              <input className="input" aria-label="在对话中查找" placeholder="在这条对话里查找" value={findText} onChange={(event) => setFindText(event.target.value)} />
              <label>
                模型
                <select aria-label="模型" disabled={!loggedIn || !threadId} value={model} onChange={(event) => void onSettings({ model: event.target.value })}>
                  <option value="">沿用当前</option>
                  {models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                沙箱
                <select aria-label="沙箱" disabled={!loggedIn || !threadId} value={sandbox} onChange={(event) => void onSettings({ sandbox: event.target.value })}>
                  <option value="">沿用当前</option>
                  <option value="read-only">只读</option>
                  <option value="workspace-write">工作区可写</option>
                  <option value="danger-full-access">完全访问</option>
                </select>
              </label>
              <label>
                审批
                <select aria-label="审批策略" disabled={!loggedIn || !threadId} value={approvalPolicy} onChange={(event) => void onSettings({ approvalPolicy: event.target.value })}>
                  <option value="">沿用当前</option>
                  <option value="untrusted">每次询问</option>
                  <option value="on-request">按需询问</option>
                  <option value="never">不再询问</option>
                </select>
              </label>
              <button className="btn ghost" type="button" onClick={() => setSettingsOpen(false)}>
                关闭
              </button>
            </div>
          ) : null}
          {reviewOpen ? (
            <section className="tool-layer" aria-label="审查">
              <div className="row">
                <button className="btn" type="button" onClick={() => void onGit("diff")}>
                  查看 diff
                </button>
                <button className="btn" type="button" onClick={() => void onGit("stage")}>
                  暂存
                </button>
                <button className="btn" type="button" onClick={() => void onGit("revert")}>
                  还原
                </button>
                <button className="btn" type="button" onClick={() => void onGit("commit")}>
                  提交
                </button>
                <button className="btn" type="button" onClick={() => void onGit("push")}>
                  推送
                </button>
                <button className="btn" type="button" onClick={() => void onGit("pr")}>
                  创建 pull request
                </button>
              </div>
              <input className="input" aria-label="提交说明" placeholder="提交说明" value={gitMessage} onChange={(event) => setGitMessage(event.target.value)} />
              {gitDiff ? <pre>{gitDiff}</pre> : null}
              {gitError ? <p className="error-line">{gitError}</p> : null}
              {gitUrl ? <p>{gitUrl}</p> : null}
              <button className="btn ghost" type="button" onClick={() => setReviewOpen(false)}>
                关闭
              </button>
            </section>
          ) : null}
          {queue.length > 0 ? <p className="queue-note">已排队：{queue.join(" / ")}</p> : null}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void sendDraft();
            }}
          >
            <textarea
              aria-label="要发送的话"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onDraftKey}
              placeholder={loggedIn ? (thread && !drafting ? "接着这条会话说" : "写下第一句，开始新会话") : "Codex 未登录，发送会被拒绝"}
            />
            <div className="composer-actions">
              {thread && !drafting ? (
                <button className="btn ghost" type="button" onClick={() => void openReview()}>
                  审查
                </button>
              ) : null}
              {thread && !drafting ? (
                <button className="btn ghost" type="button" onClick={() => void openSettings()}>
                  自定义
                </button>
              ) : null}
              {canStop && !drafting ? (
                <button className="btn primary" type="button" onClick={() => void onStop()}>
                  停止
                </button>
              ) : (
                <button className="btn primary" type="submit" disabled={busy || draft.trim() === "" || !projectId}>
                  发送
                </button>
              )}
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}

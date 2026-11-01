import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  api,
  apiUrl,
  STATUS_LABEL,
  type Approval,
  type Project,
  type Task,
  type ThreadSummary,
  type TimelineItem,
} from "./api";

type Phase = "loading" | "login" | "work";

const KIND_LABEL: Record<string, string> = {
  userMessage: "你说的",
  agentMessage: "助手",
  commandExecution: "命令",
  fileChange: "文件变更",
  reasoning: "思考",
};

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

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectGit, setProjectGit] = useState(false);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [task, setTask] = useState<Task>(null);
  const [draft, setDraft] = useState("");
  const [directory, setDirectory] = useState<"worktree" | "local">("worktree");
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
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

  function applyView(view: { items: TimelineItem[]; approvals: Approval[]; task: Task; queue?: string[] }) {
    setItems(view.items);
    setApprovals(view.approvals);
    setTask(view.task);
    setQueue(view.queue ?? []);
  }

  async function loadWorkspace(nextProject = projectId, nextThread = threadId, archived = showArchived) {
    const [account, projectList] = await Promise.all([api.account(), api.projects()]);
    setLoggedIn(account.loggedIn);
    setProjects(projectList.projects);
    if (account.loggedIn) {
      const listed = await api.models().catch(() => ({ models: [] }));
      setModels(listed.models);
    } else {
      setModels([]);
    }
    const project = projectList.projects.find((item) => item.id === nextProject) ?? projectList.projects[0] ?? null;
    setProjectId(project?.id ?? null);
    if (!project) {
      setThreads([]);
      setThreadId(null);
      setItems([]);
      setApprovals([]);
      setTask(null);
      setQueue([]);
      return;
    }
    const threadList = await api.threads(project.id, archived);
    setProjectGit(threadList.git);
    setThreads(threadList.threads);
    if (drafting && nextThread === null) {
      setThreadId(null);
      setItems([]);
      setApprovals([]);
      setTask(null);
      setQueue([]);
      return;
    }
    const thread = threadList.threads.find((item) => item.id === nextThread) ?? threadList.threads[0] ?? null;
    setThreadId(thread?.id ?? null);
    if (!thread) {
      setItems([]);
      setApprovals([]);
      setTask(null);
      setQueue([]);
      return;
    }
    applyView(await api.timeline(thread.id));
  }

  useEffect(() => {
    const fixture = import.meta.env.DEV && new URLSearchParams(window.location.search).get("fixture") === "1";
    const open = fixture ? api.login("secret") : Promise.resolve();
    open
      .then(() => api.projects())
      .then(() => {
        setPhase("work");
        return loadWorkspace();
      })
      .catch(() => setPhase("login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          | { items: TimelineItem[]; approvals: Approval[]; task: Task; queue?: string[] };
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
        setError(reason instanceof Error ? reason.message : "时间线刷新失败");
      }
    };
    return () => source.close();
  }, [threadId, phase]);

  useEffect(() => {
    if (!projectId || phase !== "work") return;
    const source = new EventSource(apiUrl(`/api/projects/${projectId}/events`));
    source.onmessage = (event) => {
      if (showArchived) return;
      const body = JSON.parse(event.data) as { threads: ThreadSummary[]; git: boolean };
      setThreads(body.threads);
      setProjectGit(body.git);
    };
    return () => source.close();
  }, [projectId, phase, showArchived]);

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api.login(password);
      setPhase("work");
      await loadWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    }
  }

  async function onLogout() {
    await api.logout();
    setPhase("login");
    setPassword("");
  }

  async function chooseProject(id: number) {
    setMenuOpen(false);
    setDrafting(false);
    setError("");
    setProjectId(id);
    const threadList = await api.threads(id, showArchived);
    setProjectGit(threadList.git);
    setThreads(threadList.threads);
    const thread = threadList.threads[0] ?? null;
    setThreadId(thread?.id ?? null);
    if (!thread) {
      setItems([]);
      setApprovals([]);
      setTask(null);
      setQueue([]);
      return;
    }
    applyView(await api.timeline(thread.id));
  }

  async function chooseThread(id: string) {
    setMenuOpen(false);
    setDrafting(false);
    setThreadId(id);
    applyView(await api.timeline(id));
  }

  function startFresh() {
    setMenuOpen(false);
    setError("");
    setDrafting(true);
    setDirectory("worktree");
    setThreadId(null);
    setItems([]);
    setApprovals([]);
    setTask(null);
    setQueue([]);
    setGitDiff("");
    setGitError("");
    setGitUrl("");
  }

  async function onDeleteThread(id: string, status: string | null | undefined) {
    if (!projectId || !canDelete(status)) return;
    if (!window.confirm("删除这条会话？对话记录会从服务器上去掉。")) return;
    setError("");
    try {
      await api.deleteThread(projectId, id);
      if (threadId === id) startFresh();
      const threadList = await api.threads(projectId, showArchived);
      setThreads(threadList.threads);
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
      setDrafting(false);
      await loadWorkspace(created.project.id, null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目没有登记");
    }
  }

  async function sendDraft() {
    if (!projectId || draft.trim() === "") return;
    setBusy(true);
    setError("");
    try {
      const created = await api.startTurn(projectId, draft.trim(), drafting ? undefined : (threadId ?? undefined), drafting ? (projectGit ? directory : "local") : undefined);
      setDraft("");
      setDrafting(false);
      if (created.queued) {
        const view = await api.timeline(created.threadId);
        applyView(view);
        return;
      }
      await loadWorkspace(projectId, created.threadId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没有开始");
      await loadWorkspace(projectId, threadId);
    } finally {
      setBusy(false);
    }
  }

  async function onStop() {
    if (!threadId) return;
    setError("");
    await api.interrupt(threadId);
    applyView(await api.timeline(threadId));
    if (projectId) {
      const threadList = await api.threads(projectId, showArchived);
      setThreads(threadList.threads);
    }
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
    if (threadId) applyView(await api.timeline(threadId));
  }

  async function onRename() {
    if (!projectId || !threadId) return;
    const name = window.prompt("短标题", thread?.title ?? "");
    if (!name) return;
    await api.renameThread(projectId, threadId, name);
    const threadList = await api.threads(projectId, showArchived);
    setThreads(threadList.threads);
  }

  async function onArchive() {
    if (!projectId || !threadId) return;
    await api.archiveThread(projectId, threadId);
    startFresh();
    const threadList = await api.threads(projectId, showArchived);
    setThreads(threadList.threads);
  }

  async function onUnarchive(id: string) {
    if (!projectId) return;
    await api.unarchiveThread(projectId, id);
    const threadList = await api.threads(projectId, true);
    setThreads(threadList.threads);
  }

  async function onFork() {
    if (!projectId || !threadId) return;
    const created = await api.forkThread(projectId, threadId);
    setDrafting(false);
    await loadWorkspace(projectId, created.threadId);
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

  const project = projects.find((item) => item.id === projectId) ?? null;
  const thread = threads.find((item) => item.id === threadId) ?? null;
  const status = task ? STATUS_LABEL[task.status] ?? task.status : "还没有任务";
  const canStop = task?.status === "running" || task?.status === "waiting_approval";
  const visibleItems = items.filter((item) => item.text.trim() !== "" || item.command);

  return (
    <div className="app">
      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <Mark />
          <span>Codex Web</span>
        </div>
        <label className="field">
          <span className="group-label">项目</span>
          <select className="input" aria-label="当前项目" value={projectId ?? ""} onChange={(event) => void chooseProject(Number(event.target.value))}>
            {projects.length === 0 ? <option value="">还没有项目</option> : null}
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="button" onClick={startFresh}>
          新建会话
        </button>
        <button className="btn ghost" type="button" onClick={() => void loadWorkspace(projectId, threadId, !showArchived).then(() => setShowArchived((value) => !value))}>
          {showArchived ? "回到会话" : "已归档"}
        </button>
        <div className="thread-list">
          {threads.length === 0 ? <p className="empty">这个项目还没有会话</p> : null}
          {threads.map((item) => (
            <div key={item.id} className="nav-row">
              <button className="nav-item" type="button" aria-current={item.id === threadId ? "page" : undefined} onClick={() => void chooseThread(item.id)}>
                <span className="nav-copy">
                  <span className="nav-title">{item.title}</span>
                  <small>
                    {item.status === "running" ? "执行中" : item.status === "waiting_approval" ? "待审批" : item.pending ? "待审批" : ""}
                    {item.pending ? ` ${item.pending}` : ""}
                  </small>
                </span>
              </button>
              {showArchived ? (
                <button className="nav-delete" type="button" onClick={() => void onUnarchive(item.id)}>
                  恢复
                </button>
              ) : (
                <button
                  className="nav-delete"
                  type="button"
                  aria-label={`删除会话 ${item.id}`}
                  disabled={!canDelete(item.status)}
                  onClick={() => void onDeleteThread(item.id, item.status)}
                >
                  删除
                </button>
              )}
            </div>
          ))}
        </div>
        <form className="sidebar-form sidebar-corner" onSubmit={onAddProject}>
          <input className="input" aria-label="项目名称" placeholder="项目名称" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
          <input className="input" aria-label="项目路径" placeholder="服务器上的路径" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} />
          <button className="btn" type="submit">
            登记项目
          </button>
        </form>
      </aside>
      <div className="frame">
        <header className="topbar">
          <button className="btn menu-toggle" type="button" onClick={() => setMenuOpen((open) => !open)}>
            目录
          </button>
          <div className="brand">
            <Mark />
            <span>{project?.name ?? "工作区"}</span>
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
              <h1>{drafting ? "新会话" : thread?.title ?? "新会话"}</h1>
              <p className="sub">{thread && !drafting ? status : "发送第一句后会出现在左侧"}</p>
            </div>
            {thread && !drafting ? (
              <div className="topbar-actions">
                <button className="btn" type="button" onClick={() => void onRename()}>
                  改名
                </button>
                <button className="btn" type="button" onClick={() => void onArchive()}>
                  归档
                </button>
                <button className="btn" type="button" onClick={() => void onFork()}>
                  分叉
                </button>
              </div>
            ) : null}
          </div>
          {!loggedIn ? <p className="notice">Codex 未登录。可以查看已有项目，还不能开始新的任务。</p> : null}
          {error ? <p className="error-line">{error}</p> : null}
          <div className="chat-tools">
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
          </div>
          <section className="transcript">
            <div className="dialogue">
              {visibleItems.length === 0 ? <p className="empty">这条会话还没有对话</p> : null}
              {visibleItems.map((item) => (
                <article className={item.kind === "userMessage" ? "bubble mine" : "bubble"} key={item.id}>
                  <span className="kind">{KIND_LABEL[item.kind] ?? item.kind}</span>
                  {item.command ? <pre className="command-line">{item.command}</pre> : null}
                  {item.text.trim() ? (
                    <p>
                      {pieces(item.text, findText).map((part, index) =>
                        part.hit ? (
                          <mark className="find-hit" key={`${item.id}-${index}`}>
                            {part.text}
                          </mark>
                        ) : (
                          <span key={`${item.id}-${index}`}>{part.text}</span>
                        ),
                      )}
                    </p>
                  ) : null}
                </article>
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
                    <span className="kind">审批</span>
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
          {projectGit && thread && !drafting ? (
            <section className="git-panel">
              <header>
                <h2>Git</h2>
              </header>
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
            </section>
          ) : null}
          {queue.length > 0 ? <p className="queue-note">已排队：{queue.join(" / ")}</p> : null}
          {drafting && projectGit ? (
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
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void sendDraft();
            }}
          >
            <textarea aria-label="要发送的话" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onDraftKey} placeholder={loggedIn ? (thread && !drafting ? "接着这条会话说" : "写下第一句，开始新会话") : "Codex 未登录，发送会被拒绝"} />
            {canStop && !drafting ? (
              <button className="btn primary" type="button" onClick={() => void onStop()}>
                停止
              </button>
            ) : (
              <button className="btn primary" type="submit" disabled={busy || draft.trim() === ""}>
                发送
              </button>
            )}
          </form>
        </main>
      </div>
    </div>
  );
}

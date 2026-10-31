import { useEffect, useState, type FormEvent } from "react";
import { api, apiUrl, STATUS_LABEL, type Approval, type Project, type Task, type ThreadSummary, type TimelineItem } from "./api";

type Phase = "loading" | "login" | "work";

const KIND_LABEL: Record<string, string> = {
  userMessage: "你说的",
  agentMessage: "助手",
  commandExecution: "命令",
  fileChange: "文件变更",
  reasoning: "思考",
};

function commandTitle(status: string | undefined): string {
  if (status === "running" || status === "waiting_approval") return "正在执行的命令";
  if (status === "failed") return "失败的命令";
  if (status === "interrupted") return "中断的命令";
  if (status === "completed") return "已经跑完的命令";
  return "命令";
}

function statusPill(status: string | undefined): string {
  if (status === "completed") return "pill pos";
  if (status === "failed") return "pill neg";
  if (status === "waiting_approval" || status === "interrupted") return "pill warn";
  return "pill";
}

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 15V7h8" />
      <circle cx="15" cy="7" r="2" />
    </svg>
  );
}

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [task, setTask] = useState<Task>(null);
  const [draft, setDraft] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadWorkspace(nextProject = projectId, nextThread = threadId) {
    const [account, projectList] = await Promise.all([api.account(), api.projects()]);
    setLoggedIn(account.loggedIn);
    setProjects(projectList.projects);
    const project = projectList.projects.find((item) => item.id === nextProject) ?? projectList.projects[0] ?? null;
    setProjectId(project?.id ?? null);
    if (!project) {
      setThreads([]);
      setThreadId(null);
      setItems([]);
      setApprovals([]);
      setTask(null);
      return;
    }
    const threadList = await api.threads(project.id);
    setThreads(threadList.threads);
    const thread = threadList.threads.find((item) => item.id === nextThread) ?? threadList.threads[0] ?? null;
    setThreadId(thread?.id ?? null);
    if (!thread) {
      setItems([]);
      setApprovals([]);
      setTask(null);
      return;
    }
    const view = await api.timeline(thread.id);
    setItems(view.items);
    setApprovals(view.approvals);
    setTask(view.task);
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
    // The first load has no selected project yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!threadId || phase !== "work") return;
    const source = new EventSource(apiUrl(`/api/threads/${encodeURIComponent(threadId)}/events`));
    source.onmessage = () => {
      void api
        .timeline(threadId)
        .then((view) => {
          setItems(view.items);
          setApprovals(view.approvals);
          setTask(view.task);
        })
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "时间线刷新失败"));
    };
    return () => source.close();
  }, [threadId, phase]);

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
    setError("");
    setProjectId(id);
    const threadList = await api.threads(id);
    setThreads(threadList.threads);
    const thread = threadList.threads[0] ?? null;
    setThreadId(thread?.id ?? null);
    if (!thread) {
      setItems([]);
      setApprovals([]);
      setTask(null);
      return;
    }
    const view = await api.timeline(thread.id);
    setItems(view.items);
    setApprovals(view.approvals);
    setTask(view.task);
  }

  async function chooseThread(id: string) {
    setMenuOpen(false);
    setThreadId(id);
    const view = await api.timeline(id);
    setItems(view.items);
    setApprovals(view.approvals);
    setTask(view.task);
  }

  function startFresh() {
    setMenuOpen(false);
    setError("");
    setThreadId(null);
    setItems([]);
    setApprovals([]);
    setTask(null);
  }

  async function onDeleteThread(id: string) {
    if (!projectId) return;
    if (!window.confirm("删除这条会话？对话记录会从服务器上去掉。")) return;
    setError("");
    try {
      await api.deleteThread(projectId, id);
      if (threadId === id) startFresh();
      const threadList = await api.threads(projectId);
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
      await loadWorkspace(created.project.id, null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目没有登记");
    }
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    if (!projectId || draft.trim() === "") return;
    setBusy(true);
    setError("");
    try {
      const created = await api.startTurn(projectId, draft.trim(), threadId ?? undefined);
      setDraft("");
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
    const view = await api.timeline(threadId);
    setItems(view.items);
    setApprovals(view.approvals);
    setTask(view.task);
  }

  async function onDecision(approvalId: string, decision: "accept" | "decline") {
    setError("");
    await api.approve(approvalId, decision);
    if (threadId) {
      const view = await api.timeline(threadId);
      setItems(view.items);
      setApprovals(view.approvals);
      setTask(view.task);
    }
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
                  <span>同一时间只跑一个，审批和停止都在这一页</span>
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
  const command = [...items].reverse().find((item) => item.kind === "commandExecution") ?? null;
  const transcript = items.filter((item) => item.id !== command?.id && item.text.trim() !== "");
  const status = task ? STATUS_LABEL[task.status] ?? task.status : "还没有任务";
  const canStop = task?.status === "running" || task?.status === "waiting_approval";

  return (
    <div className="app">
      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <Mark />
          <span>Codex Web</span>
        </div>
        <p className="group-label">项目</p>
        {projects.length === 0 ? <p className="empty">还没有登记项目</p> : null}
        {projects.map((item) => (
          <button key={item.id} className="nav-item" type="button" aria-current={item.id === projectId ? "page" : undefined} onClick={() => void chooseProject(item.id)}>
            <span className="nav-copy">
              <span className="nav-title">{item.name}</span>
              <small>{item.path}</small>
            </span>
          </button>
        ))}
        <form className="sidebar-form" onSubmit={onAddProject}>
          <input className="input" aria-label="项目名称" placeholder="项目名称" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
          <input className="input" aria-label="项目路径" placeholder="服务器上的路径" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} />
          <button className="btn" type="submit">
            登记项目
          </button>
        </form>
        <p className="group-label">会话</p>
        <button className="btn" type="button" onClick={startFresh}>
          新建会话
        </button>
        {project && threads.length === 0 ? <p className="empty">这个项目还没有会话</p> : null}
        {threads.map((item) => (
          <div key={item.id} className="nav-row">
            <button className="nav-item" type="button" aria-current={item.id === threadId ? "page" : undefined} onClick={() => void chooseThread(item.id)}>
              <span className="nav-copy">
                <span className="nav-title">{item.title}</span>
                <small className="mono">{item.id}</small>
              </span>
            </button>
            <button
              className="nav-delete"
              type="button"
              aria-label={`删除会话 ${item.id}`}
              onClick={() => void onDeleteThread(item.id)}
            >
              删除
            </button>
          </div>
        ))}
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
        <main className="sheet">
          <div className="title-row">
            <div>
              <h1>{thread ? thread.title : "新会话"}</h1>
              <p className="sub">
                {thread ? <span className="mono">{thread.id}</span> : "发送第一句后会出现在左侧"}
                {" · "}
                {status}
              </p>
            </div>
            <button className="btn" type="button" disabled={!canStop} onClick={() => void onStop()}>
              停止
            </button>
          </div>
          {!loggedIn ? <p className="notice">Codex 未登录。可以查看已有项目，还不能开始新的任务。</p> : null}
          {error ? <p className="error-line">{error}</p> : null}
          <section className="transcript">
            <header>
              <h2>对话</h2>
            </header>
            {transcript.length === 0 ? <p className="empty">这条会话还没有对话</p> : null}
            <div className="dialogue">
              {transcript.map((item) => (
                <article className={item.kind === "userMessage" ? "bubble mine" : "bubble"} key={item.id}>
                  <span className="kind">{KIND_LABEL[item.kind] ?? item.kind}</span>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="command-card" data-live={task?.status === "running" ? "true" : "false"}>
            <header>
              <h2>{commandTitle(task?.status)}</h2>
              {task ? <span className={statusPill(task.status)}>{status}</span> : null}
            </header>
            {command?.command ? <pre className="command-line">{command.command}</pre> : null}
            {command?.text.trim() ? <pre>{command.text}</pre> : null}
            {!command?.command && !command?.text.trim() ? <p className="empty">这条会话还没有命令输出</p> : null}
          </section>
          <section>
            <header>
              <h2>待批</h2>
            </header>
            {approvals.length === 0 ? <p className="empty">没有待批的命令</p> : null}
            {approvals.map((approval) => {
              let payload: { text?: string } = {};
              try {
                payload = JSON.parse(approval.payload) as { text?: string };
              } catch {
                payload = {};
              }
              return (
                <div className="row" key={approval.id}>
                  <span>{payload.text || approval.kind}</span>
                  <button className="btn primary" type="button" onClick={() => void onDecision(approval.id, "accept")}>
                    允许
                  </button>
                  <button className="btn" type="button" onClick={() => void onDecision(approval.id, "decline")}>
                    拒绝
                  </button>
                </div>
              );
            })}
          </section>
          <form className="composer" onSubmit={onSend}>
            <textarea aria-label="要发送的话" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={loggedIn ? (thread ? "接着这条会话说" : "写下第一句，开始新会话") : "Codex 未登录，发送会被拒绝"} />
            <button className="btn primary" type="submit" disabled={busy || draft.trim() === ""}>
              发送
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}

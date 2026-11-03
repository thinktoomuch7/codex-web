"use client";

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { Workspace } from "./shell";
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

function Markdown({ text }: { text: string }) {
  const parts = text.split("```");
  return (
    <div className="md">
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <pre key={index}>{part.replace(/^[^\n]*\n/, "")}</pre>
        ) : (
          part.split("\n").map((line, lineIndex) => <p key={`${index}-${lineIndex}`}>{line || " "}</p>)
        ),
      )}
    </div>
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
  const [titleQuery, setTitleQuery] = useState("");
  const [pane, setPane] = useState<"chat" | "files" | "git" | "terminal">("chat");
  const [fileDir, setFileDir] = useState("");
  const [fileEntries, setFileEntries] = useState<{ name: string; kind: "dir" | "file" }[]>([]);
  const [preview, setPreview] = useState("");
  const [browsePath, setBrowsePath] = useState("");
  const [browseParent, setBrowseParent] = useState("");
  const [browseEntries, setBrowseEntries] = useState<{ name: string; kind: "dir" | "file" }[]>([]);
  const [dirName, setDirName] = useState("");
  const [termId, setTermId] = useState("");
  const [termOut, setTermOut] = useState("");
  const [termLine, setTermLine] = useState("");
  const [termError, setTermError] = useState("");
  const [gitFiles, setGitFiles] = useState<string[]>([]);
  const [extras, setExtras] = useState({ usage: false, compact: false, thinking: false });
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
  const transcriptRef = useRef<HTMLDivElement>(null);
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
    const fixture = process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("fixture") === "1";
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
        if (thread) {
          applyView(await api.timeline(thread.id));
          const listedFiles = await api.files(thread.projectId, thread.id, "").catch(() => null);
          if (listedFiles) {
            setFileDir("");
            setFileEntries(listedFiles.entries);
          }
        }
        const listedModels = await api.models().catch(() => ({ models: [] }));
        setModels(listedModels.models);
        setExtras(await api.capabilities().catch(() => ({ usage: false, compact: false, thinking: false })));
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

  useEffect(() => {
    if (!termId || !threadId) return;
    const source = new EventSource(apiUrl(`/api/threads/${encodeURIComponent(threadId)}/terminal/events?id=${encodeURIComponent(termId)}`));
    source.onmessage = (event) => {
      const body = JSON.parse(event.data) as { text?: string; error?: string };
      if (body.error) setTermError(body.error);
      if (body.text) setTermOut((current) => `${current}${body.text}`.slice(-20_000));
    };
    return () => source.close();
  }, [termId, threadId]);

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
      const listedModels = await api.models().catch(() => ({ models: [] }));
      setModels(listedModels.models);
      setExtras(await api.capabilities().catch(() => ({ usage: false, compact: false, thinking: false })));
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
    void loadBrowse(projects.find((item) => item.id === projectId)?.path || ".");
  }

  async function loadBrowse(dir: string) {
    try {
      const listed = await api.browse(dir);
      setBrowsePath(listed.path);
      setBrowseParent(listed.parent);
      setBrowseEntries(listed.entries.filter((entry) => entry.kind === "dir"));
      setProjectPath(listed.path);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "打不开这个目录");
    }
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
    setFileEntries([]);
    setPreview("");
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
    await showFiles("", item.projectId, item.id);
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

  function samePath(left: string, right: string): boolean {
    return left.replaceAll("\\", "/").replace(/\/+$/, "") === right.replaceAll("\\", "/").replace(/\/+$/, "");
  }

  async function onChooseDirectory(path: string) {
    const existing = projects.find((item) => samePath(item.path, path));
    const project = existing ?? (await api.addProject(path.split(/[/\\]/).filter(Boolean).at(-1) || path, path)).project;
    if (!existing) setProjects((await api.projects()).projects);
    setProjectId(project.id);
    setProjectGit((await api.projectGit(project.id)).git);
    setError("");
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
    if (result.files) setGitFiles(result.files);
    if (result.error) setGitError(result.error);
    if (result.url) setGitUrl(result.url);
  }

  async function onPin(item: RecentThread) {
    await api.pinThread(item.projectId, item.id, !item.pinned);
    setMenuFor(null);
    await refreshRecent();
  }

  async function showFiles(dir = "", forProject = projectId, forThread = threadId) {
    if (!forProject || !forThread) return;
    const listed = await api.files(forProject, forThread, dir);
    setFileDir(dir);
    setFileEntries(listed.entries);
  }

  async function openFile(relative: string) {
    if (!projectId || !threadId) return;
    const body = await api.file(projectId, threadId, relative);
    setPreview(body.text ?? (body.kind === "image" ? "图片" : "这个文件不能预览"));
  }

  async function openPreview(name: string) {
    if (!projectId || !threadId) return;
    const next = fileDir ? `${fileDir}/${name}` : name;
    const entry = fileEntries.find((item) => item.name === name);
    if (entry?.kind === "dir") {
      await showFiles(next);
      return;
    }
    const body = await api.file(projectId, threadId, next);
    setPreview(body.text ?? (body.kind === "image" ? "图片" : "这个文件不能预览"));
  }

  async function onUpload(file: File) {
    if (!projectId || !threadId) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const relative = fileDir ? `${fileDir}/${file.name}` : file.name;
    await api.upload(projectId, threadId, relative, btoa(binary));
    await showFiles(fileDir);
  }

  function onQuote() {
    const selection = window.getSelection()?.toString().trim();
    if (!selection) return;
    const quoted = selection
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    setDraft((current) => `${current}${current ? "\n" : ""}${quoted}\n`);
  }

  function onDropFiles(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void onUpload(file);
  }

  async function openTerm() {
    if (!projectId || !threadId) return;
    setTermError("");
    setTermOut("");
    try {
      const opened = await api.terminal(projectId, threadId);
      setTermId(opened.id);
    } catch (reason) {
      setTermId("");
      setTermError(reason instanceof Error ? reason.message : "终端启动失败。");
    }
  }

  async function sendTerm(event: FormEvent) {
    event.preventDefault();
    if (!threadId || !termId || termLine === "") return;
    const line = termLine;
    setTermLine("");
    await api.terminalInput(threadId, termId, `${line}\n`);
  }

  async function onCreateDirectory(event: FormEvent) {
    event.preventDefault();
    const created = await api.createDirectory(browsePath, dirName);
    setDirName("");
    await loadBrowse(created.path);
  }

  async function toggleArchived() {
    const next = !showArchived;
    setShowArchived(next);
    setPlusOpen(false);
    await refreshRecent(next);
  }

  return (
    <Workspace
      phase={phase}
      password={password}
      setPassword={setPassword}
      error={error}
      onLogin={(event) => void onLogin(event)}
      loggedIn={loggedIn}
      projects={projects}
      projectId={projectId}
      projectGit={projectGit}
      threads={threads}
      threadId={threadId}
      drafting={drafting}
      items={items}
      approvals={approvals}
      queue={queue}
      task={task}
      older={older}
      draft={draft}
      setDraft={setDraft}
      directory={directory}
      setDirectory={setDirectory}
      projectName={projectName}
      setProjectName={setProjectName}
      plusOpen={plusOpen}
      setPlusOpen={setPlusOpen}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
      reviewOpen={reviewOpen}
      setReviewOpen={setReviewOpen}
      menuFor={menuFor}
      setMenuFor={setMenuFor}
      openChecks={openChecks}
      setOpenChecks={setOpenChecks}
      busy={busy}
      findText={findText}
      setFindText={setFindText}
      titleQuery={titleQuery}
      setTitleQuery={setTitleQuery}
      pane={pane}
      setPane={setPane}
      fileDir={fileDir}
      fileEntries={fileEntries}
      preview={preview}
      browsePath={browsePath}
      browseParent={browseParent}
      browseEntries={browseEntries}
      dirName={dirName}
      setDirName={setDirName}
      termOut={termOut}
      termLine={termLine}
      setTermLine={setTermLine}
      termError={termError}
      gitFiles={gitFiles}
      showArchived={showArchived}
      models={models}
      model={model}
      sandbox={sandbox}
      approvalPolicy={approvalPolicy}
      gitDiff={gitDiff}
      gitMessage={gitMessage}
      setGitMessage={setGitMessage}
      gitError={gitError}
      gitUrl={gitUrl}
      now={now}
      transcriptRef={transcriptRef}
      onLogout={() => void onLogout()}
      openPlus={openPlus}
      loadBrowse={(dir) => void loadBrowse(dir)}
      pickProject={(id) => void pickProject(id)}
      beginDraft={beginDraft}
      chooseThread={(item) => void chooseThread(item)}
      loadOlder={() => void loadOlder()}
      onTranscriptScroll={onTranscriptScroll}
      onDeleteThread={(item) => void onDeleteThread(item)}
      onAddProject={(event) => void onAddProject(event)}
      onChooseDirectory={onChooseDirectory}
      sendDraft={() => void sendDraft()}
      onDraftKey={onDraftKey}
      onStop={() => void onStop()}
      onDecision={(approvalId, decision) => void onDecision(approvalId, decision)}
      onRename={(item) => void onRename(item)}
      onArchive={(item) => void onArchive(item)}
      onUnarchive={(item) => void onUnarchive(item)}
      onFork={(item) => void onFork(item)}
      onPin={(item) => void onPin(item)}
      openSettings={() => void openSettings()}
      openReview={() => void openReview()}
      onSettings={(next) => void onSettings(next)}
      onGit={(action) => void onGit(action)}
      showFiles={(dir) => void showFiles(dir)}
      openPreview={(name) => void openPreview(name)}
      onUpload={(file) => void onUpload(file)}
      onDropFiles={onDropFiles}
      onQuote={onQuote}
      onOpenFile={(path) => void openFile(path)}
      openTerm={() => void openTerm()}
      sendTerm={(event) => void sendTerm(event)}
      onCreateDirectory={(event) => void onCreateDirectory(event)}
      toggleArchived={() => void toggleArchived()}
    />
  );
}

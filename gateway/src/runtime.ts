import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { hashPassword, verifyPassword } from "./passwords.ts";
import type { AppConfig } from "./config.ts";
import type { ApprovalDecision, CodexEngine, ThreadLaunch, TimelineItem } from "./codex/types.ts";
import { ALLOWED_BROWSER_ACTIONS } from "./codex/types.ts";
import { listTree, readPreview, writeUpload } from "./files.ts";
import { addWorktree, assertWorktreeAllowed, isGitRepo, isInside, redactSecrets, removeWorktree, runCommand, runGit, safeRelative, worktreeCheckoutPath } from "./git.ts";
import { createChildDirectory, listReadableDirectory, resolveReadablePath } from "./paths.ts";
import { startTerminal, terminalSession } from "./terminal.ts";
import { OFFICIAL_EXTRAS } from "./codex/types.ts";
import { explainCodexError } from "./codex/turn-error.ts";
import { shortTitle } from "./titles.ts";

export type TaskStatus = "running" | "waiting_approval" | "completed" | "failed" | "interrupted";
export type TimelineNotice =
  | { scope: "text"; threadId: string; itemId: string; kind: string; text: string }
  | { scope: "item"; threadId: string; item: TimelineItem }
  | { scope: "threads"; threadId?: string };
export type DirectoryChoice = "worktree" | "local";

type LiveItem = TimelineItem;
type Place = {
  thread_id: string;
  project_id: number;
  mode: string;
  cwd: string;
  branch: string | null;
  archived: number;
  created_at: number;
  pinned?: number;
};
type Settings = { title: string | null; model: string | null; sandbox: string | null; approval_policy: string | null };

export class Runtime {
  private readonly db: DatabaseSync;
  private readonly engine: CodexEngine;
  private readonly config: AppConfig;
  private readonly live = new Map<string, LiveItem[]>();
  private readonly persistedItems = new Map<string, TimelineItem[]>();
  private readonly subscribers = new Set<(notice: TimelineNotice) => void>();
  private tail: Promise<void> = Promise.resolve();
  private started = false;

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  constructor(db: DatabaseSync, engine: CodexEngine, config: AppConfig) {
    this.db = db;
    this.engine = engine;
    this.config = config;
  }

  whenIdle(): Promise<void> {
    return this.tail;
  }

  async start(): Promise<void> {
    const version = await this.engine.version();
    if (!this.config.allowedCodexVersions.includes(version)) {
      throw new Error(`Codex 版本 ${version} 不在允许范围内`);
    }
    this.ensureUser();
    this.db
      .prepare(
        `UPDATE tasks SET status = 'interrupted', updated_at = ?
         WHERE status IN ('running', 'waiting_approval')`,
      )
      .run(Date.now());
    this.engine.onEvent((event) => {
      if (event.type === "item") {
        const bucket = this.live.get(event.threadId) ?? [];
        const next = event.item;
        const index = bucket.findIndex((item) => item.id === next.id);
        if (index >= 0) bucket[index] = next;
        else bucket.push(next);
        this.live.set(event.threadId, bucket);
      }
      if (event.type === "delta") {
        const bucket = this.live.get(event.threadId) ?? [];
        const index = bucket.findIndex((item) => item.id === event.itemId);
        if (index >= 0) bucket[index] = { ...bucket[index], text: bucket[index].text + event.text };
        else bucket.push({ id: event.itemId, kind: event.kind, text: event.text });
        this.live.set(event.threadId, bucket);
      }
      if (event.type === "title") this.rememberTitle(event.threadId, event.title);
      if (event.type === "approval") this.onApproval(event);
      if (event.type === "failure") this.rememberFailure(event.threadId, event.turnId, event.error);
      if (event.type === "turn") {
        const status = event.status === "interrupted" ? "interrupted" : event.status === "failed" ? "failed" : "completed";
        const threadId = event.threadId || this.threadForTurn(event.turnId);
        const error = status === "failed" ? event.error || this.storedFailure(threadId, event.turnId) || "这一轮失败了。" : null;
        this.finishTurn(threadId, event.turnId, status, error);
        if (status === "completed" || status === "failed") {
          void this.enqueue(() => this.drainQueue(threadId));
        }
      }
      if (event.type === "delta") {
        this.notify({ scope: "text", threadId: event.threadId, itemId: event.itemId, kind: event.kind, text: event.text });
      } else if (event.type === "item") {
        this.notify({ scope: "item", threadId: event.threadId, item: event.item });
      } else {
        this.notify({ scope: "threads", threadId: event.threadId });
      }
    });
    this.engine.onClose(() => {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'interrupted', updated_at = ?
           WHERE status IN ('running', 'waiting_approval')`,
        )
        .run(Date.now());
      this.notify({ scope: "threads" });
    });
    this.started = true;
  }

  ensureUser(): void {
    const existing = this.db.prepare("SELECT id FROM users WHERE username = ?").get(this.config.username) as
      | { id: number }
      | undefined;
    const passwordHash = hashPassword(this.config.password);
    if (!existing) {
      this.db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(this.config.username, passwordHash);
      return;
    }
    this.db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(passwordHash, this.config.username);
  }

  login(password: string): string | null {
    const user = this.db.prepare("SELECT password_hash FROM users WHERE username = ?").get(this.config.username) as
      | { password_hash: string }
      | undefined;
    if (!user || !verifyPassword(password, user.password_hash)) return null;
    const id = randomBytes(24).toString("hex");
    const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
    this.db.prepare("INSERT INTO sessions (id, username, expires_at) VALUES (?, ?, ?)").run(id, this.config.username, expires);
    return id;
  }

  logout(sessionId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  sessionUser(sessionId: string | undefined): string | null {
    if (!sessionId) return null;
    const row = this.db.prepare("SELECT username, expires_at FROM sessions WHERE id = ?").get(sessionId) as
      | { username: string; expires_at: number }
      | undefined;
    if (!row || row.expires_at < Date.now()) return null;
    return row.username;
  }

  addProject(name: string, candidate: string): { id: number; name: string; path: string } {
    const resolved = resolveReadablePath(candidate);
    const now = Date.now();
    const result = this.db.prepare("INSERT INTO projects (name, path, created_at) VALUES (?, ?, ?)").run(name, resolved, now);
    return { id: Number(result.lastInsertRowid), name, path: resolved };
  }

  browseDirectory(candidate: string) {
    this.assertBrowserAction("browse-directory");
    return listReadableDirectory(candidate);
  }

  createDirectory(parent: string, name: string): { path: string } {
    this.assertBrowserAction("create-directory");
    return { path: createChildDirectory(parent, name) };
  }

  capabilities() {
    this.assertBrowserAction("read-capabilities");
    return OFFICIAL_EXTRAS;
  }

  listProjects(): { id: number; name: string; path: string }[] {
    return this.db.prepare("SELECT id, name, path FROM projects ORDER BY id").all() as {
      id: number;
      name: string;
      path: string;
    }[];
  }

  async listThreads(projectId: number, archived = false) {
    const project = this.project(projectId);
    const git = await isGitRepo(project.path);
    await this.absorbListed(projectId);
    return { threads: this.placeThreads(projectId, archived), git };
  }

  recentThreads(archived = false) {
    const threads = (this.db.prepare("SELECT id, name FROM projects").all() as { id: number; name: string }[]).flatMap((project) =>
      this.placeThreads(project.id, archived).map((thread) => ({
        id: thread.id,
        title: thread.title,
        status: thread.status,
        pending: thread.pending,
        mode: thread.mode,
        updatedAt: thread.updatedAt,
        projectId: project.id,
        projectName: project.name,
        pinned: thread.pinned,
      })),
    );
    threads.sort((left, right) => right.updatedAt - left.updatedAt);
    return { threads };
  }

  async syncRecent() {
    for (const project of this.listProjects()) await this.absorbListed(project.id);
    return this.recentThreads();
  }

  async projectGit(projectId: number): Promise<boolean> {
    return isGitRepo(this.project(projectId).path);
  }

  async account() {
    return this.engine.readAccount();
  }

  listModels(): Promise<{ id: string; name: string }[]> {
    return this.enqueue(() => this.engine.listModels());
  }

  startTurn(
    projectId: number,
    text: string,
    threadId?: string,
    directory?: DirectoryChoice,
  ): Promise<{ threadId: string; turnId: string; taskId: number; queued?: boolean }> {
    return this.enqueue(() => this.startTurnNow(projectId, text, threadId, directory));
  }

  private async startTurnNow(
    projectId: number,
    text: string,
    threadId?: string,
    directory?: DirectoryChoice,
  ): Promise<{ threadId: string; turnId: string; taskId: number; queued?: boolean }> {
    const account = await this.engine.readAccount();
    if (!account.loggedIn) {
      const error = new Error("需要先登录 Codex");
      error.name = "CodexNotLoggedIn";
      throw error;
    }
    if (threadId) {
      this.existingThread(projectId, threadId);
      const busy = this.activeTask(threadId);
      if (busy) {
        this.db
          .prepare(`INSERT INTO thread_queue (thread_id, text, created_at) VALUES (?, ?, ?)`)
          .run(threadId, text, Date.now());
        this.notify({ scope: "threads", threadId });
        return { threadId, turnId: busy.turn_id, taskId: busy.id, queued: true };
      }
      return this.beginTurn(projectId, threadId, text);
    }
    const project = this.project(projectId);
    const created = await this.createThread(project, directory === "local" ? "local" : "worktree");
    this.rememberTitle(created.id, shortTitle(text));
    return this.beginTurn(projectId, created.id, text);
  }

  private async beginTurn(projectId: number, threadId: string, text: string) {
    const place = this.requirePlace(projectId, threadId);
    const launch = this.launchFor(threadId);
    if (launch) await this.engine.applySettings(threadId, place.cwd, launch);
    const turn = await this.engine.startTurn(threadId, text, place.cwd).catch((error: unknown) => {
      throw new Error(explainCodexError(error instanceof Error ? { message: error.message } : error));
    });
    const now = Date.now();
    const inserted = this.db
      .prepare(
        `INSERT INTO tasks (project_id, thread_id, turn_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'running', ?, ?)`,
      )
      .run(projectId, threadId, turn.turnId, now, now);
    this.notify({ scope: "threads", threadId });
    return { threadId, turnId: turn.turnId, taskId: Number(inserted.lastInsertRowid) };
  }

  private async drainQueue(threadId: string): Promise<void> {
    if (this.activeTask(threadId)) return;
    const next = this.db.prepare(`SELECT id, text FROM thread_queue WHERE thread_id = ? ORDER BY id LIMIT 1`).get(threadId) as
      | { id: number; text: string }
      | undefined;
    if (!next) return;
    const place = this.db.prepare("SELECT project_id FROM thread_places WHERE thread_id = ?").get(threadId) as
      | { project_id: number }
      | undefined;
    if (!place) return;
    this.db.prepare("DELETE FROM thread_queue WHERE id = ?").run(next.id);
    await this.beginTurn(place.project_id, threadId, next.text);
  }

  interrupt(threadId: string): Promise<void> {
    return this.enqueue(async () => {
      const task = this.activeTask(threadId);
      if (!task?.turn_id) return;
      await this.engine.interrupt(threadId, task.turn_id);
    });
  }

  deleteThread(projectId: number, threadId: string): Promise<void> {
    return this.enqueue(() => this.deleteThreadNow(projectId, threadId));
  }

  private async deleteThreadNow(projectId: number, threadId: string): Promise<void> {
    const project = this.project(projectId);
    if (this.activeTask(threadId)) {
      const error = new Error("这条会话正在执行");
      error.name = "TurnBusy";
      throw error;
    }
    const place = this.db.prepare("SELECT * FROM thread_places WHERE thread_id = ?").get(threadId) as Place | undefined;
    const listed = await this.engine.listThreads(place?.cwd ?? project.path);
    const owned = this.db.prepare("SELECT project_id FROM tasks WHERE thread_id = ? LIMIT 1").get(threadId) as
      | { project_id: number }
      | undefined;
    if (!listed.some((thread) => thread.id === threadId) && owned?.project_id !== projectId && place?.project_id !== projectId) {
      throw new Error("会话不存在");
    }
    if (place?.mode === "worktree") {
      try {
        await removeWorktree(project.path, place.cwd);
      } catch (error) {
        throw new Error(redactSecrets(error instanceof Error ? error.message : "移除检出失败"));
      }
    }
    await this.engine.deleteThread(threadId);
    this.db.prepare("DELETE FROM approvals WHERE thread_id = ?").run(threadId);
    this.db.prepare("DELETE FROM tasks WHERE thread_id = ?").run(threadId);
    this.db.prepare("DELETE FROM thread_queue WHERE thread_id = ?").run(threadId);
    this.db.prepare("DELETE FROM thread_grants WHERE thread_id = ?").run(threadId);
    this.db.prepare("DELETE FROM thread_settings WHERE thread_id = ?").run(threadId);
    this.db.prepare("DELETE FROM thread_places WHERE thread_id = ?").run(threadId);
    this.live.delete(threadId);
  }

  renameThread(projectId: number, threadId: string, name: string): Promise<void> {
    return this.enqueue(async () => {
      this.existingThread(projectId, threadId);
      const title = name.trim();
      if (!title) throw new Error("标题不能为空");
      this.rememberTitle(threadId, title);
      await this.engine.setThreadName(threadId, title);
    });
  }

  archiveThread(projectId: number, threadId: string): Promise<void> {
    return this.enqueue(async () => {
      this.existingThread(projectId, threadId);
      await this.engine.archiveThread(threadId);
      this.db.prepare("UPDATE thread_places SET archived = 1 WHERE thread_id = ?").run(threadId);
    });
  }

  unarchiveThread(projectId: number, threadId: string): Promise<void> {
    return this.enqueue(async () => {
      const place = this.requirePlace(projectId, threadId);
      await this.engine.unarchiveThread(threadId);
      this.db.prepare("UPDATE thread_places SET archived = 0 WHERE thread_id = ?").run(place.thread_id);
    });
  }

  forkThread(projectId: number, threadId: string): Promise<{ threadId: string }> {
    return this.enqueue(async () => {
      const project = this.project(projectId);
      this.existingThread(projectId, threadId);
      const git = await isGitRepo(project.path);
      let cwd = project.path;
      let mode = "local";
      let branch: string | null = null;
      if (git) {
        const slot = await this.makeWorktree(project.path, projectId);
        cwd = slot.provisional;
        branch = slot.branch;
        mode = "worktree";
      }
      const forked = await this.engine.forkThread(threadId, cwd);
      if (mode === "worktree") cwd = await this.settleWorktree(project.path, projectId, cwd, forked.id);
      this.insertPlace(forked.id, projectId, mode, cwd, branch);
      const source = this.settings(threadId);
      this.rememberTitle(forked.id, source?.title ? `${source.title} 的分叉` : "分叉");
      return { threadId: forked.id };
    });
  }

  setThreadSettings(threadId: string, patch: ThreadLaunch): Promise<void> {
    return this.enqueue(async () => {
      const current = this.settings(threadId) ?? { title: null, model: null, sandbox: null, approval_policy: null };
      this.db
        .prepare(
          `INSERT INTO thread_settings (thread_id, title, model, sandbox, approval_policy)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET
             model = excluded.model,
             sandbox = excluded.sandbox,
             approval_policy = excluded.approval_policy`,
        )
        .run(
          threadId,
          current.title,
          patch.model ?? current.model,
          patch.sandbox ?? current.sandbox,
          patch.approvalPolicy ?? current.approval_policy,
        );
    });
  }

  async timeline(threadId: string): Promise<{ persisted: TimelineItem[]; live: TimelineItem[]; items: TimelineItem[]; queue: string[] }> {
    this.persistedItems.set(threadId, await this.engine.listPersistedItems(threadId));
    return this.cachedTimeline(threadId);
  }

  cachedTimeline(threadId: string): { persisted: TimelineItem[]; live: TimelineItem[]; items: TimelineItem[]; queue: string[] } {
    const persisted = this.persistedItems.get(threadId) ?? [];
    const live = this.live.get(threadId) ?? [];
    const queue = (
      this.db.prepare("SELECT text FROM thread_queue WHERE thread_id = ? ORDER BY id").all(threadId) as { text: string }[]
    ).map((row) => row.text);
    return { persisted, live, items: mergeTimeline(persisted, live), queue };
  }

  submitApproval(approvalId: string, decision: ApprovalDecision): Promise<void> {
    return this.enqueue(() => this.submitApprovalNow(approvalId, decision));
  }

  private async submitApprovalNow(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const row = this.db.prepare("SELECT id, thread_id, kind, decision FROM approvals WHERE id = ?").get(approvalId) as
      | { id: string; thread_id: string; kind: string; decision: string | null }
      | undefined;
    if (!row || row.decision) throw new Error("审批不存在或已处理");
    await this.engine.respondApproval(approvalId, decision);
    this.db.prepare("UPDATE approvals SET decision = ? WHERE id = ?").run(decision, approvalId);
    if (decision === "acceptForSession") {
      const kind = grantKind(row.kind);
      if (kind) this.db.prepare("INSERT OR IGNORE INTO thread_grants (thread_id, kind) VALUES (?, ?)").run(row.thread_id, kind);
    }
    this.db
      .prepare(`UPDATE tasks SET status = 'running', updated_at = ? WHERE thread_id = ? AND status = 'waiting_approval'`)
      .run(Date.now(), row.thread_id);
  }

  pendingApprovals(threadId: string) {
    return this.db
      .prepare("SELECT id, thread_id, turn_id, kind, payload FROM approvals WHERE thread_id = ? AND decision IS NULL")
      .all(threadId) as { id: string; thread_id: string; turn_id: string; kind: string; payload: string }[];
  }

  taskForThread(threadId: string) {
    return this.db
      .prepare("SELECT id, status, turn_id, created_at, updated_at, error FROM tasks WHERE thread_id = ? ORDER BY id DESC LIMIT 1")
      .get(threadId) as
      | { id: number; status: TaskStatus; turn_id: string; created_at: number; updated_at: number; error: string | null }
      | undefined;
  }

  pinThread(projectId: number, threadId: string, pinned: boolean): void {
    this.assertBrowserAction("pin-thread");
    this.existingThread(projectId, threadId);
    this.db.prepare("UPDATE thread_places SET pinned = ? WHERE thread_id = ?").run(pinned ? 1 : 0, threadId);
    this.notify({ scope: "threads", threadId });
  }

  listFiles(projectId: number, threadId: string, relative = "") {
    this.assertBrowserAction("list-files");
    const place = this.requirePlace(projectId, threadId);
    return listTree(place.cwd, relative);
  }

  listProjectFiles(projectId: number, relative = "") {
    this.assertBrowserAction("list-files");
    return listTree(this.project(projectId).path, relative);
  }

  readFile(projectId: number, threadId: string, relative: string) {
    this.assertBrowserAction("read-file");
    const place = this.requirePlace(projectId, threadId);
    return readPreview(place.cwd, relative);
  }

  uploadFile(projectId: number, threadId: string, relative: string, data: string) {
    this.assertBrowserAction("upload-file");
    const place = this.requirePlace(projectId, threadId);
    const bytes = Buffer.from(data, "base64");
    return { path: writeUpload(place.cwd, relative, bytes) };
  }

  openTerminal(projectId: number, threadId: string) {
    this.assertBrowserAction("terminal");
    const place = this.requirePlace(projectId, threadId);
    return startTerminal(place.cwd);
  }

  writeTerminal(id: string, data: string) {
    this.assertBrowserAction("terminal");
    const session = terminalSession(id);
    if (!session) throw new Error("终端不存在");
    if (session.error) throw new Error(session.error);
    session.write(data);
    return { ok: true };
  }

  async gitAction(
    projectId: number,
    threadId: string,
    action: "diff" | "stage" | "revert" | "commit" | "push" | "pr",
    body: { paths?: string[]; message?: string; title?: string },
  ): Promise<{ diff?: string; files?: string[]; ok?: boolean; url?: string; error?: string }> {
    const place = this.requirePlace(projectId, threadId);
    if (!(await isGitRepo(place.cwd))) throw new Error("这个目录不是 Git 仓库");
    const paths = (body.paths ?? []).map((item) => safeRelative(place.cwd, item));
    try {
      if (action === "diff") {
        const status = await runGit(place.cwd, ["status", "--porcelain"]);
        const files = status.stdout
          .split(/\r?\n/)
          .map((line) => line.slice(3).trim())
          .filter(Boolean)
          .map((file) => (file.includes(" -> ") ? file.split(" -> ").at(-1) ?? file : file));
        const target = paths[0];
        const unstaged = await runGit(place.cwd, target ? ["diff", "HEAD", "--", target] : ["diff", "HEAD"]);
        const staged = await runGit(place.cwd, target ? ["diff", "--cached", "--", target] : ["diff", "--cached"]);
        return { diff: `${unstaged.stdout}${staged.stdout}`, files };
      }
      if (action === "stage") {
        if (paths.length === 0) throw new Error("没有要暂存的路径");
        await runGit(place.cwd, ["add", "--", ...paths]);
        return { ok: true };
      }
      if (action === "revert") {
        if (paths.length === 0) throw new Error("没有要还原的路径");
        await runGit(place.cwd, ["restore", "--worktree", "--staged", "--", ...paths]);
        return { ok: true };
      }
      if (action === "commit") {
        const message = body.message?.trim();
        if (!message) throw new Error("提交说明不能为空");
        await runGit(place.cwd, ["commit", "-m", message]);
        return { ok: true };
      }
      if (action === "push") {
        await runGit(place.cwd, ["push"]);
        return { ok: true };
      }
      const title = body.title?.trim() || "Update";
      const created = await runCommand("gh", ["pr", "create", "--title", title, "--body", body.message?.trim() || title], place.cwd);
      const url = created.stdout.trim().split(/\s+/).find((part) => part.startsWith("http"));
      return url ? { ok: true, url } : { ok: false, error: "没有返回 pull request 地址" };
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : "Git 操作失败");
      if (action === "pr") return { ok: false, error: message };
      throw new Error(message);
    }
  }

  subscribe(listener: (notice: TimelineNotice) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  private notify(notice: TimelineNotice): void {
    for (const subscriber of this.subscribers) subscriber(notice);
  }

  assertBrowserAction(action: string): void {
    if (!ALLOWED_BROWSER_ACTIONS.includes(action as (typeof ALLOWED_BROWSER_ACTIONS)[number])) {
      throw new Error("不允许的操作");
    }
  }

  isStarted(): boolean {
    return this.started;
  }

  private async createThread(project: { id: number; path: string }, directory: DirectoryChoice): Promise<{ id: string }> {
    const git = await isGitRepo(project.path);
    if (directory === "local" || !git) {
      const thread = await this.engine.startThread(project.path);
      this.insertPlace(thread.id, project.id, "local", project.path, null);
      return thread;
    }
    const slot = await this.makeWorktree(project.path, project.id);
    const thread = await this.engine.startThread(slot.provisional);
    const cwd = await this.settleWorktree(project.path, project.id, slot.provisional, thread.id);
    this.insertPlace(thread.id, project.id, "worktree", cwd, slot.branch);
    return thread;
  }

  private async makeWorktree(repo: string, projectId: number): Promise<{ provisional: string; branch: string }> {
    const short = randomBytes(4).toString("hex");
    const branch = `codex/${short}`;
    const provisional = worktreeCheckoutPath(repo, branch);
    const projects = this.listProjects().map((item) => item.path);
    assertWorktreeAllowed(provisional, repo, projects);
    await addWorktree(repo, provisional, branch);
    return { provisional, branch };
  }

  private async settleWorktree(_repo: string, _projectId: number, provisional: string, _threadId: string): Promise<string> {
    return provisional;
  }

  private placeThreads(projectId: number, archived: boolean) {
    const places = this.db.prepare("SELECT * FROM thread_places WHERE project_id = ?").all(projectId) as Place[];
    return places
      .filter((place) => (archived ? place.archived === 1 : place.archived === 0))
      .map((place) => {
        const settings = this.settings(place.thread_id);
        const task = this.taskForThread(place.thread_id);
        return {
          id: place.thread_id,
          cwd: place.cwd,
          title: settings?.title || "新会话",
          status: task?.status ?? null,
          pending: this.pendingApprovals(place.thread_id).length,
          mode: place.mode,
          pinned: place.pinned === 1,
          updatedAt: task ? this.taskUpdatedAt(place.thread_id) : place.created_at,
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  private async absorbListed(projectId: number): Promise<void> {
    const project = this.project(projectId);
    const known = new Set(
      (this.db.prepare("SELECT thread_id FROM thread_places WHERE project_id = ?").all(projectId) as { thread_id: string }[]).map(
        (place) => place.thread_id,
      ),
    );
    const absorb = (thread: { id: string; cwd: string; title: string }) => {
      if (!known.has(thread.id)) {
        this.insertPlace(thread.id, projectId, "local", thread.cwd, null);
        known.add(thread.id);
      }
      if (!this.settings(thread.id)?.title && thread.title) this.rememberTitle(thread.id, shortTitle(thread.title));
    };
    for (const thread of await this.engine.listThreads(project.path)) absorb(thread);
    const places = this.db.prepare("SELECT * FROM thread_places WHERE project_id = ?").all(projectId) as Place[];
    for (const place of places) {
      if (place.mode !== "worktree") continue;
      for (const thread of await this.engine.listThreads(place.cwd)) absorb(thread);
    }
  }

  private insertPlace(threadId: string, projectId: number, mode: string, cwd: string, branch: string | null): void {
    this.db
      .prepare(
        `INSERT INTO thread_places (thread_id, project_id, mode, cwd, branch, archived, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(thread_id) DO UPDATE SET cwd = excluded.cwd, mode = excluded.mode, branch = excluded.branch`,
      )
      .run(threadId, projectId, mode, cwd, branch, Date.now());
  }

  private onApproval(event: { threadId: string; turnId: string; approvalId: string; kind: string; text: string }): void {
    const kind = grantKind(event.kind);
    const granted = kind
      ? (this.db.prepare("SELECT kind FROM thread_grants WHERE thread_id = ? AND kind = ?").get(event.threadId, kind) as { kind: string } | undefined)
      : undefined;
    if (granted) {
      void this.enqueue(async () => {
        await this.engine.respondApproval(event.approvalId, "accept");
        this.db
          .prepare(
            `INSERT INTO approvals (id, thread_id, turn_id, kind, payload, decision, created_at)
             VALUES (?, ?, ?, ?, ?, 'accept', ?)`,
          )
          .run(event.approvalId, event.threadId, event.turnId, event.kind, JSON.stringify({ text: event.text }), Date.now());
      });
      return;
    }
    this.db
      .prepare(
        `INSERT INTO approvals (id, thread_id, turn_id, kind, payload, decision, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(event.approvalId, event.threadId, event.turnId, event.kind, JSON.stringify({ text: event.text }), Date.now());
    this.db
      .prepare(`UPDATE tasks SET status = 'waiting_approval', updated_at = ? WHERE thread_id = ? AND status = 'running'`)
      .run(Date.now(), event.threadId);
  }

  private existingThread(projectId: number, threadId: string): { id: string } {
    this.requirePlace(projectId, threadId);
    return { id: threadId };
  }

  private requirePlace(projectId: number, threadId: string): Place {
    const place = this.db.prepare("SELECT * FROM thread_places WHERE thread_id = ?").get(threadId) as Place | undefined;
    const task = this.db.prepare("SELECT project_id FROM tasks WHERE thread_id = ? LIMIT 1").get(threadId) as
      | { project_id: number }
      | undefined;
    if (place?.project_id === projectId) return place;
    if (task?.project_id === projectId && place) return place;
    if (task?.project_id === projectId && !place) {
      const project = this.project(projectId);
      this.insertPlace(threadId, projectId, "local", project.path, null);
      return this.db.prepare("SELECT * FROM thread_places WHERE thread_id = ?").get(threadId) as Place;
    }
    throw new Error("会话不存在");
  }

  private finishTurn(threadId: string, turnId: string, status: TaskStatus, error: string | null): void {
    const now = Date.now();
    const matched = this.db
      .prepare(`UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE thread_id = ? AND turn_id = ?`)
      .run(status, error, now, threadId, turnId) as { changes?: number };
    if ((matched.changes ?? 0) === 0 && turnId) {
      this.db.prepare(`UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE turn_id = ?`).run(status, error, now, turnId);
    }
  }

  private rememberFailure(threadId: string, turnId: string, error: string): void {
    const message = redactSecrets(error).slice(0, 500) || "这一轮失败了。";
    if (threadId && turnId) {
      this.db.prepare(`UPDATE tasks SET error = ? WHERE thread_id = ? AND turn_id = ?`).run(message, threadId, turnId);
      return;
    }
    if (turnId) {
      this.db.prepare(`UPDATE tasks SET error = ? WHERE turn_id = ?`).run(message, turnId);
      return;
    }
    if (threadId) {
      this.db
        .prepare(
          `UPDATE tasks SET error = ? WHERE id = (
             SELECT id FROM tasks WHERE thread_id = ? AND status IN ('running', 'waiting_approval') ORDER BY id DESC LIMIT 1
           )`,
        )
        .run(message, threadId);
      return;
    }
    const running = this.db.prepare(`SELECT id FROM tasks WHERE status IN ('running', 'waiting_approval')`).all() as { id: number }[];
    if (running.length === 1) this.db.prepare(`UPDATE tasks SET error = ? WHERE id = ?`).run(message, running[0].id);
  }

  private storedFailure(threadId: string, turnId: string): string {
    const row = (
      threadId
        ? this.db.prepare(`SELECT error FROM tasks WHERE thread_id = ? AND turn_id = ?`).get(threadId, turnId)
        : this.db.prepare(`SELECT error FROM tasks WHERE turn_id = ?`).get(turnId)
    ) as { error?: string | null } | undefined;
    return row?.error ?? "";
  }

  private threadForTurn(turnId: string): string {
    const row = this.db.prepare(`SELECT thread_id FROM tasks WHERE turn_id = ? ORDER BY id DESC LIMIT 1`).get(turnId) as
      | { thread_id: string }
      | undefined;
    return row?.thread_id ?? "";
  }

  private activeTask(threadId: string): { id: number; turn_id: string } | undefined {
    return this.db
      .prepare(`SELECT id, turn_id FROM tasks WHERE thread_id = ? AND status IN ('running', 'waiting_approval') LIMIT 1`)
      .get(threadId) as { id: number; turn_id: string } | undefined;
  }

  private taskUpdatedAt(threadId: string): number {
    const row = this.db.prepare("SELECT updated_at FROM tasks WHERE thread_id = ? ORDER BY id DESC LIMIT 1").get(threadId) as
      | { updated_at: number }
      | undefined;
    return row?.updated_at ?? 0;
  }

  private settings(threadId: string): Settings | undefined {
    return this.db.prepare("SELECT title, model, sandbox, approval_policy FROM thread_settings WHERE thread_id = ?").get(threadId) as
      | Settings
      | undefined;
  }

  private launchFor(threadId: string): ThreadLaunch | null {
    const settings = this.settings(threadId);
    if (!settings?.model && !settings?.sandbox && !settings?.approval_policy) return null;
    return {
      ...(settings.model ? { model: settings.model } : {}),
      ...(settings.sandbox ? { sandbox: settings.sandbox } : {}),
      ...(settings.approval_policy ? { approvalPolicy: settings.approval_policy } : {}),
    };
  }

  private rememberTitle(threadId: string, title: string): void {
    this.db
      .prepare(
        `INSERT INTO thread_settings (thread_id, title, model, sandbox, approval_policy)
         VALUES (?, ?, NULL, NULL, NULL)
         ON CONFLICT(thread_id) DO UPDATE SET title = excluded.title`,
      )
      .run(threadId, title);
  }

  private project(projectId: number): { id: number; path: string; name: string } {
    const project = this.db.prepare("SELECT id, name, path FROM projects WHERE id = ?").get(projectId) as
      | { id: number; name: string; path: string }
      | undefined;
    if (!project) throw new Error("项目不存在");
    return project;
  }
}

export const TIMELINE_WINDOW = 40;

export function windowItems(items: TimelineItem[], before?: string): { items: TimelineItem[]; older: boolean } {
  let source = items;
  if (before) {
    const index = source.findIndex((item) => item.id === before);
    source = index > 0 ? source.slice(0, index) : [];
  }
  return { items: source.slice(-TIMELINE_WINDOW), older: source.length > TIMELINE_WINDOW };
}

export function mergeTimeline(persisted: TimelineItem[], live: TimelineItem[]): TimelineItem[] {
  const liveById = new Map(live.map((item) => [item.id, item]));
  const used = new Set<string>();
  const merged = persisted.map((item) => {
    used.add(item.id);
    const current = liveById.get(item.id);
    if (!current || current.text.length < item.text.length) return item;
    return { ...item, text: current.text, ...(current.command ? { command: current.command } : {}) };
  });
  for (const item of live) {
    if (!used.has(item.id)) merged.push(item);
  }
  return merged;
}

function grantKind(method: string): "command" | "file" | null {
  if (method.includes("fileChange") || method === "file") return "file";
  if (method.includes("commandExecution") || method === "command") return "command";
  return null;
}

export function worktreeWouldEscape(target: string, repo: string, projects: string[]): boolean {
  return projects.some((project) => isInside(project, target)) || isInside(repo, target);
}

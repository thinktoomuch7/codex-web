import type { DatabaseSync } from "node:sqlite";
import { hashPassword, verifyPassword } from "./passwords.ts";
import type { AppConfig } from "./config.ts";
import type { CodexEngine, TimelineItem } from "./codex/types.ts";
import { ALLOWED_BROWSER_ACTIONS } from "./codex/types.ts";
import { resolveProjectPath } from "./paths.ts";
import { randomBytes } from "node:crypto";

export type TaskStatus = "running" | "waiting_approval" | "completed" | "failed" | "interrupted";

type LiveItem = TimelineItem;

export class Runtime {
  private readonly db: DatabaseSync;
  private readonly engine: CodexEngine;
  private readonly config: AppConfig;
  private readonly live = new Map<string, LiveItem[]>();
  private readonly subscribers = new Set<() => void>();
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
      if (event.type === "approval") {
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
      if (event.type === "turn") {
        const status = event.status === "interrupted" ? "interrupted" : event.status === "failed" ? "failed" : "completed";
        this.db
          .prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE thread_id = ? AND turn_id = ?`)
          .run(status, Date.now(), event.threadId, event.turnId);
      }
      for (const subscriber of this.subscribers) subscriber();
    });
    this.engine.onClose(() => {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'interrupted', updated_at = ?
           WHERE status IN ('running', 'waiting_approval')`,
        )
        .run(Date.now());
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
    const resolved = resolveProjectPath(candidate, this.config.projectRoots);
    const now = Date.now();
    const result = this.db.prepare("INSERT INTO projects (name, path, created_at) VALUES (?, ?, ?)").run(name, resolved, now);
    return { id: Number(result.lastInsertRowid), name, path: resolved };
  }

  listProjects(): { id: number; name: string; path: string }[] {
    return this.db.prepare("SELECT id, name, path FROM projects ORDER BY id").all() as {
      id: number;
      name: string;
      path: string;
    }[];
  }

  async listThreads(projectId: number) {
    const project = this.project(projectId);
    return this.engine.listThreads(project.path);
  }

  async account() {
    return this.engine.readAccount();
  }

  startTurn(projectId: number, text: string, threadId?: string): Promise<{ threadId: string; turnId: string; taskId: number }> {
    return this.enqueue(() => this.startTurnNow(projectId, text, threadId));
  }

  private async startTurnNow(
    projectId: number,
    text: string,
    threadId?: string,
  ): Promise<{ threadId: string; turnId: string; taskId: number }> {
    const account = await this.engine.readAccount();
    if (!account.loggedIn) {
      const error = new Error("需要先登录 Codex");
      error.name = "CodexNotLoggedIn";
      throw error;
    }
    const busy = this.db
      .prepare(`SELECT id FROM tasks WHERE status IN ('running', 'waiting_approval') LIMIT 1`)
      .get() as { id: number } | undefined;
    if (busy) {
      const error = new Error("已有任务正在执行");
      error.name = "TurnBusy";
      throw error;
    }
    const project = this.project(projectId);
    const thread = threadId ? this.existingThread(projectId, threadId) : await this.engine.startThread(project.path);
    const turn = await this.engine.startTurn(thread.id, text, project.path);
    const now = Date.now();
    const inserted = this.db
      .prepare(
        `INSERT INTO tasks (project_id, thread_id, turn_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'running', ?, ?)`,
      )
      .run(projectId, thread.id, turn.turnId, now, now);
    return { threadId: thread.id, turnId: turn.turnId, taskId: Number(inserted.lastInsertRowid) };
  }

  interrupt(threadId: string): Promise<void> {
    return this.enqueue(async () => {
      const task = this.db
        .prepare(`SELECT turn_id FROM tasks WHERE thread_id = ? AND status IN ('running', 'waiting_approval')`)
        .get(threadId) as { turn_id: string } | undefined;
      if (!task?.turn_id) return;
      await this.engine.interrupt(threadId, task.turn_id);
    });
  }

  deleteThread(projectId: number, threadId: string): Promise<void> {
    return this.enqueue(() => this.deleteThreadNow(projectId, threadId));
  }

  private async deleteThreadNow(projectId: number, threadId: string): Promise<void> {
    const project = this.project(projectId);
    const busy = this.db
      .prepare(`SELECT id FROM tasks WHERE thread_id = ? AND status IN ('running', 'waiting_approval') LIMIT 1`)
      .get(threadId) as { id: number } | undefined;
    if (busy) {
      const error = new Error("这条会话正在执行");
      error.name = "TurnBusy";
      throw error;
    }
    const listed = await this.engine.listThreads(project.path);
    const owned = this.db.prepare("SELECT project_id FROM tasks WHERE thread_id = ? LIMIT 1").get(threadId) as
      | { project_id: number }
      | undefined;
    if (!listed.some((thread) => thread.id === threadId) && owned?.project_id !== projectId) {
      throw new Error("会话不存在");
    }
    await this.engine.deleteThread(threadId);
    this.db.prepare("DELETE FROM approvals WHERE thread_id = ?").run(threadId);
    this.db.prepare("DELETE FROM tasks WHERE thread_id = ?").run(threadId);
    this.live.delete(threadId);
  }

  async timeline(threadId: string): Promise<{ persisted: TimelineItem[]; live: TimelineItem[]; items: TimelineItem[] }> {
    const persisted = await this.engine.listPersistedItems(threadId);
    const persistedIds = new Set(persisted.map((item) => item.id));
    const live = (this.live.get(threadId) ?? []).filter((item) => !persistedIds.has(item.id));
    return { persisted, live, items: [...persisted, ...live] };
  }

  submitApproval(approvalId: string, decision: "accept" | "decline"): Promise<void> {
    return this.enqueue(() => this.submitApprovalNow(approvalId, decision));
  }

  private async submitApprovalNow(approvalId: string, decision: "accept" | "decline"): Promise<void> {
    const row = this.db.prepare("SELECT id, decision FROM approvals WHERE id = ?").get(approvalId) as
      | { id: string; decision: string | null }
      | undefined;
    if (!row || row.decision) throw new Error("审批不存在或已处理");
    await this.engine.respondApproval(approvalId, decision);
    this.db.prepare("UPDATE approvals SET decision = ? WHERE id = ?").run(decision, approvalId);
    this.db
      .prepare(`UPDATE tasks SET status = 'running', updated_at = ? WHERE status = 'waiting_approval'`)
      .run(Date.now());
  }

  pendingApprovals(threadId: string) {
    return this.db
      .prepare("SELECT id, thread_id, turn_id, kind, payload FROM approvals WHERE thread_id = ? AND decision IS NULL")
      .all(threadId) as { id: string; thread_id: string; turn_id: string; kind: string; payload: string }[];
  }

  taskForThread(threadId: string) {
    return this.db.prepare("SELECT id, status, turn_id FROM tasks WHERE thread_id = ? ORDER BY id DESC LIMIT 1").get(threadId) as
      | { id: number; status: TaskStatus; turn_id: string }
      | undefined;
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  assertBrowserAction(action: string): void {
    if (!ALLOWED_BROWSER_ACTIONS.includes(action as (typeof ALLOWED_BROWSER_ACTIONS)[number])) {
      throw new Error("不允许的操作");
    }
  }

  isStarted(): boolean {
    return this.started;
  }

  private existingThread(projectId: number, threadId: string): { id: string } {
    const row = this.db.prepare("SELECT project_id FROM tasks WHERE thread_id = ? LIMIT 1").get(threadId) as
      | { project_id: number }
      | undefined;
    if (!row || row.project_id !== projectId) throw new Error("会话不存在");
    return { id: threadId };
  }

  private project(projectId: number): { id: number; path: string; name: string } {
    const project = this.db.prepare("SELECT id, name, path FROM projects WHERE id = ?").get(projectId) as
      | { id: number; name: string; path: string }
      | undefined;
    if (!project) throw new Error("项目不存在");
    return project;
  }
}

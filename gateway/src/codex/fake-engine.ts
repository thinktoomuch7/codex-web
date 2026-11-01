import type { ApprovalDecision, CodexEngine, EngineEvent, ThreadLaunch, ThreadSummary, TimelineItem } from "./types.ts";

export class FakeEngine implements CodexEngine {
  versionValue = "9.9.9-test";
  loggedIn = false;
  threads: ThreadSummary[] = [];
  persisted = new Map<string, TimelineItem[]>();
  turnCount = 0;
  startTurnCalls = 0;
  interruptCalls = 0;
  approvalCalls: { approvalId: string; decision: string }[] = [];
  closed = false;
  invocations: string[] = [];
  applied: { threadId: string; cwd: string | undefined; launch: ThreadLaunch }[] = [];
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private readonly closeListeners = new Set<() => void>();
  active = new Map<string, string>();

  async version(): Promise<string> {
    this.invocations.push("version");
    return this.versionValue;
  }

  async readAccount(): Promise<{ loggedIn: boolean }> {
    this.invocations.push("readAccount");
    return { loggedIn: this.loggedIn };
  }

  async listThreads(cwd: string): Promise<ThreadSummary[]> {
    this.invocations.push("listThreads");
    return this.threads.filter((thread) => thread.cwd === cwd);
  }

  async startThread(cwd: string, launch?: ThreadLaunch): Promise<{ id: string }> {
    this.invocations.push("startThread");
    if (launch && (launch.model || launch.sandbox || launch.approvalPolicy)) {
      this.applied.push({ threadId: "pending", cwd, launch });
    }
    const id = `thr_${this.threads.length + 1}`;
    this.threads.push({ id, cwd, title: "新会话" });
    this.persisted.set(id, []);
    return { id };
  }

  async startTurn(threadId: string, text: string, _cwd?: string): Promise<{ turnId: string }> {
    this.invocations.push("startTurn");
    this.startTurnCalls += 1;
    const turnId = `turn_${++this.turnCount}`;
    this.active.set(threadId, turnId);
    const item = { id: `user-${turnId}`, kind: "userMessage", text };
    this.persisted.get(threadId)?.push(item);
    return { turnId };
  }

  async applySettings(threadId: string, cwd: string | undefined, launch: ThreadLaunch): Promise<void> {
    this.invocations.push("applySettings");
    this.applied.push({ threadId, cwd, launch });
  }

  async relocate(threadId: string, cwd: string): Promise<void> {
    this.invocations.push("relocate");
    const thread = this.threads.find((item) => item.id === threadId);
    if (thread) thread.cwd = cwd;
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    this.invocations.push("interrupt");
    this.interruptCalls += 1;
    this.active.delete(threadId);
    this.emit({ type: "turn", threadId, turnId, status: "interrupted" });
  }

  async listPersistedItems(threadId: string): Promise<TimelineItem[]> {
    this.invocations.push("listPersistedItems");
    return [...(this.persisted.get(threadId) ?? [])];
  }

  async deleteThread(threadId: string): Promise<void> {
    this.invocations.push("deleteThread");
    this.threads = this.threads.filter((thread) => thread.id !== threadId);
    this.persisted.delete(threadId);
    this.active.delete(threadId);
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    this.invocations.push("setThreadName");
    const thread = this.threads.find((item) => item.id === threadId);
    if (thread) thread.title = name;
  }

  async archiveThread(threadId: string): Promise<void> {
    this.invocations.push("archiveThread");
    void threadId;
  }

  async unarchiveThread(threadId: string): Promise<void> {
    this.invocations.push("unarchiveThread");
    void threadId;
  }

  async forkThread(threadId: string, cwd: string): Promise<{ id: string }> {
    this.invocations.push("forkThread");
    const source = this.threads.find((thread) => thread.id === threadId);
    const id = `thr_${this.threads.length + 1}`;
    this.threads.push({ id, cwd, title: source?.title ?? id });
    this.persisted.set(id, [...(this.persisted.get(threadId) ?? [])]);
    return { id };
  }

  async listModels(): Promise<{ id: string; name: string }[]> {
    this.invocations.push("listModels");
    return [{ id: "gpt-test", name: "gpt-test" }];
  }

  async respondApproval(approvalId: string, decision: ApprovalDecision): Promise<void> {
    this.invocations.push("respondApproval");
    this.approvalCalls.push({ approvalId, decision });
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  crash(): void {
    this.closed = true;
    for (const listener of this.closeListeners) listener();
  }

  pushLive(threadId: string, item: TimelineItem): void {
    this.emit({ type: "item", threadId, item });
  }
}

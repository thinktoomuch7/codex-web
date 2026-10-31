import type { CodexEngine, EngineEvent, ThreadSummary, TimelineItem } from "./types.ts";

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

  async startThread(cwd: string): Promise<{ id: string }> {
    this.invocations.push("startThread");
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

  async respondApproval(approvalId: string, decision: "accept" | "decline"): Promise<void> {
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

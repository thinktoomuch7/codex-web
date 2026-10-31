export type AccountState = { loggedIn: boolean };

export type ThreadSummary = {
  id: string;
  cwd: string;
  title: string;
};

export type TimelineItem = {
  id: string;
  kind: string;
  text: string;
  command?: string;
};

export type EngineEvent =
  | { type: "item"; threadId: string; item: TimelineItem }
  | { type: "approval"; threadId: string; turnId: string; approvalId: string; kind: string; text: string }
  | { type: "turn"; threadId: string; turnId: string; status: "completed" | "failed" | "interrupted" };

export interface CodexEngine {
  version(): Promise<string>;
  readAccount(): Promise<AccountState>;
  listThreads(cwd: string): Promise<ThreadSummary[]>;
  startThread(cwd: string): Promise<{ id: string }>;
  startTurn(threadId: string, text: string, cwd?: string): Promise<{ turnId: string }>;
  interrupt(threadId: string, turnId: string): Promise<void>;
  listPersistedItems(threadId: string): Promise<TimelineItem[]>;
  deleteThread(threadId: string): Promise<void>;
  respondApproval(approvalId: string, decision: "accept" | "decline"): Promise<void>;
  onEvent(listener: (event: EngineEvent) => void): () => void;
  onClose(listener: () => void): () => void;
}

export const ALLOWED_BROWSER_ACTIONS = [
  "list-projects",
  "list-threads",
  "start-turn",
  "interrupt-turn",
  "submit-approval",
  "read-timeline",
  "read-account",
  "delete-thread",
] as const;

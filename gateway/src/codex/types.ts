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

export type ThreadLaunch = {
  model?: string;
  sandbox?: string;
  approvalPolicy?: string;
};

export type ApprovalDecision = "accept" | "decline" | "acceptForSession";

export type EngineEvent =
  | { type: "item"; threadId: string; item: TimelineItem }
  | { type: "delta"; threadId: string; itemId: string; kind: string; text: string }
  | { type: "approval"; threadId: string; turnId: string; approvalId: string; kind: string; text: string }
  | { type: "turn"; threadId: string; turnId: string; status: "completed" | "failed" | "interrupted"; error?: string }
  | { type: "failure"; threadId: string; turnId: string; error: string }
  | { type: "title"; threadId: string; title: string };

export interface CodexEngine {
  version(): Promise<string>;
  readAccount(): Promise<AccountState>;
  listThreads(cwd: string): Promise<ThreadSummary[]>;
  startThread(cwd: string, launch?: ThreadLaunch): Promise<{ id: string }>;
  startTurn(threadId: string, text: string, cwd?: string): Promise<{ turnId: string }>;
  applySettings(threadId: string, cwd: string | undefined, launch: ThreadLaunch): Promise<void>;
  relocate(threadId: string, cwd: string): Promise<void>;
  interrupt(threadId: string, turnId: string): Promise<void>;
  listPersistedItems(threadId: string): Promise<TimelineItem[]>;
  deleteThread(threadId: string): Promise<void>;
  setThreadName(threadId: string, name: string): Promise<void>;
  archiveThread(threadId: string): Promise<void>;
  unarchiveThread(threadId: string): Promise<void>;
  forkThread(threadId: string, cwd: string): Promise<{ id: string }>;
  listModels(): Promise<{ id: string; name: string }[]>;
  respondApproval(approvalId: string, decision: ApprovalDecision): Promise<void>;
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
  "rename-thread",
  "archive-thread",
  "unarchive-thread",
  "fork-thread",
  "set-thread-settings",
  "list-models",
  "git-diff",
  "git-stage",
  "git-revert",
  "git-commit",
  "git-push",
  "git-pr",
  "browse-directory",
  "create-directory",
  "pin-thread",
  "list-files",
  "read-file",
  "upload-file",
  "terminal",
  "read-capabilities",
] as const;

// 对照 unix-engine 实际解析的通知：turn/completed、error、item/*、thread/name/updated。
// 0.166 这条链路上没有用量、压缩对话或思考档位事件，界面不画对应按钮。
export const OFFICIAL_EXTRAS = { usage: false, compact: false, thinking: false } as const;

export type Project = { id: number; name: string; path: string };
export type ThreadSummary = {
  id: string;
  cwd?: string;
  title: string;
  status?: string | null;
  pending?: number;
  mode?: string;
  updatedAt?: number;
};
export type RecentThread = ThreadSummary & { projectId: number; projectName: string };
export type TimelineItem = { id: string; kind: string; text: string; command?: string };
export type Approval = { id: string; thread_id: string; turn_id: string; kind: string; payload: string };
export type Task = { id: number; status: string; turn_id: string; created_at?: number; updated_at?: number; error?: string | null } | null;
export type TimelineView = { items: TimelineItem[]; approvals: Approval[]; task: Task; queue?: string[]; older?: boolean };

export function apiUrl(pathname: string): string {
  const prefix = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${prefix}${pathname}`;
}

async function send<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(pathname), {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "请求失败");
  return body;
}

export const api = {
  login: (password: string) => send<{ ok: boolean }>("/api/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => send<{ ok: boolean }>("/api/logout", { method: "POST", body: "{}" }),
  projects: () => send<{ projects: Project[] }>("/api/projects"),
  addProject: (name: string, path: string) =>
    send<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify({ name, path }) }),
  threads: (projectId: number, archived = false) =>
    send<{ threads: ThreadSummary[]; git: boolean }>(`/api/projects/${projectId}/threads${archived ? "?archived=1" : ""}`),
  recent: (archived = false) => send<{ threads: RecentThread[] }>(`/api/threads/recent${archived ? "?archived=1" : ""}`),
  syncRecent: () => send<{ threads: RecentThread[] }>("/api/threads/recent/sync", { method: "POST", body: "{}" }),
  projectGit: (projectId: number) => send<{ git: boolean }>(`/api/projects/${projectId}/git`),
  account: () => send<{ loggedIn: boolean }>("/api/account"),
  timeline: (threadId: string, before?: string) =>
    send<TimelineView>(
      `/api/threads/${encodeURIComponent(threadId)}/timeline${before ? `?before=${encodeURIComponent(before)}` : ""}`,
    ),
  startTurn: (projectId: number, text: string, threadId?: string, directory?: "worktree" | "local") =>
    send<{ threadId: string; turnId: string; taskId: number; queued?: boolean }>(`/api/projects/${projectId}/threads`, {
      method: "POST",
      body: JSON.stringify({ text, threadId, directory }),
    }),
  interrupt: (threadId: string) =>
    send<{ ok: boolean }>(`/api/threads/${encodeURIComponent(threadId)}/interrupt`, { method: "POST", body: "{}" }),
  deleteThread: (projectId: number, threadId: string) =>
    send<{ ok: boolean }>(`/api/threads/${encodeURIComponent(threadId)}/delete`, {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),
  approve: (approvalId: string, decision: "accept" | "decline" | "acceptForSession") =>
    send<{ ok: boolean }>(`/api/approvals/${encodeURIComponent(approvalId)}`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
  renameThread: (projectId: number, threadId: string, name: string) =>
    send<{ ok: boolean }>(`/api/threads/${encodeURIComponent(threadId)}/rename`, {
      method: "POST",
      body: JSON.stringify({ projectId, name }),
    }),
  archiveThread: (projectId: number, threadId: string) =>
    send<{ ok: boolean }>(`/api/threads/${encodeURIComponent(threadId)}/archive`, {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),
  unarchiveThread: (projectId: number, threadId: string) =>
    send<{ ok: boolean }>(`/api/threads/${encodeURIComponent(threadId)}/unarchive`, {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),
  forkThread: (projectId: number, threadId: string) =>
    send<{ threadId: string }>(`/api/threads/${encodeURIComponent(threadId)}/fork`, {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),
  saveSettings: (threadId: string, patch: { model?: string; sandbox?: string; approvalPolicy?: string }) =>
    send<{ ok: boolean }>(`/api/threads/${encodeURIComponent(threadId)}/settings`, {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  models: () => send<{ models: { id: string; name: string }[] }>("/api/models"),
  git: (projectId: number, threadId: string, body: { action: string; paths?: string[]; message?: string; title?: string }) =>
    send<{ diff?: string; ok?: boolean; url?: string; error?: string }>(`/api/threads/${encodeURIComponent(threadId)}/git`, {
      method: "POST",
      body: JSON.stringify({ projectId, ...body }),
    }),
};

export const STATUS_LABEL: Record<string, string> = {
  running: "执行中",
  waiting_approval: "等待审批",
  completed: "已完成",
  failed: "失败",
  interrupted: "已停止",
};

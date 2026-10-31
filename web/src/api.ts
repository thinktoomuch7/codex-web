export type Project = { id: number; name: string; path: string };
export type ThreadSummary = { id: string; cwd: string; title: string };
export type TimelineItem = { id: string; kind: string; text: string; command?: string };
export type Approval = { id: string; thread_id: string; turn_id: string; kind: string; payload: string };
export type Task = { id: number; status: string; turn_id: string } | null;

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
  threads: (projectId: number) => send<{ threads: ThreadSummary[] }>(`/api/projects/${projectId}/threads`),
  account: () => send<{ loggedIn: boolean }>("/api/account"),
  timeline: (threadId: string) =>
    send<{ items: TimelineItem[]; approvals: Approval[]; task: Task }>(`/api/threads/${encodeURIComponent(threadId)}/timeline`),
  startTurn: (projectId: number, text: string, threadId?: string) =>
    send<{ threadId: string; turnId: string; taskId: number }>(`/api/projects/${projectId}/threads`, {
      method: "POST",
      body: JSON.stringify({ text, threadId }),
    }),
  interrupt: (threadId: string) =>
    send<{ ok: boolean }>(`/api/threads/${encodeURIComponent(threadId)}/interrupt`, { method: "POST", body: "{}" }),
  deleteThread: (projectId: number, threadId: string) =>
    send<{ ok: boolean }>(`/api/threads/${encodeURIComponent(threadId)}/delete`, {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),
  approve: (approvalId: string, decision: "accept" | "decline") =>
    send<{ ok: boolean }>(`/api/approvals/${encodeURIComponent(approvalId)}`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
};

export const STATUS_LABEL: Record<string, string> = {
  running: "执行中",
  waiting_approval: "等待审批",
  completed: "已完成",
  failed: "失败",
  interrupted: "已停止",
};

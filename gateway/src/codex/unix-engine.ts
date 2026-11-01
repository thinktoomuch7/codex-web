import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ApprovalDecision, CodexEngine, EngineEvent, ThreadLaunch, ThreadSummary, TimelineItem } from "./types.ts";
import { RpcClient, sendListThreads, type RpcTransport } from "./rpc.ts";

type Handler = (event: EngineEvent) => void;

export class UnixCodexEngine implements CodexEngine {
  private readonly socketPath: string;
  private readonly listeners = new Set<Handler>();
  private readonly closeListeners = new Set<() => void>();
  private readonly approvalRpcIds = new Map<string, number>();
  private client: RpcClient | null = null;
  private readonly loadedThreads = new Set<string>();

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async connect(): Promise<void> {
    const child = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    child.stderr.on("data", (chunk: Buffer) => {
      console.error(chunk.toString());
    });
    child.stdin.on("error", (error) => {
      console.error(error);
    });
    child.stdout.on("error", (error) => {
      console.error(error);
    });
    const transport = childTransport(child);
    this.client = new RpcClient(transport);
    child.on("exit", () => {
      for (const listener of this.closeListeners) listener();
    });
    this.client.onNotification((message) => {
      const params = (message.params ?? {}) as Record<string, unknown>;
      const threadId = typeof params.threadId === "string" ? params.threadId : "";
      if (!/delta/i.test(message.method)) console.error(`codex-event ${message.method}`);
      if (message.method === "turn/completed") {
        const turn = params.turn as { id?: string; status?: string } | undefined;
        const raw = turn?.status;
        const status = raw === "failed" || raw === "interrupted" ? raw : "completed";
        this.emit({ type: "turn", threadId, turnId: String(turn?.id ?? ""), status });
      }
      if (message.method === "item/completed" || message.method === "item/started") {
        const item = params.item as RawItem | undefined;
        this.emit({
          type: "item",
          threadId,
          item: timelineItemFromRaw(item, `${threadId}-${message.method}`),
        });
      }
      const delta = streamDelta(message.method, params);
      if (delta) this.emit({ type: "delta", ...delta });
      if (message.method === "thread/name/updated") {
        const title = typeof params.name === "string" ? params.name : typeof params.title === "string" ? params.title : "";
        if (title) this.emit({ type: "title", threadId, title });
      }
    });
    this.client.onServerRequest((request) => {
      console.error(`codex-request ${request.method}`);
      if (!request.method.includes("requestApproval")) return;
      const params = (request.params ?? {}) as { itemId?: string; threadId?: string; turnId?: string; command?: string; reason?: string };
      const approvalId = params.itemId ?? String(request.id);
      this.approvalRpcIds.set(approvalId, request.id);
      this.emit({
        type: "approval",
        threadId: params.threadId ?? "",
        turnId: params.turnId ?? "",
        approvalId,
        kind: request.method,
        text: params.command || params.reason || request.method,
      });
    });
    await this.client.request("initialize", {
      clientInfo: { name: "codex-web", version: "0.1.0" },
      capabilities: {},
    });
    this.client.notify("initialized", {});
  }

  private rpc(): RpcClient {
    if (!this.client) throw new Error("Codex 连接尚未建立");
    return this.client;
  }

  async version(): Promise<string> {
    const output = await execText("codex", ["--version"]);
    return output.trim().split(/\s+/).pop() ?? output.trim();
  }

  async readAccount(): Promise<{ loggedIn: boolean }> {
    const result = (await this.rpc().request("account/read", { refreshToken: false })) as {
      account?: { type?: string } | null;
    };
    return { loggedIn: Boolean(result.account) };
  }

  async listThreads(cwd: string): Promise<ThreadSummary[]> {
    const result = (await sendListThreads(this.rpc(), cwd)) as {
      data?: { id: string; cwd?: string; name?: string; preview?: string }[];
    };
    console.error(`thread-list ${JSON.stringify(result).slice(0, 700)}`);
    return (result.data ?? []).map((thread) => ({
      id: thread.id,
      cwd: thread.cwd ?? cwd,
      title: thread.name || thread.preview || thread.id,
    }));
  }

  async startThread(cwd: string, launch?: ThreadLaunch): Promise<{ id: string }> {
    const result = (await this.rpc().request("thread/start", threadStartParams(cwd, launch))) as {
      thread: { id: string };
    };
    this.loadedThreads.add(result.thread.id);
    return { id: result.thread.id };
  }

  async applySettings(threadId: string, cwd: string | undefined, launch: ThreadLaunch): Promise<void> {
    await this.rpc().request("thread/resume", resumeParams(threadId, cwd, launch));
    this.loadedThreads.add(threadId);
  }

  async relocate(threadId: string, cwd: string): Promise<void> {
    try {
      await this.rpc().request("thread/resume", { threadId, cwd });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/already/i.test(message)) throw error;
    }
    this.loadedThreads.add(threadId);
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    await this.rpc().request("thread/name/set", { threadId, name });
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.rpc().request("thread/archive", { threadId });
  }

  async unarchiveThread(threadId: string): Promise<void> {
    await this.rpc().request("thread/unarchive", { threadId });
  }

  async forkThread(threadId: string, cwd: string): Promise<{ id: string }> {
    const result = (await this.rpc().request("thread/fork", { threadId, cwd })) as {
      thread?: { id: string };
      threadId?: string;
    };
    const id = result.thread?.id ?? result.threadId;
    if (!id) throw new Error("分叉没有返回会话");
    this.loadedThreads.add(id);
    return { id };
  }

  async listModels(): Promise<{ id: string; name: string }[]> {
    const result = (await this.rpc().request("model/list", {})) as {
      data?: { id?: string; model?: string; name?: string }[];
      models?: { id?: string; model?: string; name?: string }[];
    };
    const rows = result.data ?? result.models ?? [];
    return rows
      .map((row) => {
        const id = row.id ?? row.model ?? "";
        return { id, name: row.name ?? id };
      })
      .filter((row) => row.id);
  }

  async startTurn(threadId: string, text: string, cwd?: string): Promise<{ turnId: string }> {
    await this.ensureLoaded(threadId, cwd);
    const result = (await this.rpc().request("turn/start", {
      threadId,
      input: [{ type: "text", text }],
    })) as { turn: { id: string } };
    return { turnId: result.turn.id };
  }

  private async ensureLoaded(threadId: string, cwd?: string): Promise<void> {
    if (this.loadedThreads.has(threadId)) return;
    try {
      await this.rpc().request("thread/resume", cwd ? { threadId, cwd } : { threadId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/already/i.test(message)) throw error;
    }
    this.loadedThreads.add(threadId);
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.rpc().request("thread/delete", { threadId });
    this.loadedThreads.delete(threadId);
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.rpc().request("turn/interrupt", { threadId, turnId });
  }

  async listPersistedItems(threadId: string): Promise<TimelineItem[]> {
    const result = (await this.rpc().request("thread/items/list", {
      threadId,
      limit: 200,
      sortDirection: "asc",
    })) as { data?: { item?: RawItem }[] };
    return (result.data ?? []).map((entry, index) => timelineItemFromRaw(entry.item, `${threadId}-${index}`));
  }

  async respondApproval(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const rpcId = this.approvalRpcIds.get(approvalId);
    if (rpcId === undefined) throw new Error("没有对应的审批请求");
    this.rpc().respond(rpcId, { decision });
    this.approvalRpcIds.delete(approvalId);
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  onEvent(listener: Handler): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
}

type RawItem = {
  id?: string;
  type?: string;
  text?: string;
  command?: string | string[];
  aggregatedOutput?: string;
  aggregated_output?: string;
  content?: unknown;
};

const STREAM_METHODS = new Set([
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/reasoning/textDelta",
  "item/reasoning/summaryTextDelta",
  "item/plan/delta",
]);

export function threadStartParams(cwd: string, launch?: ThreadLaunch): Record<string, string> {
  return {
    cwd,
    serviceName: "codex-web",
    ...(launch?.model ? { model: launch.model } : {}),
    ...(launch?.sandbox ? { sandbox: launch.sandbox } : {}),
    ...(launch?.approvalPolicy ? { approvalPolicy: launch.approvalPolicy } : {}),
  };
}

export function resumeParams(threadId: string, cwd: string | undefined, launch?: ThreadLaunch): Record<string, string> {
  return {
    threadId,
    ...(cwd ? { cwd } : {}),
    ...(launch?.model ? { model: launch.model } : {}),
    ...(launch?.sandbox ? { sandbox: launch.sandbox } : {}),
    ...(launch?.approvalPolicy ? { approvalPolicy: launch.approvalPolicy } : {}),
  };
}

export function streamDelta(
  method: string,
  params: Record<string, unknown>,
): { threadId: string; itemId: string; kind: string; text: string } | null {
  if (!STREAM_METHODS.has(method)) return null;
  const text = typeof params.delta === "string" ? params.delta : typeof params.text === "string" ? params.text : "";
  const threadId = typeof params.threadId === "string" ? params.threadId : "";
  const item = params.item as { id?: string } | undefined;
  const itemId = typeof params.itemId === "string" ? params.itemId : typeof item?.id === "string" ? item.id : "";
  if (!text || !threadId || !itemId) return null;
  let kind = "agentMessage";
  if (method.includes("commandExecution")) kind = "commandExecution";
  else if (method.includes("fileChange")) kind = "fileChange";
  else if (method.includes("reasoning")) kind = "reasoning";
  else if (method.includes("plan")) kind = "plan";
  return { threadId, itemId, kind, text };
}

export function timelineItemFromRaw(item: RawItem | undefined, fallbackId: string): TimelineItem {
  const command = commandLine(item?.command);
  return {
    id: item?.id ?? fallbackId,
    kind: item?.type ?? "item",
    text: itemBody(item, command),
    ...(command ? { command } : {}),
  };
}

function commandLine(command: string | string[] | undefined): string {
  if (typeof command === "string") return command.trim();
  if (Array.isArray(command)) return command.map((part) => String(part)).join(" ").trim();
  return "";
}

function itemBody(item: RawItem | undefined, command: string): string {
  if (!item) return "";
  const output = firstText(item.aggregatedOutput, item.aggregated_output, contentText(item.content));
  if (command) {
    if (output && output.trim() !== command) return output.replace(/\s+$/, "");
    if (item.text && item.text.trim() !== command) return item.text.replace(/\s+$/, "");
    return "";
  }
  if (item.text) return item.text;
  return output;
}

function firstText(...values: Array<string | undefined>): string {
  return values.find((value) => value && value.trim()) ?? "";
}

function contentText(content: unknown): string {
  if (typeof content === "string" && content) return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function execText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function childTransport(child: ChildProcessWithoutNullStreams): RpcTransport {
  let buffer = "";
  const listeners = new Set<(line: string) => void>();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        for (const listener of listeners) listener(line);
      }
      newline = buffer.indexOf("\n");
    }
  });
  return {
    send(line: string) {
      child.stdin.write(`${line}\n`);
    },
    onLine(listener: (line: string) => void) {
      listeners.add(listener);
    },
    close() {
      child.kill();
    },
  };
}

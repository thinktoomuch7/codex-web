export type RpcRequest = {
  id: number;
  method: string;
  params?: unknown;
};

export function listThreadsParams(cwd: string): { cwd: string; sourceKinds: string[] } {
  // 0.166 把本网关创建的会话记成 vscode，只过滤 appServer 时列表是空的。
  return { cwd, sourceKinds: ["appServer", "vscode"] };
}

export function sendListThreads(client: RpcClient, cwd: string): Promise<unknown> {
  return client.request("thread/list", listThreadsParams(cwd));
}

export type RpcTransport = {
  send(line: string): void;
  onLine(listener: (line: string) => void): void;
  close(): void;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type ServerRequest = { id: number; method: string; params?: unknown };

export class RpcClient {
  private readonly transport: RpcTransport;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  readonly sent: RpcRequest[] = [];
  private serverRequestListener: ((request: ServerRequest) => void) | null = null;
  private notificationListener: ((message: { method: string; params?: unknown }) => void) | null = null;

  constructor(transport: RpcTransport) {
    this.transport = transport;
    transport.onLine((line) => {
      let message: {
        id?: number;
        result?: unknown;
        error?: { message?: string };
        method?: string;
        params?: unknown;
      };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        console.error(`codex-rpc skip ${line.slice(0, 160)}`);
        return;
      }
      if (message.id !== undefined && message.method && message.result === undefined && message.error === undefined) {
        this.serverRequestListener?.({ id: message.id, method: message.method, params: message.params });
        return;
      }
      if (message.method && message.id === undefined) {
        this.notificationListener?.({ method: message.method, params: message.params });
        return;
      }
      if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (!waiter) return;
        if (message.error) waiter.reject(new Error(message.error.message ?? "rpc error"));
        else waiter.resolve(message.result);
      }
    });
  }

  onServerRequest(listener: (request: ServerRequest) => void): void {
    this.serverRequestListener = listener;
  }

  onNotification(listener: (message: { method: string; params?: unknown }) => void): void {
    this.notificationListener = listener;
  }

  respond(id: number, result: unknown): void {
    this.transport.send(JSON.stringify({ id, result }));
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const body: RpcRequest = { id, method, params };
    this.sent.push(body);
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.transport.send(JSON.stringify(body));
    return result;
  }

  notify(method: string, params?: unknown): void {
    this.transport.send(JSON.stringify({ method, params }));
  }

  close(): void {
    this.transport.close();
  }
}

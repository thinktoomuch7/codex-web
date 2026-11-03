import { randomBytes } from "node:crypto";

export type TerminalSession = {
  id: string;
  cwd: string;
  output: string;
  error: string;
  write: (data: string) => void;
  close: () => void;
  listeners: Set<(chunk: string) => void>;
};

type Backend = {
  start: (cwd: string) => { write: (data: string) => void; close: () => void; onData: (listener: (chunk: string) => void) => void };
};

const sessions = new Map<string, TerminalSession>();
let backend: Backend | null = null;

export function setTerminalBackend(next: Backend | null): void {
  backend = next;
}

export function terminalSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
}

export async function startTerminal(cwd: string): Promise<TerminalSession> {
  const id = randomBytes(8).toString("hex");
  const session: TerminalSession = {
    id,
    cwd,
    output: "",
    error: "",
    write: () => undefined,
    close: () => undefined,
    listeners: new Set(),
  };
  try {
    const started = backend ? backend.start(cwd) : await startPty(cwd);
    session.write = started.write;
    session.close = started.close;
    started.onData((chunk) => {
      session.output = `${session.output}${chunk}`.slice(-20_000);
      for (const listener of session.listeners) listener(chunk);
    });
  } catch (error) {
    session.error = error instanceof Error ? error.message : "终端启动失败。";
  }
  sessions.set(id, session);
  return session;
}

async function startPty(cwd: string): Promise<{ write: (data: string) => void; close: () => void; onData: (listener: (chunk: string) => void) => void }> {
  try {
    const load = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{
      spawn: (file: string, args: string[], options: { cwd: string; name: string; cols: number; rows: number }) => {
        write: (data: string) => void;
        kill: () => void;
        onData: (listener: (chunk: string) => void) => void;
      };
    }>;
    const pty = await load("node-pty");
    const shell = process.platform === "win32" ? "powershell.exe" : "bash";
    const term = pty.spawn(shell, [], { cwd, name: "xterm-256color", cols: 100, rows: 28 });
    return { write: (data) => term.write(data), close: () => term.kill(), onData: (listener) => term.onData(listener) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    throw new Error(detail ? `终端启动失败。${detail}` : "终端启动失败。");
  }
}

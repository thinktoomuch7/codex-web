"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { api, apiUrl } from "./api";

export function TerminalPane({
  projectId,
  threadId,
  cwd,
  onClose,
}: {
  projectId: number | null;
  threadId: string | null;
  cwd: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    if (!projectId || !threadId || !hostRef.current) return;
    const host = hostRef.current;
    let closed = false;
    let source: EventSource | null = null;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "var(--font-mono), ui-monospace, monospace",
      fontSize: 13,
      theme: theme === "dark"
        ? { background: "#111318", foreground: "#e5e7eb", cursor: "#e5e7eb" }
        : { background: "#fbfbfc", foreground: "#111827", cursor: "#111827" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host);
    const writable = term.onData((data) => {
      const id = sessionId;
      if (id) void api.terminalInput(threadId, id, data).catch(() => undefined);
    });
    let sessionId = "";
    void api.terminal(projectId, threadId).then(
      (opened) => {
        if (closed) return;
        sessionId = opened.id;
        source = new EventSource(apiUrl(`/api/threads/${encodeURIComponent(threadId)}/terminal/events?id=${encodeURIComponent(opened.id)}`));
        source.onmessage = (event) => {
          const body = JSON.parse(event.data) as { text?: string; error?: string };
          if (body.error) setError(body.error);
          if (body.text) term.write(body.text);
        };
      },
      (reason: unknown) => {
        if (!closed) setError(reason instanceof Error ? reason.message : "终端启动失败。");
      },
    );
    return () => {
      closed = true;
      observer.disconnect();
      writable.dispose();
      source?.close();
      term.dispose();
    };
  }, [projectId, threadId, theme]);

  return (
    <section className="terminal-panel" data-terminal-theme={theme} style={{ height: 320, flex: "none" }} aria-label="终端">
      <header className="terminal-panel-header">
        <div className="terminal-panel-path">
          <span className={`terminal-status-dot${error ? " is-error" : " is-ready"}`} />
          <span>{cwd || "终端"}</span>
        </div>
        <div className="terminal-panel-actions">
          <button type="button" aria-label={theme === "dark" ? "浅色终端" : "深色终端"} onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}>
            {theme === "dark" ? "浅色" : "深色"}
          </button>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </header>
      <div>{error ? <div className="terminal-panel-error" role="alert">{error}</div> : null}</div>
      <div className="terminal-xterm">
        <div ref={hostRef} className="terminal-xterm-host" />
      </div>
    </section>
  );
}

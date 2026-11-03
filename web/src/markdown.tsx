"use client";

import { cloneElement, isValidElement, useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

export function highlighted(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = lower.indexOf(target);
  let key = 0;
  while (index >= 0) {
    if (index > cursor) nodes.push(text.slice(cursor, index));
    nodes.push(<mark key={key}>{text.slice(index, index + needle.length)}</mark>);
    key += 1;
    cursor = index + needle.length;
    index = lower.indexOf(target, cursor);
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function markNode(node: ReactNode, query: string): ReactNode {
  if (!query.trim()) return node;
  if (typeof node === "string") return highlighted(node, query);
  if (Array.isArray(node)) return node.map((child, index) => <span key={index}>{markNode(child, query)}</span>);
  if (isValidElement<{ children?: ReactNode }>(node)) return cloneElement(node, {}, markNode(node.props.children, query));
  return node;
}

function pageUsesDarkCode() {
  if (typeof document === "undefined") return false;
  const theme = document.documentElement.dataset.theme ?? "light";
  return document.documentElement.classList.contains("dark") || theme === "dark" || theme === "pine" || theme === "dusk" || theme === "ember" || theme === "slate" || theme === "contrast-dark" || theme === "zenburn";
}

function useDarkCode() {
  const [dark, setDark] = useState(pageUsesDarkCode);
  useEffect(() => {
    const read = () => setDark(pageUsesDarkCode());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function MarkdownBody({ text, query = "" }: { text: string; query?: string }) {
  const darkCode = useDarkCode();
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p({ children }) {
            return <p>{markNode(children, query)}</p>;
          },
          li({ children }) {
            return <li>{markNode(children, query)}</li>;
          },
          code({ className, children }) {
            const match = /language-(\w+)/.exec(className ?? "");
            const source = String(children).replace(/\n$/, "");
            if (!match) return <code className={className}>{children}</code>;
            return (
              <SyntaxHighlighter language={match[1]} style={darkCode ? oneDark : oneLight} PreTag="div" customStyle={{ margin: 0, borderRadius: 8, fontSize: 12 }}>
                {source}
              </SyntaxHighlighter>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.trim().split("\n")[0]?.slice(0, 96) ?? "";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        minWidth: 0,
        marginBottom: 8,
        border: "1px solid var(--border)",
        borderRadius: 7,
        padding: "6px 10px",
        background: "var(--bg)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={preview ? `思考: ${preview}` : "思考"}
        onClick={() => setOpen((value) => !value)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          width: open ? 14 : "100%",
          flexShrink: open ? 0 : 1,
          minWidth: 0,
          padding: 0,
          border: 0,
          background: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <span style={{ flex: "none" }}>{open ? "▾" : "▸"}</span>
        {open ? null : <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview || "思考"}</span>}
      </button>
      {open ? <div style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--text-muted)" }}>{text}</div> : null}
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="message-action-label"
      style={{ border: 0, background: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 11, padding: 0 }}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}

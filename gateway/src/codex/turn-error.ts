import { redactSecrets } from "../git.ts";

const LIMIT = /usage limit|rate limit|quota|insufficient_quota|billing|额度|usageLimitExceeded/i;

export function readTurnCompletion(params: Record<string, unknown>): {
  threadId: string;
  turnId: string;
  status: "completed" | "failed" | "interrupted";
  error?: string;
} {
  const turn = record(params.turn);
  const raw = typeof turn?.status === "string" ? turn.status : "";
  const status = raw === "failed" || raw === "interrupted" ? raw : "completed";
  const error = status === "failed" && turn?.error != null ? explainCodexError(turn.error) : undefined;
  return {
    threadId: text(params.threadId),
    turnId: text(turn?.id),
    status,
    ...(error ? { error } : {}),
  };
}

export function readFailureNotice(params: Record<string, unknown>): { threadId: string; turnId: string; error: string } {
  return {
    threadId: text(params.threadId),
    turnId: text(params.turnId),
    error: explainCodexError(params.error ?? params),
  };
}

export function explainCodexError(error: unknown): string {
  const body = record(error);
  const code = errorCode(body?.codexErrorInfo);
  const message = redactSecrets(text(body?.message) || text(error)).slice(0, 500);
  const lead = leadFor(code, message);
  if (!lead) return message || "这一轮失败了。";
  if (!message || message === lead || message.includes(lead)) return lead;
  return `${lead} ${message}`;
}

function leadFor(code: string, message: string): string {
  if (code === "usageLimitExceeded" || LIMIT.test(`${code} ${message}`)) return "额度已用完，这一轮没有完成。";
  if (code === "contextWindowExceeded") return "对话太长，放不下这次请求。";
  if (code === "unauthorized") return "Codex 登录已失效。";
  if (code === "sandboxError") return "命令被沙箱拦住了。";
  if (code === "badRequest") return "请求被拒绝。";
  if (/httpConnectionFailed|responseStream|internalServerError|responseTooManyFailedAttempts/i.test(code)) return "连接模型失败。";
  return "";
}

function errorCode(info: unknown): string {
  if (typeof info === "string") return info;
  const body = record(info);
  if (!body) return "";
  if (typeof body.type === "string") return body.type;
  const key = Object.keys(body)[0];
  return key ?? "";
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

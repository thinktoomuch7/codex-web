import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import type { AppConfig } from "./config.ts";
import type { Runtime } from "./runtime.ts";

const COOKIE = "cw_session";

export function startServer(config: AppConfig, runtime: Runtime, webRoot?: string) {
  const server = createServer(async (request, response) => {
    try {
      await route(config, runtime, request, response, webRoot);
    } catch (error) {
      const named = error as Error;
      console.error(named);
      if (response.headersSent || response.writableEnded) {
        response.destroy();
        return;
      }
      const status = named.name === "CodexNotLoggedIn" || named.name === "TurnBusy" ? 409 : 400;
      sendJson(response, status, { error: named.message });
    }
  });
  return new Promise<ReturnType<typeof createServer>>((resolve) => {
    server.listen(config.bindPort, config.bindHost, () => resolve(server));
  });
}

async function route(
  config: AppConfig,
  runtime: Runtime,
  request: IncomingMessage,
  response: ServerResponse,
  webRoot?: string,
) {
  const url = new URL(request.url ?? "/", `http://${config.bindHost}`);
  if (request.method === "GET" && webRoot && !url.pathname.startsWith("/api/") && serveStatic(webRoot, url.pathname, response)) {
    return;
  }
  const sessionId = readCookie(request, COOKIE);
  const user = runtime.sessionUser(sessionId);

  if (request.method === "POST" && url.pathname === "/api/engine") {
    sendJson(response, 403, { error: "不允许直接调用引擎方法" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(request);
    const id = runtime.login(String(body.password ?? ""));
    if (!id) {
      sendJson(response, 401, { error: "密码错误" });
      return;
    }
    response.setHeader("Set-Cookie", `${COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/`);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/logout") {
    if (sessionId) runtime.logout(sessionId);
    response.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (!user && url.pathname.startsWith("/api/")) {
    sendJson(response, 401, { error: "未登录" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/projects") {
    runtime.assertBrowserAction("list-projects");
    sendJson(response, 200, { projects: runtime.listProjects() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/projects") {
    const body = await readJson(request);
    const project = runtime.addProject(String(body.name ?? ""), String(body.path ?? ""));
    sendJson(response, 201, { project });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/account") {
    runtime.assertBrowserAction("read-account");
    sendJson(response, 200, await runtime.account());
    return;
  }

  const threads = url.pathname.match(/^\/api\/projects\/(\d+)\/threads$/);
  if (request.method === "GET" && threads) {
    runtime.assertBrowserAction("list-threads");
    sendJson(response, 200, { threads: await runtime.listThreads(Number(threads[1])) });
    return;
  }

  if (request.method === "POST" && threads) {
    runtime.assertBrowserAction("start-turn");
    const body = await readJson(request);
    const threadId = typeof body.threadId === "string" && body.threadId !== "" ? body.threadId : undefined;
    const created = await runtime.startTurn(Number(threads[1]), String(body.text ?? ""), threadId);
    sendJson(response, 201, created);
    return;
  }

  const timeline = url.pathname.match(/^\/api\/threads\/([^/]+)\/timeline$/);
  if (request.method === "GET" && timeline) {
    runtime.assertBrowserAction("read-timeline");
    const threadId = decodeURIComponent(timeline[1]);
    const view = await runtime.timeline(threadId);
    sendJson(response, 200, {
      ...view,
      approvals: runtime.pendingApprovals(threadId),
      task: runtime.taskForThread(threadId) ?? null,
    });
    return;
  }

  const events = url.pathname.match(/^\/api\/threads\/([^/]+)\/events$/);
  if (request.method === "GET" && events) {
    runtime.assertBrowserAction("read-timeline");
    const threadId = decodeURIComponent(events[1]);
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const push = async () => {
      try {
        if (response.writableEnded || response.destroyed) return;
        const view = await runtime.timeline(threadId);
        if (!response.writableEnded && !response.destroyed) {
          response.write(`data: ${JSON.stringify(view)}\n\n`);
        }
      } catch (error) {
        console.error(error);
      }
    };
    response.on("error", (error) => {
      console.error(error);
    });
    await push();
    const unsubscribe = runtime.subscribe(() => {
      void push();
    });
    request.on("close", () => unsubscribe());
    return;
  }

  const interrupt = url.pathname.match(/^\/api\/threads\/([^/]+)\/interrupt$/);
  if (request.method === "POST" && interrupt) {
    runtime.assertBrowserAction("interrupt-turn");
    await runtime.interrupt(decodeURIComponent(interrupt[1]));
    sendJson(response, 200, { ok: true });
    return;
  }

  const removeThread = url.pathname.match(/^\/api\/threads\/([^/]+)\/delete$/);
  if (request.method === "POST" && removeThread) {
    runtime.assertBrowserAction("delete-thread");
    const body = await readJson(request);
    await runtime.deleteThread(Number(body.projectId), decodeURIComponent(removeThread[1]));
    sendJson(response, 200, { ok: true });
    return;
  }

  const approval = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
  if (request.method === "POST" && approval) {
    runtime.assertBrowserAction("submit-approval");
    const body = await readJson(request);
    const decision = body.decision === "decline" ? "decline" : "accept";
    await runtime.submitApproval(decodeURIComponent(approval[1]), decision);
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: "未找到" });
}

function readCookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie ?? "";
  const match = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function serveStatic(webRoot: string, pathname: string, response: ServerResponse): boolean {
  const root = path.resolve(webRoot);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(root, `.${requested}`);
  const relative = path.relative(root, filePath);
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (!inside || !existsSync(filePath) || !statSync(filePath).isFile()) {
    const indexPath = path.join(root, "index.html");
    if (!path.extname(requested) && existsSync(indexPath)) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(readFileSync(indexPath));
      return true;
    }
    return false;
  }
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  response.writeHead(200, { "Content-Type": types[path.extname(filePath)] ?? "application/octet-stream" });
  response.end(readFileSync(filePath));
  return true;
}

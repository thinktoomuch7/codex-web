import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import type { AppConfig } from "./config.ts";
import { windowItems, type Runtime } from "./runtime.ts";

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

  const projectGit = url.pathname.match(/^\/api\/projects\/(\d+)\/git$/);
  if (request.method === "GET" && projectGit) {
    runtime.assertBrowserAction("list-projects");
    sendJson(response, 200, { git: await runtime.projectGit(Number(projectGit[1])) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/threads/recent") {
    runtime.assertBrowserAction("list-threads");
    sendJson(response, 200, runtime.recentThreads(url.searchParams.get("archived") === "1"));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/threads/recent/sync") {
    runtime.assertBrowserAction("list-threads");
    sendJson(response, 200, await runtime.syncRecent());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/threads/recent/events") {
    runtime.assertBrowserAction("list-threads");
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.socket?.setNoDelay(true);
    const push = () => {
      if (response.writableEnded || response.destroyed) return;
      response.write(`data: ${JSON.stringify(runtime.recentThreads())}\n\n`);
    };
    push();
    const unsubscribe = runtime.subscribe((notice) => {
      if (notice.scope !== "threads") return;
      push();
    });
    request.on("close", () => unsubscribe());
    return;
  }

  const threads = url.pathname.match(/^\/api\/projects\/(\d+)\/threads$/);
  if (request.method === "GET" && threads) {
    runtime.assertBrowserAction("list-threads");
    const archived = url.searchParams.get("archived") === "1";
    sendJson(response, 200, await runtime.listThreads(Number(threads[1]), archived));
    return;
  }

  const projectEvents = url.pathname.match(/^\/api\/projects\/(\d+)\/events$/);
  if (request.method === "GET" && projectEvents) {
    runtime.assertBrowserAction("list-threads");
    const projectId = Number(projectEvents[1]);
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const push = async () => {
      try {
        if (response.writableEnded || response.destroyed) return;
        const listed = await runtime.listThreads(projectId);
        if (!response.writableEnded && !response.destroyed) response.write(`data: ${JSON.stringify(listed)}\n\n`);
      } catch (error) {
        console.error(error);
      }
    };
    await push();
    const unsubscribe = runtime.subscribe((notice) => {
      if (notice.scope !== "threads") return;
      void push();
    });
    request.on("close", () => unsubscribe());
    return;
  }

  if (request.method === "POST" && threads) {
    runtime.assertBrowserAction("start-turn");
    const body = await readJson(request);
    const threadId = typeof body.threadId === "string" && body.threadId !== "" ? body.threadId : undefined;
    const directory = body.directory === "local" ? "local" : body.directory === "worktree" ? "worktree" : undefined;
    const created = await runtime.startTurn(Number(threads[1]), String(body.text ?? ""), threadId, directory);
    sendJson(response, created.queued ? 200 : 201, created);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/models") {
    runtime.assertBrowserAction("list-models");
    sendJson(response, 200, { models: await runtime.listModels() });
    return;
  }

  const timeline = url.pathname.match(/^\/api\/threads\/([^/]+)\/timeline$/);
  if (request.method === "GET" && timeline) {
    runtime.assertBrowserAction("read-timeline");
    const threadId = decodeURIComponent(timeline[1]);
    const before = url.searchParams.get("before") ?? undefined;
    const cached = runtime.cachedTimeline(threadId);
    if (!before || cached.items.length === 0) await runtime.timeline(threadId);
    sendJson(response, 200, threadView(runtime, threadId, before));
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
      "X-Accel-Buffering": "no",
    });
    response.socket?.setNoDelay(true);
    let ready = false;
    const write = () => {
      if (!ready || response.writableEnded || response.destroyed) return;
      response.write(`data: ${JSON.stringify(threadView(runtime, threadId))}\n\n`);
    };
    response.on("error", (error) => {
      console.error(error);
    });
    const unsubscribe = runtime.subscribe((notice) => {
      if (!ready || response.writableEnded || response.destroyed) return;
      if (notice.threadId && notice.threadId !== threadId) return;
      if (notice.scope === "text") {
        response.write(`data: ${JSON.stringify({ type: "delta", itemId: notice.itemId, kind: notice.kind, text: notice.text })}\n\n`);
        return;
      }
      if (notice.scope === "item") {
        response.write(`data: ${JSON.stringify({ type: "item", item: notice.item })}\n\n`);
        return;
      }
      response.write(
        `data: ${JSON.stringify({
          type: "status",
          approvals: runtime.pendingApprovals(threadId),
          task: runtime.taskForThread(threadId) ?? null,
          queue: runtime.cachedTimeline(threadId).queue,
        })}\n\n`,
      );
    });
    try {
      await runtime.timeline(threadId);
    } catch (error) {
      console.error(error);
    }
    ready = true;
    write();
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
    const decision = body.decision === "decline" ? "decline" : body.decision === "acceptForSession" ? "acceptForSession" : "accept";
    await runtime.submitApproval(decodeURIComponent(approval[1]), decision);
    sendJson(response, 200, { ok: true });
    return;
  }

  const threadAction = url.pathname.match(/^\/api\/threads\/([^/]+)\/(rename|archive|unarchive|fork|settings|git)$/);
  if (request.method === "POST" && threadAction) {
    const threadId = decodeURIComponent(threadAction[1]);
    const action = threadAction[2];
    const body = await readJson(request);
    const projectId = Number(body.projectId);
    if (action === "rename") {
      runtime.assertBrowserAction("rename-thread");
      await runtime.renameThread(projectId, threadId, String(body.name ?? ""));
      sendJson(response, 200, { ok: true });
      return;
    }
    if (action === "archive") {
      runtime.assertBrowserAction("archive-thread");
      await runtime.archiveThread(projectId, threadId);
      sendJson(response, 200, { ok: true });
      return;
    }
    if (action === "unarchive") {
      runtime.assertBrowserAction("unarchive-thread");
      await runtime.unarchiveThread(projectId, threadId);
      sendJson(response, 200, { ok: true });
      return;
    }
    if (action === "fork") {
      runtime.assertBrowserAction("fork-thread");
      sendJson(response, 201, await runtime.forkThread(projectId, threadId));
      return;
    }
    if (action === "settings") {
      runtime.assertBrowserAction("set-thread-settings");
      await runtime.setThreadSettings(threadId, {
        ...(typeof body.model === "string" ? { model: body.model } : {}),
        ...(typeof body.sandbox === "string" ? { sandbox: body.sandbox } : {}),
        ...(typeof body.approvalPolicy === "string" ? { approvalPolicy: body.approvalPolicy } : {}),
      });
      sendJson(response, 200, { ok: true });
      return;
    }
    runtime.assertBrowserAction(
      body.action === "stage"
        ? "git-stage"
        : body.action === "revert"
          ? "git-revert"
          : body.action === "commit"
            ? "git-commit"
            : body.action === "push"
              ? "git-push"
              : body.action === "pr"
                ? "git-pr"
                : "git-diff",
    );
    const gitAction = body.action === "stage" || body.action === "revert" || body.action === "commit" || body.action === "push" || body.action === "pr" ? body.action : "diff";
    sendJson(
      response,
      200,
      await runtime.gitAction(projectId, threadId, gitAction, {
        paths: Array.isArray(body.paths) ? body.paths.map(String) : [],
        message: typeof body.message === "string" ? body.message : undefined,
        title: typeof body.title === "string" ? body.title : undefined,
      }),
    );
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

function threadView(runtime: Runtime, threadId: string, before?: string) {
  const view = runtime.cachedTimeline(threadId);
  const windowed = windowItems(view.items, before);
  return {
    items: windowed.items,
    older: windowed.older,
    approvals: runtime.pendingApprovals(threadId),
    task: runtime.taskForThread(threadId) ?? null,
    queue: view.queue,
  };
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
  const extension = path.extname(filePath);
  response.writeHead(200, {
    "Content-Type": types[extension] ?? "application/octet-stream",
    ...(extension === ".html" ? { "Cache-Control": "no-cache" } : {}),
  });
  response.end(readFileSync(filePath));
  return true;
}

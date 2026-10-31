import { readFileSync } from "node:fs";
import http from "node:http";

const cfg = JSON.parse(readFileSync("/etc/codex-web/config.json", "utf8"));

function request(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: 8787,
        path,
        method,
        headers: {
          ...(data
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            json = { raw: text.slice(0, 400) };
          }
          const setCookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
          resolve({ status: res.statusCode, json, cookie: setCookie });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const login = await request("POST", "/api/login", { password: cfg.password });
if (login.status !== 200) {
  console.log("login_failed", login.status, JSON.stringify(login.json));
  process.exit(1);
}
const cookie = login.cookie;
const account = await request("GET", "/api/account", null, cookie);
console.log("account", JSON.stringify(account.json));
if (!account.json.loggedIn) {
  process.exit(1);
}

let projects = (await request("GET", "/api/projects", null, cookie)).json.projects ?? [];
if (projects.length === 0) {
  const created = await request("POST", "/api/projects", { name: "验收", path: "/srv/projects" }, cookie);
  console.log("project", created.status, JSON.stringify(created.json));
  if (created.status !== 201) process.exit(1);
  projects = [created.json.project];
}
const project = projects[0];
console.log("project", project.id, project.path);

const startedAt = Date.now();
const turn = await request(
  "POST",
  `/api/projects/${project.id}/threads`,
  { text: "只执行这一条命令，不要读写文件，不要做其他事：sleep 75 && echo DISCONNECT_OK_20261031" },
  cookie,
);
console.log("start", turn.status, JSON.stringify(turn.json), "elapsed_ms", Date.now() - startedAt);
if (turn.status !== 201) process.exit(1);
const threadId = turn.json.threadId;

await new Promise((resolve) => {
  const req = http.get(
    {
      host: "127.0.0.1",
      port: 8787,
      path: `/api/threads/${encodeURIComponent(threadId)}/events`,
      headers: { Cookie: cookie },
    },
    (res) => {
      res.on("data", () => {});
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 1500);
    },
  );
  req.on("error", () => resolve());
});
console.log("client_disconnected", threadId);

const login2 = await request("POST", "/api/login", { password: cfg.password });
const cookie2 = login2.cookie;
const threads = await request("GET", `/api/projects/${project.id}/threads`, null, cookie2);
const ids = (threads.json.threads ?? []).map((item) => item.id);
console.log("second_session_sees_thread", ids.includes(threadId), JSON.stringify(ids));

const deadline = Date.now() + 200000;
let last = "";
while (Date.now() < deadline) {
  const view = await request("GET", `/api/threads/${encodeURIComponent(threadId)}/timeline`, null, cookie2);
  const task = view.json.task;
  const approvals = view.json.approvals ?? [];
  const texts = (view.json.items ?? []).map((item) => `${item.kind}:${String(item.text).slice(0, 180)}`).join(" | ");
  const line = `status=${task?.status} approvals=${approvals.length} ${texts.slice(0, 700)}`;
  if (line !== last) {
    console.log(line);
    last = line;
  }
  for (const approval of approvals) {
    const accepted = await request(
      "POST",
      `/api/approvals/${encodeURIComponent(approval.id)}`,
      { decision: "accept" },
      cookie2,
    );
    console.log("accepted", approval.id, accepted.status, JSON.stringify(accepted.json));
  }
  const done = task && task.status !== "running" && task.status !== "waiting_approval";
  if (done && String(texts).includes("DISCONNECT_OK_20261031")) {
    console.log("PASS", task.status);
    process.exit(0);
  }
  if (done) {
    console.log("ENDED_WITHOUT_MARKER", task.status);
    process.exit(2);
  }
  await new Promise((resolve) => setTimeout(resolve, 8000));
}
console.log("TIMEOUT");
process.exit(3);

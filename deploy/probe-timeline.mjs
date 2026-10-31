import { readFileSync } from "node:fs";
import http from "node:http";

const cfg = JSON.parse(readFileSync("/etc/codex-web/config.json", "utf8"));
const threadId = "01a191b1-9ad7-7e81-a0af-917477a69461";

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
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const setCookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
          resolve({ status: res.statusCode, text: text.slice(0, 2000), cookie: setCookie });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const login = await request("POST", "/api/login", { password: cfg.password });
const cookie = login.cookie;
const timeline = await request("GET", `/api/threads/${threadId}/timeline`, null, cookie);
console.log("timeline", timeline.status, timeline.text);
const threads = await request("GET", "/api/projects/1/threads", null, cookie);
console.log("threads", threads.status, threads.text.slice(0, 1500));

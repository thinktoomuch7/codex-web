import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const lines = [];
const note = (line) => {
  lines.push(line);
  writeFileSync("/tmp/probe-stdio.log", `${lines.join("\n")}\n`);
};
note("started");
const child = spawn("codex", ["app-server"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    CODEX_HOME: "/var/lib/codex-web/codex-home",
    https_proxy: "http://127.0.0.1:7890",
    http_proxy: "http://127.0.0.1:7890",
  },
});
child.stdout.on("data", (chunk) => note(`OUT ${JSON.stringify(chunk.toString())}`));
child.stderr.on("data", (chunk) => note(`ERR ${chunk.toString()}`));
child.on("error", (error) => note(`SPAWN ${error.message}`));
child.on("exit", (code) => note(`EXIT ${code}`));
child.stdin.write(
  `${JSON.stringify({
    id: 1,
    method: "initialize",
    params: {
      clientInfo: { name: "codex-web", version: "0.1.0" },
      capabilities: {},
    },
  })}\n`,
);
setTimeout(() => {
  note("timeout");
  child.kill();
  process.exit(0);
}, 8000);

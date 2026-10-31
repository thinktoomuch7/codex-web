import { connect } from "node:net";

const socket = connect("/run/codex/app.sock");
socket.on("connect", () => {
  console.log("connected");
  socket.write(
    `${JSON.stringify({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "codex-web", version: "0.1.0" } },
    })}\n`,
  );
});
socket.on("data", (chunk) => {
  console.log("DATA", JSON.stringify(chunk.toString()));
});
socket.on("error", (error) => {
  console.log("ERR", error.message);
});
socket.on("close", () => {
  console.log("CLOSE");
});
setTimeout(() => process.exit(0), 2500);

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { timelineItemFromRaw } from "../src/codex/unix-engine.ts";

describe("时间线条目", () => {
  it("命令和输出分开，完成后不再只用输出盖住命令", () => {
    const item = timelineItemFromRaw(
      {
        id: "exec-1",
        type: "commandExecution",
        command: "/usr/bin/bash -lc 'sleep 75 && echo DISCONNECT_OK_20261031'",
        aggregatedOutput: "DISCONNECT_OK_20261031\n",
      },
      "fallback",
    );
    assert.equal(item.command, "/usr/bin/bash -lc 'sleep 75 && echo DISCONNECT_OK_20261031'");
    assert.equal(item.text, "DISCONNECT_OK_20261031");
  });

  it("还没有输出时保留命令本身", () => {
    const item = timelineItemFromRaw({ type: "commandExecution", command: "npm test" }, "fallback");
    assert.equal(item.command, "npm test");
    assert.equal(item.text, "");
  });

  it("普通消息仍读 text", () => {
    const item = timelineItemFromRaw({ type: "agentMessage", text: "我会只执行这一条命令。" }, "fallback");
    assert.equal(item.command, undefined);
    assert.equal(item.text, "我会只执行这一条命令。");
  });
});

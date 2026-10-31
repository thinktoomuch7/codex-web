import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { RpcClient, sendListThreads, type RpcTransport } from "../src/codex/rpc.ts";

class MemoryTransport implements RpcTransport {
  readonly sent: string[] = [];
  private readonly listeners = new Set<(line: string) => void>();

  send(line: string): void {
    this.sent.push(line);
  }

  onLine(listener: (line: string) => void): void {
    this.listeners.add(listener);
  }

  close(): void {}

  deliver(line: string): void {
    for (const listener of this.listeners) listener(line);
  }
}

describe("录制的 thread/list", () => {
  it("请求带上 appServer，响应里的新建会话能被读出", async () => {
    const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "thread-list.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      request: { method: string; params: { cwd: string; sourceKinds: string[] } };
      response: { id: number; result: { data: { id: string; name: string }[] } };
    };
    const transport = new MemoryTransport();
    const client = new RpcClient(transport);
    const pending = sendListThreads(client, fixture.request.params.cwd);
    const sent = JSON.parse(transport.sent[0]) as { id: number; method: string; params: unknown };
    assert.equal(sent.method, fixture.request.method);
    assert.deepEqual(sent.params, fixture.request.params);
    transport.deliver(JSON.stringify({ ...fixture.response, id: sent.id }));
    const result = (await pending) as { data: { id: string; name: string }[] };
    assert.equal(result.data[0]?.id, "thr_recorded");
    assert.equal(result.data[0]?.name, "录制会话");
  });
});

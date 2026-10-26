import { describe, expect, test } from "bun:test";
import type { NodeFrameScope, NodeFrameState } from "./nodeFrameProtocol";
import { createNodeFrameSession } from "./nodeFrameProtocol";
import { createNodeFrameFileOperations, type NodeFrameWorkspaceFiles } from "./nodeFrameFiles";

const scope: NodeFrameScope = {
  directory: "project-a",
  canvasId: "canvas-a",
  nodeId: "node-a",
  nodeType: "remote-imageGenerationNode",
  sessionId: "session-a",
};

function createHarness() {
  const writes: { path: string; content: string | Blob | ArrayBuffer; exclusive?: boolean }[] = [];
  const directories: string[] = [];
  const files = {
    mkdir: async (path: string) => { directories.push(path); },
    write: async (path: string, content: string | Blob | ArrayBuffer, exclusive?: boolean) => {
      writes.push({ path, content, exclusive });
    },
  } as NodeFrameWorkspaceFiles;
  const state: NodeFrameState = {
    scope,
    node: { id: scope.nodeId, type: scope.nodeType, data: {}, selected: false },
    inputs: {},
    config: {},
    appearance: { dark: false, fontSize: "16px", variables: {} },
  };
  let current: NodeFrameScope | undefined = scope;
  const operations = createNodeFrameFileOperations(state, () => current, files);
  return { operations, writes, directories, setScope(value: NodeFrameScope | undefined) { current = value; } };
}

describe("isolated node file bridge", () => {
  test("accepts a Blob upload and writes only inside the node directory", async () => {
    const harness = createHarness();
    const content = new Blob(["local sample"], { type: "image/png" });
    await harness.operations("files.mkdir", { path: "assets" }, new AbortController().signal);
    await harness.operations("files.write", {
      path: "assets/node-a/sample.png",
      content,
      exclusive: true,
    }, new AbortController().signal);

    expect(harness.directories).toEqual(["assets"]);
    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0]?.path).toBe("assets/node-a/sample.png");
    expect(harness.writes[0]?.content).toBe(content);
    expect(harness.writes[0]?.exclusive).toBe(true);
  });

  test("passes a selected Blob through the frame message channel into the node-owned file operation", async () => {
    const harness = createHarness();
    const channel = new MessageChannel();
    const session = createNodeFrameSession(
      channel.port1,
      scope,
      () => scope,
      harness.operations,
      message => { throw new Error(message); },
    );
    let id = 0;
    const request = (action: string, data: unknown) => new Promise<unknown>((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => reject(new Error("message channel response timed out")), 1000);
      channel.port2.onmessage = event => {
        const response = event.data as { type?: string; id?: number; data?: unknown; error?: string };
        if (response.type !== "response" || response.id !== requestId) return;
        clearTimeout(timer);
        response.error ? reject(new Error(response.error)) : resolve(response.data);
      };
      channel.port2.postMessage({ type: "request", id: requestId, action, data });
    });
    channel.port2.start();
    const bytes = new Uint8Array(1_000_001).fill(37);
    bytes[0] = 19;
    bytes[bytes.length - 1] = 83;
    const content = new Blob([bytes], { type: "image/png" });

    try {
      await request("files.write", { path: "assets/node-a/picked.png", content, exclusive: true });
      expect(harness.writes).toHaveLength(1);
      expect(harness.writes[0]?.path).toBe("assets/node-a/picked.png");
      expect(harness.writes[0]?.exclusive).toBe(true);
      expect(harness.writes[0]?.content).toBeInstanceOf(Blob);
      const received = harness.writes[0]?.content as Blob;
      expect(received.size).toBe(bytes.byteLength);
      expect(await crypto.subtle.digest("SHA-256", await received.arrayBuffer()))
        .toEqual(await crypto.subtle.digest("SHA-256", bytes));
    } finally {
      session.close();
      channel.port2.close();
    }
  });

  test("rejects writes to another node's directory", async () => {
    const harness = createHarness();

    await expect(harness.operations("files.write", {
      path: "assets/node-b/sample.png",
      content: new Blob(["local sample"]),
    }, new AbortController().signal)).rejects.toThrow("节点文件操作超出自身目录");
    expect(harness.writes).toHaveLength(0);
  });

  test("rejects writes larger than the bridge's 100 MB limit", async () => {
    const harness = createHarness();
    const content = new Blob(["sample"]);
    Object.defineProperty(content, "size", { value: 100 * 1024 * 1024 + 1 });

    await expect(harness.operations("files.write", {
      path: "assets/node-a/oversized.bin",
      content,
    }, new AbortController().signal)).rejects.toThrow("节点媒体文件超过 100 MB");
    expect(harness.writes).toHaveLength(0);
  });

  test("rejects a pending upload after its project or canvas scope changes", async () => {
    const harness = createHarness();
    harness.setScope({ ...scope, directory: "project-b" });

    await expect(harness.operations("files.write", {
      path: "assets/node-a/sample.png",
      content: new Blob(["local sample"]),
    }, new AbortController().signal)).rejects.toThrow("节点所属项目或画布已切换");
    expect(harness.writes).toHaveLength(0);
  });
});

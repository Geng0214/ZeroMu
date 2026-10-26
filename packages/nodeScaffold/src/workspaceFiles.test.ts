import { describe, expect, test } from "bun:test";
import { uploadNodeFile } from "./workspaceFiles";

describe("node media upload helper", () => {
  test("stores the chosen file under a unique node-owned path", async () => {
    const directories: string[] = [];
    const writes: { path: string; content: string | Blob | ArrayBuffer; exclusive?: boolean }[] = [];
    const files = {
      mkdir: async (path: string) => { directories.push(path); },
      write: async (path: string, content: string | Blob | ArrayBuffer, exclusive?: boolean) => {
        writes.push({ path, content, exclusive });
      },
    } as unknown as Parameters<typeof uploadNodeFile>[0];
    const file = new File(["selected image data"], "Sample.PNG", { type: "image/png" });

    const path = await uploadNodeFile(files, "node-a", file);

    expect(directories).toEqual(["assets", "assets/node-a"]);
    expect(path).toMatch(/^assets\/node-a\/[0-9a-f-]{36}\.png$/);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(path);
    expect(writes[0]?.content).toBe(file);
    expect(writes[0]?.exclusive).toBe(true);
    expect(await (writes[0]?.content as Blob).text()).toBe("selected image data");
  });
});

import { createHash } from "node:crypto";
import { createConnection, createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { dlopen } from "bun:ffi";

export async function claimWindowsInstance(dataDirectory: string, activate: () => void) {
  const key = createHash("sha256").update(resolve(dataDirectory).toLowerCase()).digest("hex");
  const pipe = `\\\\.\\pipe\\zeromu-${key}`;
  // ACT: Windows 命名管道的绑定互斥，进程退出时由系统释放，不留下需清理的磁盘锁。
  for (let attempt = 0; attempt < 3; attempt++) {
    const server = createServer(socket => {
      socket.on("error", () => {});
      socket.setTimeout(2000, () => { socket.destroy(); });
      socket.write(`${process.pid}\n`);
      let request = "";
      socket.on("data", chunk => {
        request += chunk.toString();
        if (request === "activate\n") {
          socket.removeAllListeners("data");
          try {
            activate();
            socket.end("activated");
          } catch (error) {
            console.error("唤起已有窗口失败：", error);
            socket.destroy();
          }
        } else if (request.length >= 9) socket.destroy();
      });
    });
    try {
      await new Promise<void>((ready, reject) => {
        server.once("error", reject);
        server.listen(pipe, () => {
          server.off("error", reject);
          ready();
        });
      });
      server.on("error", error => { console.error("桌面单实例通道异常：", error); });
      return { close() { server.close(); } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
    try {
      await new Promise<void>((ready, reject) => {
        const socket = createConnection(pipe);
        let response = "";
        let receivedOwner = false;
        socket.setTimeout(2000, () => { socket.destroy(new Error("唤起已有窗口超时")); });
        socket.on("error", reject);
        socket.on("data", chunk => {
          response += chunk.toString();
          if (response.length > 32) {
            socket.destroy(new Error("桌面单实例响应无效"));
            return;
          }
          if (!receivedOwner && response.includes("\n")) {
            const [owner, ...rest] = response.split("\n");
            if (!owner || !/^[1-9]\d{0,9}$/.test(owner) || Number(owner) >= 0xffffffff) {
              socket.destroy(new Error("桌面单实例进程无效"));
              return;
            }
            receivedOwner = true;
            response = rest.join("\n");
            // 用户点开的新进程将前台激活许可交给原进程，避免只在任务栏闪烁。
            try {
              const user32 = dlopen("user32.dll", { AllowSetForegroundWindow: { args: ["u32"], returns: "i32" } });
              try { user32.symbols.AllowSetForegroundWindow(Number(owner)); }
              finally { user32.close(); }
              socket.write("activate\n");
            } catch (error) {
              socket.destroy(error instanceof Error ? error : new Error(String(error)));
            }
          }
        });
        socket.on("end", () => {
          socket.end();
          if (response === "activated") ready();
          else reject(new Error("已有窗口未确认唤起"));
        });
      });
      return undefined;
    } catch (error) {
      // 原实例恰好退出时重试绑定；通知失败也不绕过互斥创建第二个窗口。
      if (attempt === 2) throw error;
      await setTimeout(100);
    }
  }
}

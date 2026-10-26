import { join } from "node:path";
import { Worker } from "node:worker_threads";

export async function showNativeSplash(assetDir: string, onClose: () => void) {
  if (process.platform === "win32" && process.arch === "x64") {
    // ACT: Win32 窗口与消息循环都归 Worker 所有，主线程加载服务/WebView2 时动画仍能响应。
    const worker = new Worker(join(assetDir, "windowsSplashWorker.js"), { workerData: assetDir });
    const ready = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    let isReady = false;
    let isClosed = false;
    let isFinishing = false;
    let closeTimeout: ReturnType<typeof setTimeout> | undefined;

    function close() {
      if (isClosed) return;
      isClosed = true;
      worker.postMessage("close");
      finished.resolve();
      // ACT: 优先让线程释放原生窗口；线程失去响应时也不能留下置顶的启动画面。
      closeTimeout = setTimeout(() => {
        void worker.terminate().catch(error => console.error("释放启动动画线程失败：", error));
      }, 1000);
      closeTimeout.unref();
    }

    worker.on("message", (message: "ready" | "finished" | "cancelled") => {
      if (message === "ready") {
        isReady = true;
        ready.resolve();
      } else if (message === "finished") {
        finished.resolve();
      } else if (!isClosed) {
        close();
        onClose();
      }
    });
    worker.on("error", (error) => {
      ready.reject(error);
      // ACT: 动画故障结束等待并继续启动，只有 cancelled 消息表示用户退出。
      if (isReady && !isClosed) {
        console.error("原生启动动画失败：", error);
        close();
      }
    });
    worker.on("exit", (code) => {
      clearTimeout(closeTimeout);
      ready.reject(new Error(`启动动画线程提前退出：${code}`));
      finished.resolve();
      isClosed = true;
    });
    const readyTimeout = setTimeout(() => {
      close();
      ready.reject(new Error("启动动画线程就绪超时，继续打开主窗口"));
      void worker.terminate().catch(error => console.error("释放启动动画线程失败：", error));
    }, 5000);
    try {
      await ready.promise;
    } finally {
      clearTimeout(readyTimeout);
    }
    return {
      finish() {
        if (!isClosed && !isFinishing) {
          isFinishing = true;
          worker.postMessage("finish");
        }
        return finished.promise;
      },
      close,
    };
  }
  if (process.platform === "darwin" && (process.arch === "x64" || process.arch === "arm64")) {
    const { showMacSplash } = await import("./macSplash");
    return showMacSplash(assetDir, onClose);
  }
  throw new Error(`当前平台不支持原生启动画面：${process.platform}/${process.arch}`);
}

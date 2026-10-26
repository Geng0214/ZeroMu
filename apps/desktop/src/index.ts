import { setLocaleFallback, t, translateMessage } from "@toonflow/server/i18n";
import { detectLocale, normalizeLocale } from "@toonflow/i18n";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { existsSync, writeAtomicSync } from "@toonflow/file";
import { file } from "@toonflow/file/bun";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { dlopen, ptr } from "bun:ffi";
import type { DesktopRuntime, PluginInstallRequest } from "@toonflow/server/desktop";
import { showNativeSplash } from "@toonflow/startup";
import Electrobun, { ApplicationMenu, BrowserWindow, PATHS, Screen, Utils, Updater } from "electrobun/main";
import { parseInstallUrl } from "./protocol";
import { claimWindowsInstance } from "./windowsInstance";
import saveFile, { selectSaveFile } from "./saveFile";
import createWindowsUpdater, { confirmWindowsUpdateStartup, waitForWindowsUpdateCommit } from "./update/windowsUpdater";

const execFileAsync = promisify(execFile);
const pendingInstalls: PluginInstallRequest[] = [];
let deliverInstall: ((request: PluginInstallRequest) => void) | undefined;
function openUrl(url: string) {
  const request = parseInstallUrl(url);
  if (deliverInstall) deliverInstall(request);
  else if (!pendingInstalls.some(item => item.type === request.type && item.url === request.url)) {
    if (pendingInstalls.length >= 20) throw new Error(t`待确认的安装请求过多，请稍后重试`);
    pendingInstalls.push(request);
  }
}
// 冷启动的 macOS URL 可能先于窗口就绪到达，先接收再等待页面挂载。
Electrobun.events.on("open-url", event => {
  try { openUrl(event.data.url); }
  catch (error) {
    void Utils.showMessageBox({ type: "error", title: t`安装链接无效`, message: translateMessage(error instanceof Error ? error.message : "无法打开安装链接") });
  }
});

async function restoreInstallRegistration(installDirectory: string) {
  const uninstaller = resolve(installDirectory, "UninstallNSIS.exe");
  if (process.platform === "win32" && existsSync(uninstaller)) {
    try {
      // SDK 启动和更新会重写卸载入口；安装了 NSIS 时统一交给它处理数据保留选项。
      const { identifier, channel, version } = await file(resolve(PATHS.RESOURCES_FOLDER, "version.json")).json();
      if (identifier !== "local.zeromu.desktop" || !["stable", "canary"].includes(channel) || typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error("桌面安装标识无效，未修改安装登记");
      }
      const windowsDirectory = process.env.SystemRoot ?? process.env.windir ?? process.env.WINDIR;
      if (!windowsDirectory) throw new Error("无法定位 Windows 注册表工具，未修改安装登记");
      const registryExecutable = resolve(windowsDirectory, "System32/reg.exe");
      const registryKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${identifier}.${channel}`;
      const { stdout } = await execFileAsync(registryExecutable, ["query", registryKey, "/v", "toonflowInstallDirectory"], { windowsHide: true });
      const registeredDirectory = /^\s*toonflowInstallDirectory\s+REG_SZ\s+(.+)$/im.exec(stdout)?.[1]?.trim();
      // ACT: SDK 会重写应用登记；只恢复本安装拥有的记录，其他安装的登记保持不动。
      if (!registeredDirectory || resolve(registeredDirectory).toLowerCase() !== resolve(installDirectory).toLowerCase()) return;
      for (const [name, command] of [["DisplayVersion", version], ["InstallLocation", installDirectory], ["UninstallString", `"${uninstaller}"`], ["QuietUninstallString", `"${uninstaller}" /S`]]) {
        await execFileAsync(registryExecutable, ["add", registryKey, "/v", name, "/t", "REG_SZ", "/d", command, "/f"], { windowsHide: true });
      }
      const protocolLauncher = resolve(PATHS.RESOURCES_FOLDER, "app/protocolLauncher.exe");
      if (existsSync(protocolLauncher)) {
        const protocolKey = "HKCU\\Software\\Classes\\zeromu";
        const commandKey = `${protocolKey}\\shell\\open\\command`;
        const command = `"${protocolLauncher}" "%1"`;
        let protocolExists = true;
        try {
          await execFileAsync(registryExecutable, ["query", protocolKey], { windowsHide: true });
        } catch (error) {
          if ((error as { code?: number }).code !== 1) throw error;
          protocolExists = false;
        }
        // ACT: 自动更新不经过 NSIS；仅补全缺失协议，已有注册（包括其他安装）保持不动。
        if (!protocolExists) {
          for (const [key, value] of [[protocolKey, "URL:ZEROMU Protocol"], [`${protocolKey}\\DefaultIcon`, `"${resolve(PATHS.RESOURCES_FOLDER, "app.ico")}",0`], [commandKey, command]]) {
            await execFileAsync(registryExecutable, ["add", key, "/ve", "/t", "REG_SZ", "/d", value, "/f"], { windowsHide: true });
          }
          await execFileAsync(registryExecutable, ["add", protocolKey, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"], { windowsHide: true });
        }
      }
    } catch (error) {
      console.error("恢复桌面安装注册信息失败：", error);
    }
  }
}

async function start() {
  let splash: Awaited<ReturnType<typeof showNativeSplash>> | undefined;
  let isClosing = false;
  let activationPending = false;
  let activateWindow: (() => void) | undefined;

  try {
    // Windows 的 data 与 app 同级；macOS 的 data 与 .app 同级，避免随程序更新被替换。
    const installDirectory = resolve(PATHS.RESOURCES_FOLDER, process.platform === "darwin" ? "../../.." : "../..");
    const dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(installDirectory, "data");
    if (process.platform === "win32") {
      const instance = await claimWindowsInstance(dataDirectory, () => {
        activationPending = true;
        activateWindow?.();
      });
      if (!instance) {
        Utils.quit();
        return;
      }
      process.once("exit", () => instance.close());
    }
    // ACT: 先显示原生动画，再加载服务，避免初始化期间没有反馈。
    const startupSettings = await file(resolve(dataDirectory, "settings.json")).json().catch((error) => {
      if (error.code !== "ENOENT") console.error("读取启动设置失败，使用默认启动动画：", error);
      return null;
    });
    setLocaleFallback(() => normalizeLocale(startupSettings?.settings?.ui?.language)
      ?? detectLocale([Intl.DateTimeFormat().resolvedOptions().locale]));
    if (process.platform === "darwin") {
      // ACT: WKWebView 的 Command 编辑快捷键由原生菜单角色交给当前响应者处理。
      ApplicationMenu.setApplicationMenu([
        { label: "零幕", submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "showAll" },
          { type: "separator" },
          { role: "quit" },
        ] },
        { label: t`编辑`, submenu: [
          { role: "undo", label: t`撤销` },
          { role: "redo", label: t`重做` },
          { type: "separator" },
          { role: "cut", label: t`剪切` },
          { role: "copy", label: t`复制` },
          { role: "paste", label: t`粘贴` },
          { role: "selectAll", label: t`全选` },
        ] },
      ]);
    }
    try {
      if (startupSettings?.settings?.ui?.startupAnimation !== false) {
        splash = await showNativeSplash(resolve(PATHS.VIEWS_FOLDER, "../startup"), () => {
          isClosing = true;
          splash = undefined;
          Utils.quit();
        });
      }
    } catch (error) {
      console.error("原生启动画面创建失败：", error);
    }
    if (isClosing) {
      splash?.close();
      return;
    }
    process.env.toonflowDesktop = "1";
    const { createApp } = await import("@toonflow/server/app");
    const { hash } = await file(resolve(PATHS.RESOURCES_FOLDER, "version.json")).json();
    if (typeof hash !== "string" || !hash) throw new Error(t`应用构建标识缺失，无法同步内置插件`);
    const app = await createApp({
      webRoot: resolve(PATHS.VIEWS_FOLDER, "mainview"),
      dataDirectory,
      toolsRoot: resolve(PATHS.VIEWS_FOLDER, "../tools"),
      toolConfigWorkerPath: resolve(PATHS.VIEWS_FOLDER, "../toolConfigWorker.js"),
      nodesRoot: resolve(PATHS.VIEWS_FOLDER, "../nodes"),
      skillsRoot: resolve(PATHS.VIEWS_FOLDER, "../skills"),
      // ACT: 暂不安装内置团队，随团队打包一同恢复。
      // agentsRoot: resolve(PATHS.VIEWS_FOLDER, "../agents"),
      pluginRevision: hash,
    });
    const server = app.listen(0, "127.0.0.1");

    await once(server, "listening");
    if (isClosing) return;
    const address = server.address() as AddressInfo;
    const { initializeMcpRuntime } = await import("@toonflow/server/mcp");
    await initializeMcpRuntime(app, `http://127.0.0.1:${address.port}`, resolve(PATHS.VIEWS_FOLDER, "../mcp/stdio.js"));
    console.log(`桌面服务：http://127.0.0.1:${address.port}`);

    const { workArea } = Screen.getPrimaryDisplay();
    // ACT: 宽高分别限制在屏幕可用区域内，预留标题栏和边距，不固定比例。
    const width = Math.min(1280, workArea.width - 64);
    const height = Math.min(960, workArea.height - 64);
    const mainUrl = `http://127.0.0.1:${address.port}/?desktop=1`;
    const mainWindow = new BrowserWindow({
      title: "零幕 · ZEROMU",
      url: mainUrl,
      // 页面原生能力通过受限本机接口提供，关闭页面直接调用宿主 RPC 的入口。
      sandbox: true,
      // Windows SDK 在子页面也保留通道引用；子页面不需要原生事件入口。
      preload: process.platform === "win32" ? `
        const disabledBridges = ["__electrobunInternalBridge", "__electrobunHostBridge", "__electrobunBunBridge"];
        if (window !== window.top) disabledBridges.push("__electrobunEventBridge");
        for (const name of disabledBridges) {
          const bridge = window[name];
          window[name] = undefined;
          if (bridge) Promise.resolve(bridge).catch(error => {
            const message = String(error?.parameters?.error ?? error?.message ?? error).toLowerCase();
            if (!message.includes("0x80070490")) console.error("已禁用的原生通道清理失败", error);
          });
        }
      ` : null,
      hidden: Boolean(splash),
      frame: {
        width,
        height,
        x: workArea.x + Math.round((workArea.width - width) / 2),
        y: workArea.y + Math.round((workArea.height - height) / 2),
      },
    });
    // ACT: 两版 SDK 的全局事件不带 WebView ID，使用事件名后缀限定主窗口。
    Electrobun.events.on(`new-window-open-${mainWindow.webview.id}`, (event: { data: { detail: unknown } }) => {
      const detail = event.data.detail;
      const url = typeof detail === "string" ? detail : detail && typeof detail === "object" && "url" in detail ? detail.url : undefined;
      if (typeof url !== "string" || !URL.canParse(url)) return;
      const target = new URL(url);
      if (target.protocol !== "http:" && target.protocol !== "https:") return;
      if (!Utils.openExternal(target.href)) {
        void Utils.showMessageBox({ type: "error", title: t`打开链接失败`, message: t`请检查默认浏览器设置后重试。` });
      }
    });
    // 页面重载时监听器随旧页面销毁，安装请求等新页面 ready 后再投递。
    Electrobun.events.on(`will-navigate-${mainWindow.webview.id}`, () => { deliverInstall = undefined; });
    let isShowing = false;
    let pageReady = false;
    let navigationTimer: ReturnType<typeof setTimeout> | undefined;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let showingWindow: Promise<void> | undefined;
    let registration: Promise<void> | undefined;
    function clearStartupTimers() {
      clearTimeout(navigationTimer);
      clearTimeout(startupTimer);
    }
    function showMainWindow() {
      return showingWindow ??= (async () => {
        const startupSplash = splash;
        if (startupSplash) {
          let finishTimer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              startupSplash.finish(),
              new Promise<void>(resolve => { finishTimer = setTimeout(() => { console.error("启动动画退场超时，继续显示主窗口"); resolve(); }, 1500); }),
            ]);
          } catch (error) {
            console.error("结束启动动画失败，继续显示主窗口：", error);
          } finally {
            clearTimeout(finishTimer);
            try { startupSplash.close(); } catch (error) { console.error("关闭启动动画失败：", error); }
            splash = undefined;
          }
        }
        if (isClosing) return;
        mainWindow.show();
        isShowing = true;
        if (activationPending) activateWindow?.();
      })();
    }
    function guardStartup() {
      clearStartupTimers();
      // ACT: WebView2 初次导航偶发失败时，使用已创建的同一个窗口重载一次。
      navigationTimer = setTimeout(() => {
        if (isClosing || pageReady) return;
        console.error("尚未收到主界面就绪通知，重试加载首页");
        try { mainWindow.webview.loadURL(mainUrl); }
        catch (error) { console.error("重新加载首页失败：", error); }
      }, 5000);
      startupTimer = setTimeout(() => {
        if (isClosing || pageReady) return;
        console.error("主界面启动超时，停止等待启动动画");
        void (async () => {
          await showMainWindow();
          if (isClosing || pageReady) return;
          const { response } = await Utils.showMessageBox({
            type: "error", title: t`启动超时`, message: t`主界面未能完成加载。请重试；如果仍然失败，请退出后重新打开零幕。`,
            buttons: [t`重新加载`, t`退出`], defaultId: 0, cancelId: 1,
          });
          if (isClosing || pageReady) return;
          if (response === 0) {
            guardStartup();
            mainWindow.webview.loadURL(mainUrl);
          } else {
            isClosing = true;
            clearStartupTimers();
            Utils.quit(1);
          }
        })().catch(error => { console.error("启动恢复失败：", error); Utils.quit(1); });
      }, 20000);
    }
    activateWindow = () => {
      if (isClosing || !isShowing) return;
      activationPending = false;
      mainWindow.unminimize();
      mainWindow.show();
      mainWindow.activate();
    };
    let finishStartup: Promise<void> | undefined;
    app.locals.desktop = {
      openUrl,
      readClipboardText: Utils.clipboardReadText,
      writeClipboardText: Utils.clipboardWriteText,
      selectSaveFile: fileName => selectSaveFile(fileName, mainWindow.ptr),
      saveFile,
      async selectProviderFile() {
        const [path] = await Utils.openFileDialog({ allowedFileTypes: "ts", canChooseFiles: true, canChooseDirectory: false, allowsMultipleSelection: false });
        return path ?? null;
      },
      async selectDirectory() {
        const [path] = await Utils.openFileDialog({ canChooseFiles: false, canChooseDirectory: true, allowsMultipleSelection: false });
        return path ?? null;
      },
      async ready(failed = false) {
        if (isClosing) return;
        pageReady = true;
        clearStartupTimers();
        await showMainWindow();
        if (isClosing) return;
        // ACT: 窗口已展示；登记恢复结束后才确认更新交接，避免助手退出时仍有登记任务在途。
        await (registration ??= restoreInstallRegistration(installDirectory));
        if (failed) {
          if (process.platform === "win32") confirmWindowsUpdateStartup(PATHS.RESOURCES_FOLDER, true);
          else await (Updater as DesktopRuntime["updater"]).confirmStartup?.(true);
          deliverInstall = undefined;
          return;
        }
        deliverInstall = request => {
          mainWindow.unminimize();
          mainWindow.show();
          mainWindow.activate();
          mainWindow.webview.executeJavascript(`window.dispatchEvent(new CustomEvent("toonflow:install-plugin", { detail: ${JSON.stringify(request)} }));`);
        };
        while (pendingInstalls.length) {
          deliverInstall(pendingInstalls[0]!);
          pendingInstalls.shift();
        }
        finishStartup ??= (async () => {
          if (process.platform === "win32") {
            const confirmation = confirmWindowsUpdateStartup(PATHS.RESOURCES_FOLDER);
            if (confirmation) await waitForWindowsUpdateCommit(PATHS.RESOURCES_FOLDER, confirmation);
          } else await (Updater as DesktopRuntime["updater"]).confirmStartup?.();
          // 自动回退尚未结束时不改旧技能；正常安装在首个成功界面就绪后迁移。
          if (!isClosing) await (await import("@toonflow/server/skills")).migrateBundledSkills(resolve(PATHS.VIEWS_FOLDER, "../skills"));
        })();
        await finishStartup;
      },
      openDevTools() { mainWindow.webview.openDevTools(); },
      // ACT: Windows 使用两阶段退出；Intel Mac 由兼容入口适配 1.18.1 更新器。
      updater: process.platform === "win32" ? createWindowsUpdater(PATHS.RESOURCES_FOLDER, Utils as unknown as Parameters<typeof createWindowsUpdater>[1]) : Updater,
    } satisfies DesktopRuntime;
    if (process.platform === "win32") {
      // ACT: Electrobun 2.0.1 未设置 Windows 窗口图标，复用构建产物中的应用 ICO。
      const user32 = dlopen("user32.dll", {
        LoadImageW: { args: ["ptr", "ptr", "u32", "i32", "i32", "u32"], returns: "ptr" },
        SendMessageW: { args: ["ptr", "u32", "u64", "ptr"], returns: "ptr" },
        GetDpiForWindow: { args: ["ptr"], returns: "u32" },
        GetSystemMetricsForDpi: { args: ["i32", "u32"], returns: "i32" },
        DestroyIcon: { args: ["ptr"], returns: "i32" },
      });
      const native = user32.symbols;
      const window = mainWindow.ptr;
      const dpi = native.GetDpiForWindow(window);
      const iconPath = Buffer.from(`${resolve(PATHS.RESOURCES_FOLDER, "app.ico")}\0`, "utf16le");
      // ICON_SMALL / ICON_BIG，各自使用当前窗口 DPI 对应的系统尺寸。
      const icons = [49, 11].map((metric) => native.LoadImageW(
        null, ptr(iconPath), 1, native.GetSystemMetricsForDpi(metric, dpi), native.GetSystemMetricsForDpi(metric + 1, dpi), 0x10,
      ));
      const closeIcons = () => {
        for (const icon of icons) if (icon) native.DestroyIcon(icon);
        user32.close();
      };
      if (icons.some((icon) => !icon)) {
        closeIcons();
        throw new Error(t`无法加载主窗口图标`);
      }
      icons.forEach((icon, type) => native.SendMessageW(window, 0x80, type, icon));
      mainWindow.on("close", closeIcons);
    }
    mainWindow.on("close", () => {
      isClosing = true;
      clearStartupTimers();
      deliverInstall = undefined;
      pendingInstalls.length = 0;
      splash?.close();
      splash = undefined;
    });
    guardStartup();
    if (process.platform === "win32") {
      // ACT: 运行信息随应用目录清理；启动器通过 PID 忽略已退出进程留下的端口。
      writeAtomicSync(resolve(PATHS.RESOURCES_FOLDER, "desktopRuntime.json"), JSON.stringify({ pid: process.pid, port: address.port }));
    }
  } catch (error) {
    splash?.close();
    console.error("桌面启动失败：", error);
    if (process.platform === "win32") {
      try { confirmWindowsUpdateStartup(PATHS.RESOURCES_FOLDER, true); }
      catch (resultError) { console.error("更新启动结果写入失败：", resultError); }
    }
    Utils.quit(1);
  }
}

void start();

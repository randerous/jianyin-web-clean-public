import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

let server;
let mainWindow;

function closeServer() {
  if (!server) return;
  server.close();
  server = undefined;
}

async function startBackend() {
  process.env.JIANYIN_STATE_PATH = join(app.getPath("userData"), "state.json");
  const { createApp } = await import("./server.mjs");
  const expressApp = await createApp();
  server = expressApp.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法获取本地服务端口");
  return `http://127.0.0.1:${address.port}/`;
}

async function createWindow() {
  const appUrl = await startBackend();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    icon: join(app.getAppPath(), "public", "assets", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appUrl)) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  if (process.env.JIANYIN_ELECTRON_SMOKE === "1") {
    mainWindow.webContents.once("did-finish-load", () => app.quit());
  }
  await mainWindow.loadURL(appUrl);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(createWindow).catch((error) => {
    console.error(error);
    app.exit(1);
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", closeServer);
}

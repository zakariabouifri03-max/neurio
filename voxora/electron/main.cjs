const {
  app,
  BrowserWindow,
  protocol,
  net,
  ipcMain,
  safeStorage,
  Notification,
  desktopCapturer,
  session,
  dialog,
  shell,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "voxora",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
if (process.argv.includes("--disable-gpu")) app.disableHardwareAcceleration();
if (!app.requestSingleInstanceLock()) app.quit();
let win;
let selectedCapture = null;
let trustedOrigin = "";
const log = async (message) => {
  try {
    await fs.appendFile(
      path.join(app.getPath("userData"), "desktop.log"),
      `${new Date().toISOString()} ${message}\n`,
    );
  } catch {}
};
function trusted(event) {
  if (!event.senderFrame || event.senderFrame !== win?.webContents.mainFrame)
    throw new Error("Invalid IPC sender");
  const url = event.senderFrame.url;
  if (
    !(app.isPackaged
      ? url.startsWith("voxora://app/")
      : new URL(url).origin === trustedOrigin)
  )
    throw new Error("Invalid origin");
}
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.whenReady().then(async () => {
  const root = path.join(__dirname, "../dist/client");
  let config = { apiUrl: "", mediaUrl: "" };
  try {
    config = JSON.parse(
      await fs.readFile(path.join(root, "desktop-config.json"), "utf8"),
    );
  } catch {}
  if (app.isPackaged && !config.apiUrl.startsWith("https://")) {
    dialog.showErrorBox(
      "Voxora configuration required",
      "This desktop build needs a public HTTPS VITE_API_URL. Contact the distributor.",
    );
    app.quit();
    return;
  }
  const connect = [
    config.apiUrl,
    config.apiUrl.replace(/^http/, "ws"),
    config.mediaUrl,
  ]
    .filter(Boolean)
    .map((s) => new URL(s).origin)
    .join(" ");
  protocol.handle("voxora", async (request) => {
    const u = new URL(request.url);
    if (u.host !== "app") return new Response("Not found", { status: 404 });
    let name;
    try {
      name = decodeURIComponent(u.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const file = path.resolve(
      root,
      "." + (name === "/" ? "/index.html" : name),
    );
    if (!file.startsWith(root + path.sep))
      return new Response("Forbidden", { status: 403 });
    try {
      const r = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(r.headers);
      headers.set(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ${connect}; object-src 'none'; base-uri 'none'; frame-src 'none'`,
      );
      return new Response(r.body, { status: r.status, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  const devUrl = process.env.VOXORA_DEV_URL || "http://localhost:5173";
  trustedOrigin = app.isPackaged ? "voxora://app" : new URL(devUrl).origin;
  win = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 780,
    minHeight: 600,
    title: "Voxora",
    backgroundColor: "#17191f",
    icon: path.join(__dirname, "../assets/icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  win.removeMenu();
  const owns = (webContents) => webContents === win?.webContents;
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission, origin) =>
      owns(wc) &&
      ["media", "display-capture", "notifications"].includes(permission) &&
      (app.isPackaged
        ? origin.startsWith("voxora://app")
        : origin === trustedOrigin),
  );
  session.defaultSession.setPermissionRequestHandler(
    async (wc, permission, callback) => {
      if (
        !owns(wc) ||
        !["media", "display-capture", "notifications"].includes(permission)
      ) {
        callback(false);
        return;
      }
      const result = await dialog.showMessageBox(win, {
        type: "question",
        title: "Voxora permission",
        message: `Allow ${permission === "media" ? "microphone and camera" : permission === "display-capture" ? "screen sharing" : "desktop notifications"}?`,
        buttons: ["Cancel", "Allow"],
        defaultId: 0,
        cancelId: 0,
      });
      callback(result.response === 1);
    },
  );
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        if (!selectedCapture) {
          callback({});
          return;
        }
        const id = selectedCapture;
        selectedCapture = null;
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
        });
        const source = sources.find((s) => s.id === id);
        callback(
          source
            ? {
                video: source,
                ...(process.platform === "win32" &&
                source.id.startsWith("screen:")
                  ? { audio: "loopback" }
                  : {}),
              }
            : {},
        );
      } catch {
        callback({});
      }
    },
  );
  const vault = path.join(app.getPath("userData"), "session.bin");
  ipcMain.handle("vault:read", async (event) => {
    trusted(event);
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(await fs.readFile(vault));
    } catch {
      return null;
    }
  });
  ipcMain.handle("vault:write", async (event, token) => {
    trusted(event);
    if (token === null) {
      await fs.rm(vault, { force: true });
      return;
    }
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      throw new Error("Invalid session");
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("OS credential encryption unavailable");
    await fs.writeFile(vault, safeStorage.encryptString(token));
  });
  ipcMain.handle("capture:list", async (event) => {
    trusted(event);
    return (
      await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 320, height: 180 },
      })
    ).map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));
  });
  ipcMain.handle("capture:select", async (event, id) => {
    trusted(event);
    if (typeof id !== "string" || id.length > 200)
      throw new Error("Invalid source");
    selectedCapture = id;
  });
  ipcMain.on("notify", (event, title, body) => {
    trusted(event);
    if (
      typeof title === "string" &&
      typeof body === "string" &&
      Notification.isSupported()
    )
      new Notification({
        title: title.slice(0, 80),
        body: body.slice(0, 180),
        icon: path.join(__dirname, "../assets/icon.png"),
      }).show();
  });
  ipcMain.on("badge", (event, n) => {
    trusted(event);
    if (Number.isInteger(n) && n >= 0 && n < 100000) app.setBadgeCount(n);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (["https:", "http:"].includes(new URL(url).protocol))
        void shell.openExternal(url);
    } catch {}
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (
      app.isPackaged
        ? !url.startsWith("voxora://app/")
        : new URL(url).origin !== trustedOrigin
    )
      event.preventDefault();
  });
  win.webContents.on(
    "render-process-gone",
    () => void log("Renderer exited unexpectedly"),
  );
  await win.loadURL(app.isPackaged ? "voxora://app/index.html" : devUrl);
  await log("Application started");
});
app.on("window-all-closed", () => app.quit());
process.on("uncaughtException", (error) => {
  void log(`Uncaught desktop error: ${error.name}`);
  dialog.showErrorBox(
    "Voxora encountered an error",
    "Restart the application. Diagnostic logs are in your application data folder.",
  );
});

"use strict";

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const isDev = !app.isPackaged;
let mainWindow = null;

function userDataFile(name) {
  const dir = path.join(app.getPath("userData"), "animai");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0e1116",
    title: "ANIMAI STUDIO",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.once("ready-to-show", () => mainWindow.show());

  const devUrl = process.env.ANIMA_DEV_URL || "http://localhost:5173";
  if (isDev) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle("animai:isDesktop", () => true);

ipcMain.handle("animai:userDataPath", () => path.join(app.getPath("userData"), "animai"));

ipcMain.handle("animai:saveDialog", async (_e, opts) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: opts?.title || "Save",
    defaultPath: opts?.defaultPath,
    filters: opts?.filters || [{ name: "All Files", extensions: ["*"] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle("animai:openDialog", async (_e, opts) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: opts?.title || "Open",
    properties: opts?.properties || ["openFile"],
    filters: opts?.filters || [{ name: "All Files", extensions: ["*"] }],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("animai:writeFile", async (_e, filePath, data, encoding) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (encoding === "base64") {
    fs.writeFileSync(filePath, Buffer.from(data, "base64"));
  } else if (encoding === "binary") {
    fs.writeFileSync(filePath, Buffer.from(data));
  } else {
    fs.writeFileSync(filePath, data, "utf8");
  }
  return true;
});

ipcMain.handle("animai:readFile", async (_e, filePath, encoding) => {
  if (!fs.existsSync(filePath)) return null;
  if (encoding === "base64") return fs.readFileSync(filePath).toString("base64");
  if (encoding === "binary") return Array.from(fs.readFileSync(filePath));
  return fs.readFileSync(filePath, "utf8");
});

ipcMain.handle("animai:writeAutosave", async (_e, dataBase64) => {
  const p = userDataFile("autosave.animai");
  fs.writeFileSync(p, Buffer.from(dataBase64, "base64"));
  fs.writeFileSync(
    userDataFile("autosave.meta.json"),
    JSON.stringify({ savedAt: Date.now(), path: p, host: os.hostname() }, null, 2)
  );
  return p;
});

ipcMain.handle("animai:readAutosave", async () => {
  const p = userDataFile("autosave.animai");
  const metaPath = userDataFile("autosave.meta.json");
  if (!fs.existsSync(p)) return null;
  return {
    path: p,
    meta: fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : null,
    dataBase64: fs.readFileSync(p).toString("base64"),
  };
});

ipcMain.handle("animai:appendLog", async (_e, line) => {
  const p = userDataFile("animai.log");
  fs.appendFileSync(p, line + "\n");
  return true;
});

ipcMain.handle("animai:openPath", async (_e, p) => {
  shell.showItemInFolder(p);
});

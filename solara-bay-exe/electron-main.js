const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const url = require('url');

function createWindow(){
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth:900, minHeight:600,
    title: "SOLARA BAY — Voxel Open World",
    backgroundColor: "#0f0f14",
    icon: path.join(__dirname, '../icons/icon-512.png'),
    webPreferences: { nodeIntegration:false, contextIsolation:true },
    autoHideMenuBar: true
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '../solara-bay/index.html'));
  // win.webContents.openDevTools();
}
app.whenReady().then(createWindow);
app.on('window-all-closed', ()=>{ if(process.platform!=='darwin') app.quit(); });
app.on('activate', ()=>{ if(BrowserWindow.getAllWindows().length===0) createWindow(); });

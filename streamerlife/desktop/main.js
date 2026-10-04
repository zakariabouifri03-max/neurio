// Electron shell → makes the Windows .exe (also mac/linux)
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 860, backgroundColor: '#06080f', autoHideMenuBar: true,
    title: 'Streamer Life 3D', icon: path.join(__dirname, '..', 'icons', 'icon-512.png'),
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  win.once('ready-to-show', () => win.show());
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

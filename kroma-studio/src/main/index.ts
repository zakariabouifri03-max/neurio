import { BrowserWindow, Menu, app, net, shell } from 'electron'
import { join } from 'node:path'
import { BRAND } from '../shared/brand'
import { CONNECTIVITY_CHANNEL, MENU_ACTION_CHANNEL, type MenuAction } from '../shared/ipc'
import { registerIpcHandlers } from './ipc'
import { log } from './logger'
import { hardenSession, installAssetProtocolHandler, lockNavigation, prepareStorage, registerAssetProtocol, singleInstance } from './security'
import { getDatabase } from './services/storage/database'
import { getProjectStore } from './services/storage/project-store'
import { getSettingsStore } from './services/storage/settings-store'
import { getTemplateStore } from './services/storage/template-store'

registerAssetProtocol()

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL

let mainWindow: BrowserWindow | null = null
const getWindow = (): BrowserWindow | null => mainWindow

function buildMenu(): void {
  const send = (action: MenuAction): void => {
    mainWindow?.webContents.send(MENU_ACTION_CHANNEL, action)
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Design', accelerator: 'CmdOrCtrl+N', click: () => send('new-design') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('open-project') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: () => send('export') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('settings') },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${BRAND.short}` }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy', label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => send('copy') },
        { role: 'paste', label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => send('paste') },
        { type: 'separator' },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: () => send('duplicate') },
        { label: 'Delete', accelerator: 'Delete', click: () => send('delete') },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => send('select-all') },
        { type: 'separator' },
        { label: 'Group', accelerator: 'CmdOrCtrl+G', click: () => send('group') },
        { label: 'Ungroup', accelerator: 'CmdOrCtrl+Shift+G', click: () => send('ungroup') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Preview Design', accelerator: 'CmdOrCtrl+P', click: () => send('preview') }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: `${BRAND.name} Website`, click: () => void shell.openExternal(BRAND.supportUrl) },
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'F1',
          click: () => mainWindow?.webContents.send(MENU_ACTION_CHANNEL, 'settings')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const settings = getSettingsStore().get()
  mainWindow = new BrowserWindow({
    width: 1512,
    height: 940,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    backgroundColor: '#0B0B12',
    title: BRAND.name,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      additionalArguments: [`--kroma-accent=${settings.appearance.accent}`]
    }
  })

  lockNavigation(mainWindow)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Report connectivity so the UI can show "Offline Mode" vs "AI Online".
  const broadcast = (): void => {
    const online = net.isOnline()
    BrowserWindow.getAllWindows().forEach((win) => win.webContents.send(CONNECTIVITY_CHANNEL, online))
  }
  broadcast()
  const timer = setInterval(broadcast, 15_000)
  mainWindow.on('closed', () => clearInterval(timer))
}

app.setName(BRAND.short)

if (!singleInstance()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    try {
      hardenSession()
      prepareStorage()
      installAssetProtocolHandler()
      buildMenu()
      registerIpcHandlers(getWindow)

      // Warm the local stores: index built-in templates and seed samples.
      getTemplateStore()
      const seeded = getProjectStore().seedSamplesIfEmpty()
      log.info(`${BRAND.name} ready (engine=${getDatabase().engine}, samples=${seeded})`)

      createWindow()
    } catch (error) {
      log.error('Startup failed', error)
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('before-quit', () => {
    getDatabase().close()
  })

  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception (kept alive)', error)
  })
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection (kept alive)', reason)
  })
}

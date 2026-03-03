import { app, BrowserWindow, shell, nativeImage, Menu, dialog } from 'electron'
import { join, resolve } from 'path'
import { config } from 'dotenv'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipcHandlers'

const DRAFT_ROOT = process.env.DRAFT_PATH ?? '/Users/pori/WebstormProjects/hohoff/draft'

app.setName('Hohoff')

// Load .env then .env.local so values in .env.local override .env
config({ path: resolve(process.cwd(), '.env') })
config({ path: resolve(process.cwd(), '.env.local'), override: true })

function send(win: BrowserWindow, action: string): void {
  if (!win.isDestroyed()) win.webContents.send('menu:action', action)
}

function buildAppMenu(win: BrowserWindow): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // ── Hohoff (macOS app menu) ──────────────────────────────────────────
    ...(isMac
      ? ([
          {
            label: 'Hohoff',
            submenu: [
              {
                label: 'About Hohoff Editor',
                click: () =>
                  dialog.showMessageBox(win, {
                    type: 'info',
                    title: 'Hohoff Editor',
                    message: 'Hohoff Editor',
                    detail: `Version ${app.getVersion()}\n\nA writing environment for Gothic fiction.`
                  })
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),

    // ── File ─────────────────────────────────────────────────────────────
    {
      label: 'File',
      submenu: [
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send(win, 'save')
        },
        { type: 'separator' },
        {
          label: 'Open Draft Folder in Finder',
          click: () => shell.openPath(DRAFT_ROOT)
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },

    // ── Edit ─────────────────────────────────────────────────────────────
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find / Replace',
          accelerator: 'CmdOrCtrl+F',
          click: () => send(win, 'find')
        }
      ]
    },

    // ── View ─────────────────────────────────────────────────────────────
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle File Tree',
          accelerator: 'CmdOrCtrl+Shift+1',
          click: () => send(win, 'toggleSidebar')
        },
        {
          label: 'Toggle AI Chat',
          accelerator: 'CmdOrCtrl+Shift+2',
          click: () => send(win, 'toggleChat')
        },
        {
          label: 'Toggle Revision History',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => send(win, 'toggleRevisions')
        },
        { type: 'separator' },
        {
          label: 'Toggle Dark Mode',
          click: () => send(win, 'toggleTheme')
        },
        { type: 'separator' },
        {
          label: 'Increase Font Size',
          accelerator: 'CmdOrCtrl+=',
          click: () => send(win, 'fontIncrease')
        },
        {
          label: 'Decrease Font Size',
          accelerator: 'CmdOrCtrl+-',
          click: () => send(win, 'fontDecrease')
        },
        {
          label: 'Reset Font Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => send(win, 'fontReset')
        }
      ]
    },

    // ── Window ───────────────────────────────────────────────────────────
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? ([
              { type: 'separator' },
              { role: 'front' }
            ] as Electron.MenuItemConstructorOptions[])
          : [])
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): BrowserWindow {
  const icon = nativeImage.createFromPath(
    join(__dirname, '../../resources/icon.png')
  )
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Hohoff Editor',
    titleBarStyle: 'hiddenInset',
    icon,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.hohoff.editor')

  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(
      join(__dirname, '../../resources/icon.png')
    )
    app.dock.setIcon(dockIcon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  const mainWindow = createWindow()
  buildAppMenu(mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

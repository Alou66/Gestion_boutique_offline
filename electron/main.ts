import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { initDatabase } from './services/databaseService'
import { registerIpcHandlers } from './ipc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function resolveMigrationsFolder(): string {
  const candidates = [
    path.join(__dirname, 'database/migrations'),
    path.join(process.env.APP_ROOT, 'dist-electron/database/migrations'),
    path.join(process.env.APP_ROOT, 'electron/database/migrations'),
  ]

  return candidates.find((folder) => fs.existsSync(folder)) ?? candidates[0]
}

async function startApp() {
  const migrationsFolder = resolveMigrationsFolder()

  try {
    initDatabase(migrationsFolder)
  } catch (error) {
    console.error(
      `Failed to initialize database (migrations folder: ${migrationsFolder}):`,
      error,
    )
  }

  registerIpcHandlers()
  createWindow()
}

app.whenReady().then(startApp)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

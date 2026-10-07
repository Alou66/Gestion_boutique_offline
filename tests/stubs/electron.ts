import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Test double for the `electron` module.
 *
 * The services import `app` only to locate the SQLite file
 * (`app.getPath('userData')`). The test suite redirects that folder to a
 * temporary directory, so `electron/database/client.ts` runs unmodified, with
 * its real pragmas (`foreign_keys = ON`) and its real `unaccent` function.
 */
export const app = {
  getPath(name: string): string {
    const userDataDir =
      process.env.GESTION_BOUTIQUE_TEST_USER_DATA ??
      path.join(os.tmpdir(), 'gestion-boutique-tests')

    fs.mkdirSync(userDataDir, { recursive: true })

    return name === 'userData' ? userDataDir : path.join(userDataDir, name)
  },
}

/** Handlers are registered by electron/ipc and can be called back from a test. */
const handlers = new Map<string, (...args: unknown[]) => unknown>()

export const ipcMain = {
  handle(channel: string, listener: (...args: unknown[]) => unknown): void {
    handlers.set(channel, listener)
  },
  removeHandler(channel: string): void {
    handlers.delete(channel)
  },
}

/** Calls a registered ipcMain handler, like ipcRenderer.invoke would. */
export function invokeHandler(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel)

  if (!handler) {
    throw new Error(`No handler registered for ${channel}`)
  }

  return handler({}, ...args)
}

export function registeredChannels(): string[] {
  return [...handlers.keys()].sort()
}

/**
 * `contextBridge` double: it records what the preload script published, so a
 * test can assert the exact surface offered to the renderer. Nothing else is
 * ever published, and `ipcRenderer` itself is never handed over.
 */
export const exposedToMainWorld: Record<string, unknown> = {}

export const contextBridge = {
  exposeInMainWorld(key: string, value: unknown): void {
    exposedToMainWorld[key] = value
  },
}

/** `ipcRenderer` double: it can only reach the registered main process handlers. */
export const ipcRenderer = {
  invoke(channel: string, ...args: unknown[]): unknown {
    return invokeHandler(channel, ...args)
  },
  send(): void {
    throw new Error('ipcRenderer.send is not used by this application')
  },
  on(): void {
    throw new Error('ipcRenderer.on is not used by this application')
  },
}

export default { app, ipcMain, contextBridge, ipcRenderer }

/**
 * Printing doubles. `printService` opens a hidden window, prints it and asks
 * where to store the PDF: the test drives those three steps without a real
 * Electron runtime, and inspects exactly what the service asked Chromium for.
 */
export const printStubs = {
  /** Every URL loaded in a document window, `data:` URLs included. */
  loadedUrls: [] as string[],
  /** Options of every document window opened by the print service. */
  windowOptions: [] as Record<string, unknown>[],
  printOptions: [] as unknown[],
  pdfOptions: [] as unknown[],
  saveOptions: [] as unknown[],
  /** What `webContents.print` answers through its callback. */
  printSucceeds: true,
  /** Electron answered through a promise instead of the callback. */
  printReturnsPromise: false,
  /** Bytes returned by `printToPDF`, or an error to simulate a failure. */
  pdfResult: Buffer.from('%PDF-1.4 facture') as Buffer | Error,
  /** Where the save dialog points, or null when it is cancelled. */
  savePath: '/tmp/gestion-boutique-facture.pdf' as string | null,
  failToLoad: false,
  openWindows: 0,
}

export function resetPrintStubs(): void {
  printStubs.loadedUrls = []
  printStubs.windowOptions = []
  printStubs.printOptions = []
  printStubs.pdfOptions = []
  printStubs.saveOptions = []
  printStubs.printSucceeds = true
  printStubs.printReturnsPromise = false
  printStubs.pdfResult = Buffer.from('%PDF-1.4 facture')
  printStubs.savePath = '/tmp/gestion-boutique-facture.pdf'
  printStubs.failToLoad = false
  printStubs.openWindows = 0
}

export class BrowserWindow {
  readonly webContents: {
    print: (options: unknown, callback: (success: boolean) => void) => void
    printToPDF: (options: unknown) => Promise<Buffer>
  }

  private destroyed = false

  constructor(readonly options: Record<string, unknown> = {}) {
    printStubs.openWindows += 1
    printStubs.windowOptions.push(options)

    this.webContents = {
      print(
        printOptions: unknown,
        callback: (success: boolean) => void,
      ): Promise<boolean> | void {
        printStubs.printOptions.push(printOptions)

        if (printStubs.printReturnsPromise) {
          return printStubs.printSucceeds
            ? Promise.resolve(true)
            : Promise.reject(new Error('printing failed'))
        }

        callback(printStubs.printSucceeds)
      },
      printToPDF(pdfOptions: unknown): Promise<Buffer> {
        printStubs.pdfOptions.push(pdfOptions)

        return printStubs.pdfResult instanceof Error
          ? Promise.reject(printStubs.pdfResult)
          : Promise.resolve(printStubs.pdfResult)
      },
    }
  }

  async loadURL(url: string): Promise<void> {
    printStubs.loadedUrls.push(url)

    if (printStubs.failToLoad) {
      throw new Error('cannot load the document')
    }
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    this.destroyed = true
    printStubs.openWindows -= 1
  }
}

export const dialog = {
  showSaveDialog(options: unknown): Promise<{ canceled: boolean; filePath?: string }> {
    printStubs.saveOptions.push(options)

    return Promise.resolve({
      canceled: printStubs.savePath === null,
      filePath: printStubs.savePath ?? undefined,
    })
  },
}
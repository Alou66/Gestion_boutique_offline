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

export default { app, ipcMain }
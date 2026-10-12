import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import type { ElectronAPI } from '../electron/types'
import { exposedToMainWorld, resetPrintStubs } from './stubs/electron'

import '../electron/preload'

describe('pont de sécurité du preload (backup)', () => {
  const exposed = exposedToMainWorld.api as ElectronAPI

  after(() => {
    resetPrintStubs()
  })

  it("publie une unique API sous window.api, sans ipcRenderer ni base de donnees", () => {
    assert.deepEqual(Object.keys(exposedToMainWorld), ['api'])

    const keys = new Set<string>()
    function collect(value: unknown): void {
      if (value === null || typeof value !== 'object') return
      for (const [key, nested] of Object.entries(value)) {
        keys.add(key)
        collect(nested)
      }
    }
    collect(exposedToMainWorld)

    for (const forbidden of [
      'ipcRenderer',
      'ipcMain',
      'webFrame',
      'db',
      'getDb',
      'sqlite',
      'better-sqlite3',
      'fs',
      'path',
      'process',
      'require',
    ]) {
      assert.equal(keys.has(forbidden), false, `${forbidden} must not reach the renderer`)
    }
  })

  it('expose window.api.backup avec les quatre méthodes attendues', () => {
    const backup = exposed.backup

    assert.equal(typeof backup, 'object')
    assert.equal(typeof backup.backup, 'function')
    assert.equal(typeof backup.restore, 'function')
    assert.equal(typeof backup.info, 'function')
    assert.equal(typeof backup.validate, 'function')
  })
})

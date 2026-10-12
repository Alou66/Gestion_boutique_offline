import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getDb } from '../electron/database/client'
import {
  BACKUP_ERRORS,
  createBackup,
  getDatabaseInfo,
  getDatabasePath,
  restoreBackup,
  validateBackupFile,
} from '../electron/services/backupService'
import { maintenanceLock } from '../electron/services/maintenanceLock'
import {
  closeTestDatabase,
  openTestDatabase,
  resetTestDatabase,
  seedCategory,
  seedSimpleProduct,
} from './helpers/database'
import { printStubs, resetPrintStubs } from './stubs/electron'

const REQUIRED_TABLES = [
  'settings',
  'users',
  'categories',
  'products',
  'clients',
  'suppliers',
  'sales',
  'payments',
  'sale_items',
  'stock_movements',
  'supplies',
  'supply_items',
  'transformations',
]

function tmpFile(suffix: string): string {
  return path.join(os.tmpdir(), `gestion-boutique-test-${Date.now()}-${suffix}`)
}

function productCount(): number {
  return (getDb().$client.prepare('SELECT COUNT(*) as c FROM products').get() as {
    c: number
  }).c
}

describe('module Backup', () => {
  before(() => {
    openTestDatabase()
    resetPrintStubs()
  })

  after(() => {
    closeTestDatabase()
  })

  beforeEach(() => {
    resetTestDatabase()
    resetPrintStubs()
  })

  describe('createBackup', () => {
    it('exports a valid SQLite file', async () => {
      const backupPath = tmpFile('valid.sqlite')
      printStubs.savePath = backupPath

      const result = await createBackup()

      assert.equal(result.success, true)
      if (!result.success) return
      assert.equal(result.data, backupPath)

      assert.ok(fs.existsSync(backupPath), 'backup file must exist')
      assert.ok(fs.statSync(backupPath).size > 0, 'backup file must not be empty')

      const verify = new Database(backupPath, { readonly: true })
      try {
        const integrity = verify.prepare('PRAGMA integrity_check').get() as {
          integrity_check: string
        }
        assert.equal(integrity.integrity_check, 'ok')
      } finally {
        verify.close()
      }
    })

    it('includes all required tables', async () => {
      const backupPath = tmpFile('tables.sqlite')
      printStubs.savePath = backupPath

      const result = await createBackup()
      assert.ok(result.success)
      if (!result.success) return

      const verify = new Database(backupPath, { readonly: true })
      try {
        const tables = verify
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as { name: string }[]
        const tableNames = new Set(tables.map((t) => t.name))

        for (const required of REQUIRED_TABLES) {
          assert.ok(tableNames.has(required), `table ${required} must be in the backup`)
        }
      } finally {
        verify.close()
      }
    })

    it('preserves row data', async () => {
      const category = seedCategory('BOISSONS')
      seedSimpleProduct(category, 'SUCRE 1 KG')
      const productCountBefore = productCount()

      const backupPath = tmpFile('data.sqlite')
      printStubs.savePath = backupPath

      const result = await createBackup()
      assert.ok(result.success)
      if (!result.success) return

      const verify = new Database(backupPath, { readonly: true })
      try {
        const count = verify.prepare('SELECT COUNT(*) as c FROM products').get() as {
          c: number
        }
        assert.equal(count.c, productCountBefore, 'backup must preserve row data')
      } finally {
        verify.close()
      }
    })

    it('fails when save dialog is cancelled', async () => {
      printStubs.savePath = null

      const result = await createBackup()

      assert.equal(result.success, false)
      assert.equal(result.error, BACKUP_ERRORS.cancelled)
    })

    it('is blocked during maintenance lock', async () => {
      const mockDb = { inTransaction: false }
      const lock = await maintenanceLock.acquireForMaintenance(mockDb)
      try {
        const backupPath = tmpFile('blocked.sqlite')
        printStubs.savePath = backupPath

        const result = await createBackup()

        assert.equal(result.success, false)
        assert.equal(result.error, BACKUP_ERRORS.maintenanceInProgress)
        assert.equal(
          fs.existsSync(backupPath),
          false,
          'no file must be created when blocked',
        )
      } finally {
        lock.release()
      }
    })

    it('is NOT blocked by maintenance lock (backup is online)', async () => {
      const backupPath = tmpFile('online.sqlite')
      printStubs.savePath = backupPath

      const result = await createBackup()

      assert.equal(result.success, true, 'backup must work even when system is busy')
      if (result.success) {
        assert.ok(fs.existsSync(result.data))
      }
    })
  })

  describe('validateBackupFile', () => {
    it('accepts a valid backup', async () => {
      const backupPath = tmpFile('valid-validate.sqlite')
      printStubs.savePath = backupPath

      const result = await createBackup()
      assert.ok(result.success)
      if (!result.success) return

      const validation = validateBackupFile(backupPath)
      assert.equal(validation.success, true)
      assert.equal(validation.data.valid, true)
    })

    it('rejects a corrupted file', () => {
      const corruptedPath = tmpFile('corrupted.sqlite')
      fs.writeFileSync(corruptedPath, 'not a sqlite database')

      const validation = validateBackupFile(corruptedPath)

      assert.equal(validation.success, false)
      assert.equal(validation.error, BACKUP_ERRORS.corruptedFile)
    })

    it('rejects a file missing required tables', () => {
      const emptyDbPath = tmpFile('empty.sqlite')
      const db = new Database(emptyDbPath)
      db.close()

      const validation = validateBackupFile(emptyDbPath)

      assert.equal(validation.success, false)
      assert.equal(validation.error, BACKUP_ERRORS.invalidBackupFile)
    })

    it('rejects a non-existent file', () => {
      const validation = validateBackupFile('/nonexistent/path/file.sqlite')

      assert.equal(validation.success, false)
      assert.equal(validation.error, BACKUP_ERRORS.fileNotFound)
    })

    it('rejects a backup from a future schema version', async () => {
      const backupPath = tmpFile('future.sqlite')
      printStubs.savePath = backupPath

      const result = await createBackup()
      assert.ok(result.success)
      if (!result.success) return

      // Tamper: set a future migration timestamp
      const db = new Database(backupPath)
      db.prepare(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
      ).run('fakehash', Date.now() + 999_999_999_999)
      db.close()

      const validation = validateBackupFile(backupPath)
      assert.equal(validation.success, false)
      assert.equal(validation.error, BACKUP_ERRORS.backupVersionTooNew)
    })
  })

  describe('restoreBackup', () => {
    it('restores from a valid backup file', async () => {
      const category = seedCategory('RESTORE TEST')
      seedSimpleProduct(category, 'PRODUIT RESTORE')
      const productCountBefore = productCount()

      const backupPath = tmpFile('for-restore.sqlite')
      printStubs.savePath = backupPath

      const backupResult = await createBackup()
      assert.ok(backupResult.success)
      if (!backupResult.success) return

      // Modify the active database after the backup
      seedSimpleProduct(category, 'PRODUIT TEMPORAIRE')
      assert.equal(productCount(), productCountBefore + 1, 'temporary product added')

      // Restore the backup (file path provided directly)
      const restoreResult = await restoreBackup(backupPath)
      assert.ok(restoreResult.success)
      if (!restoreResult.success) return
      assert.equal(restoreResult.data.canceled, false)
      assert.equal(restoreResult.data.restarted, true)

      // Verify data was restored (temporary product should be gone)
      assert.equal(productCount(), productCountBefore, 'products must be restored to backup state')
    })

    it('is blocked when a transaction is in progress', async () => {
      const db = getDb()
      const sqlite = db.$client as unknown as Database.Database

      const backupPath = tmpFile('during-tx.sqlite')
      printStubs.savePath = backupPath

      const backupResult = await createBackup()
      assert.ok(backupResult.success)
      if (!backupResult.success) return

      // Start a raw transaction — better-sqlite3 has no manual TX control
      // on the Transaction wrapper, so we use BEGIN directly.
      sqlite.prepare('BEGIN').run()
      assert.equal(sqlite.inTransaction, true, 'transaction must be open')

      try {
        const result = await restoreBackup(backupPath)

        assert.equal(result.success, false)
        assert.equal(result.error, BACKUP_ERRORS.restoreTimeout)
      } finally {
        sqlite.prepare('ROLLBACK').run()
        assert.equal(sqlite.inTransaction, false, 'transaction must be rolled back')
      }
    })

    it('creates and cleans up an emergency backup', async () => {
      const backupPath = tmpFile('with-emergency.sqlite')
      printStubs.savePath = backupPath

      const backupResult = await createBackup()
      assert.ok(backupResult.success)
      if (!backupResult.success) return

      const dbPath = getDatabasePath()
      const dbDir = path.dirname(dbPath)
      const emergencyPattern = path.basename(dbPath) + '.emergency-'

      const emergencyFilesBefore = fs
        .readdirSync(dbDir)
        .filter((f) => f.startsWith(emergencyPattern))

      const restoreResult = await restoreBackup(backupPath)
      assert.ok(restoreResult.success)
      if (!restoreResult.success) return

      const emergencyFilesAfter = fs
        .readdirSync(dbDir)
        .filter((f) => f.startsWith(emergencyPattern))

      assert.equal(
        emergencyFilesAfter.length,
        emergencyFilesBefore.length,
        'emergency backup must be cleaned up after successful restore',
      )
    })

    it('recovers from emergency backup on corrupted file', async () => {
      const corruptedPath = tmpFile('corrupted-restore.sqlite')
      fs.writeFileSync(corruptedPath, 'not sqlite')

      const dbPath = getDatabasePath()
      const existedBefore = fs.existsSync(dbPath)

      const result = await restoreBackup(corruptedPath)

      assert.equal(result.success, false)
      assert.equal(result.error, BACKUP_ERRORS.corruptedFile)

      // The original database must still exist after a failed restore
      assert.equal(
        fs.existsSync(dbPath),
        existedBefore,
        'original database must survive a failed restore',
      )
    })

    it('cancels restore when dialog is cancelled', async () => {
      printStubs.openPath = null

      const result = await restoreBackup()

      assert.equal(result.success, true)
      if (!result.success) return
      assert.equal(result.data.canceled, true)
      assert.equal(result.data.restarted, false)
    })
  })

  describe('getDatabaseInfo', () => {
    it('returns valid info when database exists', () => {
      const result = getDatabaseInfo()

      assert.equal(result.success, true)
      if (!result.success) return
      assert.equal(result.data.exists, true)
      assert.ok(result.data.sizeBytes > 0)
      assert.ok(result.data.sqliteVersion.length > 0)
    })

    it('reports SQLite version', () => {
      const result = getDatabaseInfo()

      assert.equal(result.success, true)
      if (!result.success) return
      assert.match(result.data.sqliteVersion, /^\d+\.\d+\.\d+/)
    })
  })
})

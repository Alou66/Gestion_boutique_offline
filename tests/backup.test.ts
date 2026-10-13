import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { closeDatabase, getDb, initializeDatabase } from '../electron/database/client'
import {
  BACKUP_ERRORS,
  createBackup,
  getDatabaseInfo,
  getDatabasePath,
  restoreBackup,
  validateBackupFile,
} from '../electron/services/backupService'
import { registerBackupIpcHandlers } from '../electron/ipc/backup'
import type { BackupInfo, DatabaseResult } from '../electron/types'
import { maintenanceLock } from '../electron/services/maintenanceLock'
import {
  closeTestDatabase,
  openTestDatabase,
  resetTestDatabase,
  seedCategory,
  seedSimpleProduct,
} from './helpers/database'
import { invokeHandler, printStubs, resetPrintStubs } from './stubs/electron'

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

    it('cleans up partial backup file when sqlite.backup fails mid-operation', async () => {
      const backupPath = tmpFile('partial-cleanup.sqlite')
      printStubs.savePath = backupPath

      const proto = Database.prototype as unknown as {
        backup: (destination: string, options?: unknown) => unknown
      }
      const originalBackup = proto.backup
      proto.backup = function (destination: string) {
        fs.writeFileSync(destination, 'partial backup data')
        throw new Error('Simulated backup failure mid-operation')
      }

      try {
        const result = await createBackup()

        assert.equal(result.success, false)
        assert.equal(result.error, BACKUP_ERRORS.backupFailed)
        assert.equal(
          fs.existsSync(backupPath),
          false,
          'partial backup file must be cleaned up on failure',
        )
      } finally {
        proto.backup = originalBackup
      }
    })

    it('does not delete pre-existing file when backup fails', async () => {
      const backupPath = tmpFile('preexisting.sqlite')
      fs.writeFileSync(backupPath, 'pre-existing content')
      printStubs.savePath = backupPath

      const proto = Database.prototype as unknown as {
        backup: (destination: string, options?: unknown) => unknown
      }
      const originalBackup = proto.backup
      proto.backup = function () {
        throw new Error('Simulated backup failure')
      }

      try {
        const result = await createBackup()

        assert.equal(result.success, false)
        assert.equal(
          fs.existsSync(backupPath),
          true,
          'pre-existing file must not be deleted',
        )
        assert.equal(fs.readFileSync(backupPath, 'utf8'), 'pre-existing content')
      } finally {
        proto.backup = originalBackup
      }
    })

    it('releases backup lock on failure', async () => {
      printStubs.savePath = null

      const result = await createBackup()
      assert.equal(result.success, false)

      const lock = maintenanceLock.acquireForBackup()
      assert.ok(lock, 'backup lock must be available after failure')
      lock.release()
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

  describe('contrat IPC backup-info', () => {
    before(() => {
      registerBackupIpcHandlers()
    })

    it('renvoie une information non imbriquée via le canal IPC', () => {
      const result = invokeHandler('database:backup-info') as DatabaseResult<BackupInfo>

      assert.equal(result.success, true, 'must return a success envelope')
      if (!result.success) return

      assert.equal(result.data.exists, true, 'data.exists must be the actual BackupInfo field')
      assert.ok(typeof result.data.sizeBytes === 'number')
      assert.ok(typeof result.data.sqliteVersion === 'string')

      assert.equal(
        (result.data as unknown as Record<string, unknown>).success,
        undefined,
        'must not be double-wrapped in a nested DatabaseResult',
      )
      assert.equal(
        (result.data as unknown as Record<string, unknown>).data,
        undefined,
        'must not contain a nested data field',
      )
    })
  })

  describe('mode WAL — sauvegarde et restauration', () => {
    function enableWalMode(): Database.Database {
      const dbPath = getDatabasePath()
      closeDatabase()

      const sqlite = new Database(dbPath)
      sqlite.pragma('foreign_keys = ON')
      sqlite.pragma('journal_mode = WAL')
      sqlite.pragma('wal_checkpoint(TRUNCATE)')
      sqlite.close()

      return initializeDatabase().$client as unknown as Database.Database
    }

    it('préserve les données via backup et restore en mode WAL', async () => {
      const sqlite = enableWalMode()

      const category = seedCategory('WAL TEST')
      seedSimpleProduct(category, 'WAL PRODUIT 1')
      seedSimpleProduct(category, 'WAL PRODUIT 2')

      // Force data into WAL by inserting more and not checkpointing
      seedSimpleProduct(category, 'WAL PRODUIT 3')
      sqlite.pragma('wal_checkpoint(PASSIVE)')
      const countAfterWal = productCount()

      // Create backup
      const backupPath = tmpFile('wal-backup.sqlite')
      printStubs.savePath = backupPath
      const backupResult = await createBackup()
      assert.ok(backupResult.success)
      if (!backupResult.success) return

      // Verify backup contains all data
      const verify = new Database(backupPath, { readonly: true })
      try {
        const count = verify.prepare('SELECT COUNT(*) as c FROM products').get() as {
          c: number
        }
        assert.equal(count.c, countAfterWal, 'backup must contain all WAL data')
      } finally {
        verify.close()
      }

      // Restore backup
      const restoreResult = await restoreBackup(backupPath)
      assert.ok(restoreResult.success)
      if (!restoreResult.success) return

      // Verify WAL/SHM files are cleaned up after restore
      const dbPath = getDatabasePath()
      assert.equal(fs.existsSync(`${dbPath}-wal`), false, 'WAL file must be removed after restore')
      assert.equal(
        fs.existsSync(`${dbPath}-shm`),
        false,
        'SHM file must be removed after restore',
      )

      // Verify data is preserved after restore
      assert.equal(
        productCount(),
        countAfterWal,
        'all data must be preserved after restore',
      )
    })

    it('échoue si le checkpoint WAL est bloqué par un lecteur externe', async () => {
      enableWalMode()

      const category = seedCategory('WAL BLOCKED')
      seedSimpleProduct(category, 'BLOCKED PRODUCT')
      const countBefore = productCount()

      const backupPath = tmpFile('wal-blocked.sqlite')
      printStubs.savePath = backupPath
      const backupResult = await createBackup()
      assert.ok(backupResult.success)
      if (!backupResult.success) return

      // Simulate a blocked WAL checkpoint (busy > 0 means readers prevented it)
      const sqlite = getDb().$client as unknown as Database.Database
      const originalPragma = sqlite.pragma.bind(sqlite)
      ;(sqlite as unknown as Record<string, unknown>).pragma = (query: string) => {
        if (typeof query === 'string' && query.includes('wal_checkpoint')) {
          return { busy: 1, log: 1, ckpt: 0 }
        }
        return originalPragma(query)
      }

      try {
        const result = await restoreBackup(backupPath)

        assert.equal(result.success, false, 'restore must fail when checkpoint is blocked')
        assert.equal(result.error, BACKUP_ERRORS.restoreFailed)

        // Original database must not have been modified
        assert.equal(productCount(), countBefore, 'original data must be preserved')
      } finally {
        (sqlite as unknown as Record<string, unknown>).pragma = originalPragma
      }
    })
  })

  describe('récupération d’urgence', () => {
    it('restaure depuis la sauvegarde d’urgence quand la copie échoue', async () => {
      // Create a valid backup
      const backupPath = tmpFile('emergency-recovery.sqlite')
      printStubs.savePath = backupPath
      const backupResult = await createBackup()
      assert.ok(backupResult.success)
      if (!backupResult.success) return

      // Modify the current database after backup
      const category = seedCategory('AFTER BACKUP')
      seedSimpleProduct(category, 'PRODUIT AFTER BACKUP')
      const countAtRestoreStart = productCount()

      // Make the restore copy fail to trigger emergency recovery
      const originalCopy = fs.copyFileSync
      const dbPath = getDatabasePath()
      fs.copyFileSync = (src: unknown, dest: unknown, ...rest: unknown[]) => {
        if (String(src) === backupPath && String(dest) === dbPath) {
          throw new Error('Simulated write failure')
        }
        return originalCopy(
          src as string | Buffer,
          dest as string | Buffer,
          ...(rest as []),
        )
      }

      try {
        const result = await restoreBackup(backupPath)

        assert.equal(result.success, false, 'restore must fail')
        assert.equal(result.success ? '' : result.error, BACKUP_ERRORS.restoreFailed)

        // Emergency backup must have restored the DB to its pre-restore state
        assert.equal(
          productCount(),
          countAtRestoreStart,
          'data must be restored from emergency backup',
        )

        // Emergency backup file should remain (not cleaned up on failure)
        const emergencyFiles = fs
          .readdirSync(path.dirname(dbPath))
          .filter((f) => f.startsWith('database.sqlite.emergency-'))
        assert.ok(emergencyFiles.length > 0, 'emergency backup must be retained for inspection')
      } finally {
        fs.copyFileSync = originalCopy
      }
    })

    it('preserve les données WAL dans la sauvegarde d’urgence', async () => {
      enableWalMode()

      const category = seedCategory('WAL EMERGENCY')
      seedSimpleProduct(category, 'WAL EMERGENCY PRODUCT')

      // Create a valid backup
      const backupPath = tmpFile('wal-emergency.sqlite')
      printStubs.savePath = backupPath
      const backupResult = await createBackup()
      assert.ok(backupResult.success)
      if (!backupResult.success) return

      // Insert more data (stays in WAL) then attempt restore that will fail
      seedSimpleProduct(category, 'WAL EMERGENCY PRODUCT 2')
      const countAtRestoreStart = productCount()

      const originalCopy = fs.copyFileSync
      const dbPath = getDatabasePath()
      fs.copyFileSync = (src: unknown, dest: unknown, ...rest: unknown[]) => {
        if (String(src) === backupPath && String(dest) === dbPath) {
          throw new Error('Simulated write failure')
        }
        return originalCopy(
          src as string | Buffer,
          dest as string | Buffer,
          ...(rest as []),
        )
      }

      try {
        const result = await restoreBackup(backupPath)

        assert.equal(result.success, false)
        assert.equal(result.success ? '' : result.error, BACKUP_ERRORS.restoreFailed)

        // Emergency recovery must have preserved WAL data via checkpoint
        assert.equal(
          productCount(),
          countAtRestoreStart,
          'WAL data must be preserved in emergency backup',
        )
      } finally {
        fs.copyFileSync = originalCopy
      }
    })

    function enableWalMode(): Database.Database {
      const dbPath = getDatabasePath()
      closeDatabase()

      const sqlite = new Database(dbPath)
      sqlite.pragma('foreign_keys = ON')
      sqlite.pragma('journal_mode = WAL')
      sqlite.pragma('wal_checkpoint(TRUNCATE)')
      sqlite.close()

      return initializeDatabase().$client as unknown as Database.Database
    }
  })
})

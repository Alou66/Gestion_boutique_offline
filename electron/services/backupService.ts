import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { app, dialog } from 'electron'
import { closeDatabase, getDb, initializeDatabase } from '../database/client'
import { initDatabase } from './databaseService'
import { maintenanceLock, type MaintenanceLockHandle } from './maintenanceLock'
import type {
  BackupInfo,
  DatabaseResult,
  RestoreResult,
  ValidationInfo,
} from '../types'

export const BACKUP_ERRORS = {
  cancelled: 'Sauvegarde annulée.',
  backupFailed: "La sauvegarde n'a pas pu être effectuée.",
  maintenanceInProgress:
    'Une opération de maintenance est en cours. Veuillez réessayer dans quelques instants.',
  fileNotFound: 'Le fichier sélectionné est introuvable.',
  corruptedFile:
    "Le fichier sélectionné est corrompu ou n'est pas une base de données valide.",
  invalidBackupFile: "Le fichier sélectionné ne contient pas les tables attendues.",
  foreignKeysViolated:
    'Le fichier contient des incohérences de clés étrangères.',
  backupVersionTooNew:
    "La sauvegarde provient d'une version ultérieure de l'application.",
  restoreFailed:
    "La restauration a échoué. La base de données d'origine a été restaurée automatiquement.",
  operationInProgress:
    'Une opération est en cours sur la base de données. Veuillez réessayer dans quelques instants.',
  restoreTimeout:
    "Aucune opération en cours n'a fini dans les délais. La restauration est annulée.",
  unexpected: 'Une erreur inattendue est survenue.',
  emergencyBackupInvalid:
    'La sauvegarde de secours est invalide. La base de données n\'a pas pu être restaurée automatiquement. Fichier de secours conservé pour analyse.',
} as const

export type BackupErrorCode = keyof typeof BACKUP_ERRORS

export class BackupError extends Error {
  readonly code: BackupErrorCode

  constructor(code: BackupErrorCode) {
    super(BACKUP_ERRORS[code])
    this.name = 'BackupError'
    this.code = code
  }
}

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
] as const

function formatDate(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function getDatabasePath(): string {
  return path.join(app.getPath('userData'), 'database.sqlite')
}

export function resolveMigrationsFolder(): string {
  const appRoot = process.env.APP_ROOT
  const dirname = path.dirname(fileURLToPath(import.meta.url))

  const candidates = [
    path.join(dirname, 'database/migrations'),
    appRoot ? path.join(appRoot, 'dist-electron/database/migrations') : '',
    appRoot ? path.join(appRoot, 'electron/database/migrations') : '',
    path.join(process.cwd(), 'electron/database/migrations'),
  ].filter(Boolean)

  return candidates.find((folder) => fs.existsSync(folder)) ?? candidates[0]
}

export function getCurrentMaxMigrationTime(): number {
  const journalPath = path.join(resolveMigrationsFolder(), 'meta', '_journal.json')
  if (!fs.existsSync(journalPath)) {
    return 0
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
    entries: { when: number }[]
  }

  return journal.entries.length > 0
    ? Math.max(...journal.entries.map((e) => e.when))
    : 0
}

function toResult<T>(data: T): DatabaseResult<T> {
  return { success: true, data }
}

function toError<T>(error: unknown, fallbackCode: BackupErrorCode): DatabaseResult<T> {
  if (error instanceof BackupError) {
    return { success: false, error: error.message }
  }

  console.error('[backup] Unexpected error:', error)
  return { success: false, error: BACKUP_ERRORS[fallbackCode] }
}

export function getDatabaseInfo(): DatabaseResult<BackupInfo> {
  try {
    const dbPath = getDatabasePath()

    if (!fs.existsSync(dbPath)) {
      return toResult({
        exists: false,
        filePath: dbPath,
        sizeBytes: 0,
        size: '0 octet',
        modifiedAt: '',
        sqliteVersion: '',
      })
    }

    const sqlite = new Database(dbPath, { readonly: true })
    try {
      const versionRow = sqlite
        .prepare('select sqlite_version() as version')
        .get() as { version: string }

      const stat = fs.statSync(dbPath)

      return toResult({
        exists: true,
        filePath: dbPath,
        sizeBytes: stat.size,
        size: formatSize(stat.size),
        modifiedAt: stat.mtime.toISOString(),
        sqliteVersion: versionRow?.version ?? 'inconnu',
      })
    } finally {
      sqlite.close()
    }
  } catch (error) {
    return toError(error, 'unexpected')
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} octet${bytes > 1 ? 's' : ''}`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} Go`
}

export function validateBackupFile(filePath: string): DatabaseResult<ValidationInfo> {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: BACKUP_ERRORS.fileNotFound }
    }

    let tempDb: Database.Database | null = null
    try {
      tempDb = new Database(filePath, { readonly: true, fileMustExist: true })
    } catch {
      return { success: false, error: BACKUP_ERRORS.corruptedFile }
    }

    try {
      let integrity: { integrity_check: string } | undefined
      try {
        integrity = tempDb
          .prepare('PRAGMA integrity_check')
          .get() as { integrity_check: string } | undefined
      } catch {
        return { success: false, error: BACKUP_ERRORS.corruptedFile }
      }

      if (integrity?.integrity_check !== 'ok') {
        return { success: false, error: BACKUP_ERRORS.corruptedFile }
      }

      const fkViolations = tempDb.prepare('PRAGMA foreign_key_check').all()
      if (fkViolations.length > 0) {
        return { success: false, error: BACKUP_ERRORS.foreignKeysViolated }
      }

      const tables = tempDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all() as { name: string }[]
      const tableNames = new Set(tables.map((t) => t.name))

      for (const required of REQUIRED_TABLES) {
        if (!tableNames.has(required)) {
          return { success: false, error: BACKUP_ERRORS.invalidBackupFile }
        }
      }

      const currentMax = getCurrentMaxMigrationTime()

      try {
        const lastMigration = tempDb
          .prepare('SELECT MAX(created_at) as max_created FROM __drizzle_migrations')
          .get() as { max_created: number | null } | undefined

        if (lastMigration?.max_created && lastMigration.max_created > currentMax) {
          return { success: false, error: BACKUP_ERRORS.backupVersionTooNew }
        }
      } catch {
        // Ignore migration table errors for version check
      }

      const stat = fs.statSync(filePath)

      return toResult({
        valid: true,
        filePath,
        sizeBytes: stat.size,
        size: formatSize(stat.size),
        modifiedAt: stat.mtime.toISOString(),
        tableCount: tables.length,
      })
    } finally {
      tempDb.close()
    }
  } catch (error) {
    return toError(error, 'unexpected')
  }
}

export async function createBackup(
  onProgress?: (percent: number) => void,
): Promise<DatabaseResult<string>> {
  let handle: MaintenanceLockHandle | null = null
  let backupPath: string | null = null
  let existedBefore = false

  try {
    handle = maintenanceLock.acquireForBackup()

    const db = getDb()
    const sqlite = db.$client as unknown as Database.Database

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Sauvegarder les données de la boutique',
      defaultPath: `gestion-boutique-sauvegarde-${formatDate()}.sqlite`,
      filters: [{ name: 'Base SQLite', extensions: ['sqlite'] }],
    })

    if (canceled || !filePath) {
      return { success: false, error: BACKUP_ERRORS.cancelled }
    }

    backupPath = filePath

    existedBefore = fs.existsSync(backupPath)

    await sqlite.backup(filePath, {
      progress: (info: { totalPages: number; remainingPages: number }) => {
        const percent = ((info.totalPages - info.remainingPages) / info.totalPages) * 100
        onProgress?.(percent)
        return 100
      },
    })

    return toResult(filePath)
  } catch (error) {
    if (backupPath && !existedBefore && fs.existsSync(backupPath)) {
      try {
        fs.rmSync(backupPath, { force: true })
      } catch (cleanupError) {
        console.error('[backup] Failed to cleanup partial backup file:', cleanupError)
      }
    }

    if (error instanceof BackupError) {
      return { success: false, error: error.message }
    }
    if (error instanceof Error && error.message.includes('Maintenance in progress')) {
      return { success: false, error: BACKUP_ERRORS.maintenanceInProgress }
    }
    return toError(error, 'backupFailed')
  } finally {
    handle?.release()
  }
}

function validateEmergencyBackup(emergencyPath: string): boolean {
  try {
    if (!fs.existsSync(emergencyPath)) {
      return false
    }

    const tempDb = new Database(emergencyPath, { readonly: true, fileMustExist: true })
    try {
      const integrity = tempDb
        .prepare('PRAGMA integrity_check')
        .get() as { integrity_check: string } | undefined

      if (integrity?.integrity_check !== 'ok') {
        return false
      }

      const fkViolations = tempDb.prepare('PRAGMA foreign_key_check').all()
      if (fkViolations.length > 0) {
        return false
      }

      const tables = tempDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all() as { name: string }[]
      const tableNames = new Set(tables.map((t) => t.name))

      for (const required of REQUIRED_TABLES) {
        if (!tableNames.has(required)) {
          return false
        }
      }

      return true
    } finally {
      tempDb.close()
    }
  } catch {
    return false
  }
}

export async function restoreBackup(
  filePath?: string,
): Promise<DatabaseResult<RestoreResult>> {
  let handle: MaintenanceLockHandle | null = null
  let emergencyPath: string | null = null
  let selectedPath = filePath
  const dbPath = getDatabasePath()

let restoreSucceeded = false

    try {
      if (!selectedPath) {
        const { canceled, filePaths } = await dialog.showOpenDialog({
          title: 'Sélectionner une sauvegarde',
          defaultPath: app.getPath('documents'),
          filters: [{ name: 'Base SQLite', extensions: ['sqlite'] }],
          properties: ['openFile'],
        })

        if (canceled || filePaths.length === 0) {
          return toResult({ canceled: true, restarted: false, message: 'Restauration annulée.' })
        }

        selectedPath = filePaths[0]!
      }

      const validation = validateBackupFile(selectedPath)
      if (!validation.success) {
        return { success: false, error: validation.error }
      }

      const db = getDb()
      const sqlite = db.$client as unknown as Database.Database

      try {
        handle = await maintenanceLock.acquireForMaintenance(sqlite)
      } catch (error) {
        if (error instanceof Error && error.message === 'Transaction did not complete in time') {
          return { success: false, error: BACKUP_ERRORS.restoreTimeout }
        }
        throw error
      }

      emergencyPath = `${dbPath}.emergency-${crypto.randomUUID().replace(/-/g, '')}`

      // Flush any WAL data to the main database file before copying, so the
      // emergency backup contains the full, consistent state. TRUNCATE also
      // empties the WAL file, making the subsequent removal of -wal / -shm
      // safe. This is a no-op when the database is not in WAL mode.
      const checkpointResult = sqlite.pragma('wal_checkpoint(TRUNCATE)') as
        | { busy: number; log: number; ckpt: number }
        | undefined

      if (checkpointResult && checkpointResult.busy > 0) {
        console.error(
          '[backup] WAL checkpoint was blocked (%d frames not flushed), safe restore not possible',
          checkpointResult.busy,
        )
        throw new BackupError('restoreFailed')
      }

      fs.copyFileSync(dbPath, emergencyPath)

      closeDatabase()

      // Remove WAL and SHM files that may persist after closing the connection.
      // They are safe to delete because wal_checkpoint(TRUNCATE) above already
      // flushed all committed data to the main file.
      const walPath = `${dbPath}-wal`
      const shmPath = `${dbPath}-shm`
      if (fs.existsSync(walPath)) {
        fs.rmSync(walPath, { force: true })
      }
      if (fs.existsSync(shmPath)) {
        fs.rmSync(shmPath, { force: true })
      }

      fs.copyFileSync(selectedPath!, dbPath)
      initializeDatabase()
      // The backup file may carry WAL mode in its header; ensure the
      // application always operates in the default rollback-journal mode.
      const newMode = (
        getDb().$client as unknown as Database.Database
      ).pragma('journal_mode = DELETE') as string

      if (newMode !== 'delete') {
        console.warn('[backup] Journal mode is "%s" after restore — expected "delete"', newMode)
      }

      initDatabase(resolveMigrationsFolder())

      const verifyDb = new Database(dbPath, { readonly: true })
      try {
        const integrity = verifyDb
          .prepare('PRAGMA integrity_check')
          .get() as { integrity_check: string } | undefined

        if (integrity?.integrity_check !== 'ok') {
          throw new BackupError('restoreFailed')
        }
      } finally {
        verifyDb.close()
      }

      restoreSucceeded = true

      setImmediate(() => {
        app.relaunch()
        app.quit()
      })

      return toResult({
        canceled: false,
        restarted: true,
        message: "Restauration réussie. L'application va redémarrer.",
      })
    } catch (error) {
      if (emergencyPath && fs.existsSync(emergencyPath)) {
        const isValid = validateEmergencyBackup(emergencyPath)

        if (isValid) {
          try {
            closeDatabase()
            fs.copyFileSync(emergencyPath, getDatabasePath())
            initializeDatabase()
            const recoveryMode = (
              getDb().$client as unknown as Database.Database
            ).pragma('journal_mode = DELETE') as string

            if (recoveryMode !== 'delete') {
              console.warn(
                '[backup] Journal mode is "%s" after emergency recovery — expected "delete"',
                recoveryMode,
              )
            }

            initDatabase(resolveMigrationsFolder())
          } catch (recoveryError) {
            console.error('[backup] Emergency recovery failed:', recoveryError)
          }
        } else {
          console.error('[backup] Emergency backup is invalid, NOT restoring:', emergencyPath)
          return { success: false, error: BACKUP_ERRORS.emergencyBackupInvalid }
        }
      } else if (emergencyPath) {
        console.error('[backup] Emergency backup file not found:', emergencyPath)
      }

      return toError(error, 'restoreFailed')
    } finally {
      if (emergencyPath && fs.existsSync(emergencyPath)) {
        if (restoreSucceeded) {
          try {
            fs.rmSync(emergencyPath, { force: true })
          } catch (cleanupError) {
            console.error('[backup] Failed to cleanup emergency backup after success:', cleanupError)
          }
        }
      }
      handle?.release()
    }
  }
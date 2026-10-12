import { ipcMain } from 'electron'
import {
  BACKUP_ERRORS,
  BackupError,
  createBackup,
  getDatabaseInfo,
  restoreBackup,
  validateBackupFile,
} from '../services/backupService'
import type {
  DatabaseResult,
  RestoreResult,
  ValidationInfo,
} from '../types'

function toSuccess<T>(data: T): DatabaseResult<T> {
  return { success: true, data }
}

function toFailure<T>(error: unknown, fallback: BackupErrorCode): DatabaseResult<T> {
  if (error instanceof BackupError) {
    return { success: false, error: error.message }
  }

  console.error('[backup] Unexpected error:', error)
  return { success: false, error: BACKUP_ERRORS[fallback] }
}

type BackupErrorCode = keyof typeof BACKUP_ERRORS

/**
 * Database maintenance channels. They are as thin as every other module:
 * the actual work lives in `backupService`, the IPC layer only wraps the
 * outcome in the `{ success, data | error }` envelope.
 */
export function registerBackupIpcHandlers(): void {
  ipcMain.handle('database:backup', async () => {
    try {
      return await createBackup()
    } catch (error) {
      return toFailure(error, 'unexpected')
    }
  })

  ipcMain.handle(
    'database:restore',
    async (_event, filePath?: string): Promise<DatabaseResult<RestoreResult>> => {
      try {
        return await restoreBackup(filePath)
      } catch (error) {
        return toFailure(error, 'unexpected')
      }
    },
  )

  ipcMain.handle('database:backup-info', async () => {
    try {
      return toSuccess(getDatabaseInfo())
    } catch (error) {
      return toFailure(error, 'unexpected')
    }
  })

  ipcMain.handle(
    'database:validate',
    async (_event, filePath: string): Promise<DatabaseResult<ValidationInfo>> => {
      try {
        return validateBackupFile(filePath)
      } catch (error) {
        return toFailure(error, 'unexpected')
      }
    },
  )
}

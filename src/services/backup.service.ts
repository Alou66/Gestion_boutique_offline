import type { BackupInfo, DatabaseResult, RestoreResult, ValidationInfo } from '@/types'

function unwrap<T>(result: DatabaseResult<T>): T {
  if (result.success) {
    return result.data
  }

  throw new Error(result.error)
}

export const backupService = {
  backup: async (): Promise<string> => {
    return unwrap(await window.api.backup.backup())
  },

  restore: async (filePath?: string): Promise<RestoreResult> => {
    return unwrap(await window.api.backup.restore(filePath))
  },

  info: async (): Promise<BackupInfo | null> => {
    const result = await window.api.backup.info()

    if (!result.success) {
      throw new Error(result.error)
    }

    if (!result.data.exists) {
      return null
    }

    return result.data
  },

  validate: async (filePath: string): Promise<ValidationInfo> => {
    return unwrap(await window.api.backup.validate(filePath))
  },
}

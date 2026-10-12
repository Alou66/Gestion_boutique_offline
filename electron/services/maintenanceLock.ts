import { EventEmitter } from 'node:events'

let acquireCount = 0
let maintenanceMode = false
const ee = new EventEmitter()

export interface MaintenanceLockHandle {
  release(): void
}

export const maintenanceLock = {
  /**
   * Acquires a shared lock for backup operations.
   * Multiple backups can run concurrently, but maintenance (restore) blocks new backups.
   * Returns a handle that must be released.
   */
  acquireForBackup(): MaintenanceLockHandle {
    if (maintenanceMode) {
      throw new Error('Maintenance in progress: backup not allowed')
    }
    acquireCount++
    return {
      release() {
        acquireCount--
        if (acquireCount <= 0) {
          ee.emit('unlocked')
        }
      },
    }
  },

  /**
   * Acquires an exclusive lock for maintenance (restore).
   * Sets maintenance mode, which blocks all new write operations.
   * Waits for any in-flight transaction to complete before returning.
   * Returns a handle that must be released (clears maintenance mode).
   */
  async acquireForMaintenance(
    db: { inTransaction: boolean },
    timeoutMs = 30_000
  ): Promise<MaintenanceLockHandle> {
    if (maintenanceMode) {
      throw new Error('Maintenance already in progress')
    }

    maintenanceMode = true

    try {
      if (db.inTransaction) {
        await waitForTransactionEnd(db, timeoutMs)
      }
    } catch (error) {
      maintenanceMode = false
      throw error
    }

    return {
      release(): void {
        maintenanceMode = false
        acquireCount = 0
        ee.emit('unlocked')
      },
    }
  },

  /**
   * Checks if maintenance mode is active (restore in progress).
   * Write operations should check this and refuse to start.
   */
  isMaintenanceMode(): boolean {
    return maintenanceMode
  },

  /**
   * Checks if any lock is held (backup or maintenance).
   * Used by backup to know if it should wait.
   */
  isLocked(): boolean {
    return acquireCount > 0 || maintenanceMode
  },

  /**
   * Waits for all locks to be released, up to timeoutMs.
   * Returns true if idle, false on timeout.
   */
  waitForIdle(timeoutMs = 10_000): Promise<boolean> {
    if (acquireCount === 0 && !maintenanceMode) return Promise.resolve(true)

    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs)
      ee.once('unlocked', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  },
}

/**
 * Waits for the current transaction to end (inTransaction becomes false).
 * Since better-sqlite3 is synchronous, a transaction can only be open
 * from the current call stack. This waits for the caller to finish.
 */
async function waitForTransactionEnd(
  db: { inTransaction: boolean },
  timeoutMs: number
): Promise<void> {
  if (!db.inTransaction) return

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Transaction did not complete in time'))
    }, timeoutMs)

    const checkInterval = setInterval(() => {
      if (!db.inTransaction) {
        clearInterval(checkInterval)
        clearTimeout(timer)
        resolve()
      }
    }, 10)
  })
}
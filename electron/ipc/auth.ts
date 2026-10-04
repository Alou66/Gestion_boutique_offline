import { ipcMain } from 'electron'
import {
  AUTH_ERRORS,
  getAuthStatus,
  login,
  logout,
  setupAccount,
} from '../services/authService'
import type { AuthCredentials, AuthSetupInput, AuthResult } from '../types'

function toFailure(error: unknown, fallback: string): AuthResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
  }
}

export function registerAuthIpcHandlers(): void {
  ipcMain.handle('auth:status', () => {
    return getAuthStatus()
  })

  ipcMain.handle('auth:setup', (_event, input: AuthSetupInput): AuthResult => {
    try {
      return { success: true, user: setupAccount(input) }
    } catch (error) {
      return toFailure(error, AUTH_ERRORS.invalidInput)
    }
  })

  ipcMain.handle('auth:login', (_event, credentials: AuthCredentials): AuthResult => {
    try {
      const user = login(credentials)
      if (!user) {
        return { success: false, error: AUTH_ERRORS.invalidCredentials }
      }
      return { success: true, user }
    } catch (error) {
      return toFailure(error, AUTH_ERRORS.invalidCredentials)
    }
  })

  ipcMain.handle('auth:logout', () => {
    logout()
    return true
  })
}
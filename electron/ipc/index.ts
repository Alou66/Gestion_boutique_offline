import { ipcMain } from 'electron'
import {
  getDatabaseStatus,
  getSettings,
  saveSettings,
} from '../services/databaseService'
import { registerAuthIpcHandlers } from './auth'
import { registerCategoryIpcHandlers } from './categories'
import { registerClientIpcHandlers } from './clients'
import { registerInvoiceIpcHandlers } from './invoices'
import { registerPrintIpcHandlers } from './print'
import { registerProductIpcHandlers } from './products'
import { registerStockIpcHandlers } from './stock'
import { registerSupplyIpcHandlers } from './supplies'
import { registerTransformationIpcHandlers } from './transformations'
import type { SettingsInput } from '../types'

export function registerIpcHandlers(): void {
  ipcMain.handle('database:status', () => {
    try {
      return getDatabaseStatus()
    } catch {
      return { connected: false, initialized: false, version: 'unknown' }
    }
  })

  ipcMain.handle('settings:get', () => {
    return getSettings()
  })

  ipcMain.handle('settings:save', (_event, input: SettingsInput) => {
    return saveSettings(input)
  })

  registerAuthIpcHandlers()
  registerCategoryIpcHandlers()
  registerProductIpcHandlers()
  registerStockIpcHandlers()
  registerSupplyIpcHandlers()
  registerTransformationIpcHandlers()
  registerClientIpcHandlers()
  registerInvoiceIpcHandlers()
  registerPrintIpcHandlers()
}
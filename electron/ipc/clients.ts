import { ipcMain } from 'electron'
import {
  CLIENT_ERRORS,
  ClientError,
  createClient,
  getClientById,
  listClients,
  updateClient,
  setClientActive,
  isNameAvailable,
  isPhoneAvailable,
  ensureSystemClient,
} from '../services/clientService'
import type {
  Client,
  ClientFilters,
  ClientInput,
  ClientResult,
  ClientUpdateInput,
} from '../types'

function toSuccess<T>(data: T): ClientResult<T> {
  return { success: true, data }
}

function toFailure<T>(error: unknown, fallback: string): ClientResult<T> {
  if (error instanceof ClientError) {
    return { success: false, error: error.message }
  }

  console.error('[clients] Unexpected error:', error)
  return { success: false, error: fallback }
}

export function registerClientIpcHandlers(): void {
  ipcMain.handle('clients:list', (_event, filters?: ClientFilters): ClientResult<Client[]> => {
    try {
      return toSuccess(listClients(filters ?? {}))
    } catch (error) {
      return toFailure(error, CLIENT_ERRORS.unexpected)
    }
  })

  ipcMain.handle('clients:get', (_event, id: number): ClientResult<Client | null> => {
    try {
      return toSuccess(getClientById(id))
    } catch (error) {
      return toFailure(error, CLIENT_ERRORS.unexpected)
    }
  })

  ipcMain.handle(
    'clients:create',
    (_event, input: ClientInput): ClientResult<Client> => {
      try {
        return toSuccess(createClient(input))
      } catch (error) {
        return toFailure(error, CLIENT_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'clients:update',
    (_event, id: number, input: ClientUpdateInput): ClientResult<Client> => {
      try {
        return toSuccess(updateClient(id, input))
      } catch (error) {
        return toFailure(error, CLIENT_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'clients:set-active',
    (_event, id: number, isActive: boolean): ClientResult<Client> => {
      try {
        return toSuccess(setClientActive(id, isActive))
      } catch (error) {
        return toFailure(error, CLIENT_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'clients:is-name-available',
    (_event, name: string, excludeClientId?: number): ClientResult<boolean> => {
      try {
        return toSuccess(isNameAvailable(name, excludeClientId))
      } catch (error) {
        return toFailure(error, CLIENT_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'clients:is-phone-available',
    (_event, phone: string, excludeClientId?: number): ClientResult<boolean> => {
      try {
        return toSuccess(isPhoneAvailable(phone, excludeClientId))
      } catch (error) {
        return toFailure(error, CLIENT_ERRORS.unexpected)
      }
    },
  )

  // Ensure system client exists on startup
  ipcMain.handle('clients:ensure-system', (): ClientResult<Client> => {
    try {
      return toSuccess(ensureSystemClient())
    } catch (error) {
      return toFailure(error, CLIENT_ERRORS.unexpected)
    }
  })
}
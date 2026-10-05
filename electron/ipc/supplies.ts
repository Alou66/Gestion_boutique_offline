import { ipcMain } from 'electron'
import {
  createSupply,
  getSupplyById,
  getSupplyByReference,
  listSupplies,
  SUPPLY_ERRORS,
  SupplyError,
} from '../services/supplyService'
import type {
  Supply,
  SupplyCreateInput,
  SupplyDetail,
  SupplyFilters,
  SupplyResult,
} from '../types'

function toSuccess<T>(data: T): SupplyResult<T> {
  return { success: true, data }
}

function toFailure<T>(error: unknown, fallback: string): SupplyResult<T> {
  if (error instanceof SupplyError) {
    return { success: false, error: error.message }
  }

  console.error('[supplies] Unexpected error:', error)
  return { success: false, error: fallback }
}

/**
 * A supply is only ever created and read: there is no update channel and no
 * delete channel, so a validated document stays immutable from the renderer.
 */
export function registerSupplyIpcHandlers(): void {
  ipcMain.handle(
    'supplies:list',
    (_event, filters?: SupplyFilters): SupplyResult<Supply[]> => {
      try {
        return toSuccess(listSupplies(filters ?? {}))
      } catch (error) {
        return toFailure(error, SUPPLY_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'supplies:get',
    (_event, id: number): SupplyResult<SupplyDetail> => {
      try {
        return toSuccess(getSupplyById(id))
      } catch (error) {
        return toFailure(error, SUPPLY_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'supplies:get-by-reference',
    (_event, reference: string): SupplyResult<SupplyDetail> => {
      try {
        return toSuccess(getSupplyByReference(reference))
      } catch (error) {
        return toFailure(error, SUPPLY_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'supplies:create',
    (_event, input: SupplyCreateInput): SupplyResult<SupplyDetail> => {
      try {
        return toSuccess(createSupply(input))
      } catch (error) {
        return toFailure(error, SUPPLY_ERRORS.unexpected)
      }
    },
  )
}

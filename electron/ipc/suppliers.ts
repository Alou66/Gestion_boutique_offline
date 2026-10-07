import { ipcMain } from 'electron'
import {
  SUPPLIER_ERRORS,
  SupplierError,
  createSupplier,
  getSupplierById,
  isNameAvailable,
  isPhoneAvailable,
  listSuppliers,
  setSupplierActive,
  updateSupplier,
  ensureSystemSupplier,
} from '../services/supplierService'
import type {
  Supplier,
  SupplierFilters,
  SupplierInput,
  SupplierResult,
  SupplierUpdateInput,
} from '../types'

function toSuccess<T>(data: T): SupplierResult<T> {
  return { success: true, data }
}

function toFailure<T>(error: unknown, fallback: string): SupplierResult<T> {
  if (error instanceof SupplierError) {
    return { success: false, error: error.message }
  }

  console.error('[suppliers] Unexpected error:', error)
  return { success: false, error: fallback }
}

export function registerSupplierIpcHandlers(): void {
  ipcMain.handle('suppliers:list', (_event, filters?: SupplierFilters): SupplierResult<Supplier[]> => {
    try {
      return toSuccess(listSuppliers(filters ?? {}))
    } catch (error) {
      return toFailure(error, SUPPLIER_ERRORS.unexpected)
    }
  })

  ipcMain.handle('suppliers:get', (_event, id: number): SupplierResult<Supplier | null> => {
    try {
      return toSuccess(getSupplierById(id))
    } catch (error) {
      return toFailure(error, SUPPLIER_ERRORS.unexpected)
    }
  })

  ipcMain.handle(
    'suppliers:create',
    (_event, input: SupplierInput): SupplierResult<Supplier> => {
      try {
        return toSuccess(createSupplier(input))
      } catch (error) {
        return toFailure(error, SUPPLIER_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'suppliers:update',
    (_event, id: number, input: SupplierUpdateInput): SupplierResult<Supplier> => {
      try {
        return toSuccess(updateSupplier(id, input))
      } catch (error) {
        return toFailure(error, SUPPLIER_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'suppliers:set-active',
    (_event, id: number, isActive: boolean): SupplierResult<Supplier> => {
      try {
        return toSuccess(setSupplierActive(id, isActive))
      } catch (error) {
        return toFailure(error, SUPPLIER_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'suppliers:is-name-available',
    (_event, name: string, excludeSupplierId?: number): SupplierResult<boolean> => {
      try {
        return toSuccess(isNameAvailable(name, excludeSupplierId))
      } catch (error) {
        return toFailure(error, SUPPLIER_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'suppliers:is-phone-available',
    (_event, phone: string, excludeSupplierId?: number): SupplierResult<boolean> => {
      try {
        return toSuccess(isPhoneAvailable(phone, excludeSupplierId))
      } catch (error) {
        return toFailure(error, SUPPLIER_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle('suppliers:ensure-system', (): SupplierResult<Supplier> => {
    try {
      return toSuccess(ensureSystemSupplier())
    } catch (error) {
      return toFailure(error, SUPPLIER_ERRORS.unexpected)
    }
  })
}

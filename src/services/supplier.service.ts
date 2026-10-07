import type {
  Supplier,
  SupplierFilters,
  SupplierInput,
  SupplierResult,
  SupplierUpdateInput,
} from '../types'

function unwrap<T>(result: SupplierResult<T>): T {
  if (result.success) {
    return result.data
  }

  throw new Error(result.error)
}

export const supplierService = {
  list: async (filters?: SupplierFilters): Promise<Supplier[]> => {
    return unwrap(await window.api.suppliers.list(filters))
  },
  get: async (id: number): Promise<Supplier | null> => {
    return unwrap(await window.api.suppliers.get(id))
  },
  create: async (input: SupplierInput): Promise<Supplier> => {
    return unwrap(await window.api.suppliers.create(input))
  },
  update: async (id: number, input: SupplierUpdateInput): Promise<Supplier> => {
    return unwrap(await window.api.suppliers.update(id, input))
  },
  setActive: async (id: number, isActive: boolean): Promise<Supplier> => {
    return unwrap(await window.api.suppliers.setActive(id, isActive))
  },
  isNameAvailable: async (name: string, excludeSupplierId?: number): Promise<boolean> => {
    return unwrap(await window.api.suppliers.isNameAvailable(name, excludeSupplierId))
  },
  isPhoneAvailable: async (phone: string, excludeSupplierId?: number): Promise<boolean> => {
    return unwrap(await window.api.suppliers.isPhoneAvailable(phone, excludeSupplierId))
  },
  ensureSystem: async (): Promise<Supplier> => {
    return unwrap(await window.api.suppliers.ensureSystem())
  },
}

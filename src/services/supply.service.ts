import type {
  Supply,
  SupplyCreateInput,
  SupplyDetail,
  SupplyFilters,
  SupplyResult,
} from '../types'

function unwrap<T>(result: SupplyResult<T>): T {
  if (result.success) {
    return result.data
  }

  throw new Error(result.error)
}

export const supplyService = {
  list: async (filters?: SupplyFilters): Promise<Supply[]> => {
    return unwrap(await window.api.supplies.list(filters))
  },
  get: async (id: number): Promise<SupplyDetail> => {
    return unwrap(await window.api.supplies.get(id))
  },
  getByReference: async (reference: string): Promise<SupplyDetail> => {
    return unwrap(await window.api.supplies.getByReference(reference))
  },
  create: async (input: SupplyCreateInput): Promise<SupplyDetail> => {
    return unwrap(await window.api.supplies.create(input))
  },
}

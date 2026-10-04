import type {
  StockAdjustInput,
  StockAdjustResult,
  StockFilters,
  StockFormLevel,
  StockInitializeInput,
  StockMovement,
  StockResult,
} from '../types'

function unwrap<T>(result: StockResult<T>): T {
  if (result.success) {
    return result.data
  }

  throw new Error(result.error)
}

export const stockService = {
  list: async (filters?: StockFilters): Promise<StockFormLevel[]> => {
    return unwrap(await window.api.stock.list(filters))
  },
  get: async (productId: number): Promise<StockFormLevel[]> => {
    return unwrap(await window.api.stock.get(productId))
  },
  getForm: async (productId: number, form: string): Promise<StockFormLevel> => {
    return unwrap(await window.api.stock.getForm(productId, form))
  },
  initialize: async (
    productId: number,
    input: StockInitializeInput,
  ): Promise<StockFormLevel[]> => {
    return unwrap(await window.api.stock.initialize(productId, input))
  },
  adjust: async (
    productId: number,
    input: StockAdjustInput,
  ): Promise<StockAdjustResult> => {
    return unwrap(await window.api.stock.adjust(productId, input))
  },
  movements: async (productId: number): Promise<StockMovement[]> => {
    return unwrap(await window.api.stock.movements(productId))
  },
}
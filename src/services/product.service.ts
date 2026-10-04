import type {
  Product,
  ProductFilters,
  ProductInput,
  ProductResult,
  ProductUpdateInput,
} from '../types'

function unwrap<T>(result: ProductResult<T>): T {
  if (result.success) {
    return result.data
  }

  throw new Error(result.error)
}

export const productService = {
  list: async (filters?: ProductFilters): Promise<Product[]> => {
    return unwrap(await window.api.products.list(filters))
  },
  get: async (id: number): Promise<Product> => {
    return unwrap(await window.api.products.get(id))
  },
  create: async (input: ProductInput): Promise<Product> => {
    return unwrap(await window.api.products.create(input))
  },
  update: async (id: number, input: ProductUpdateInput): Promise<Product> => {
    return unwrap(await window.api.products.update(id, input))
  },
  setActive: async (id: number, isActive: boolean): Promise<Product> => {
    return unwrap(await window.api.products.setActive(id, isActive))
  },
}

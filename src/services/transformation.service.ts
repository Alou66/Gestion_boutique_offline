import type {
  Product,
  Transformation,
  TransformationCreateInput,
  TransformationDetail,
  TransformationFilters,
  TransformationResult,
} from '../types'

function unwrap<T>(result: TransformationResult<T>): T {
  if (result.success) {
    return result.data
  }

  throw new Error(result.error)
}

export const transformationService = {
  listProducts: async (): Promise<Product[]> => {
    return unwrap(await window.api.transformations.listProducts())
  },
  list: async (filters?: TransformationFilters): Promise<Transformation[]> => {
    return unwrap(await window.api.transformations.list(filters))
  },
  get: async (id: number): Promise<TransformationDetail> => {
    return unwrap(await window.api.transformations.get(id))
  },
  getByReference: async (reference: string): Promise<TransformationDetail> => {
    return unwrap(await window.api.transformations.getByReference(reference))
  },
  create: async (input: TransformationCreateInput): Promise<TransformationDetail> => {
    return unwrap(await window.api.transformations.create(input))
  },
}
import type {
  Category,
  CategoryInput,
  CategoryResult,
  CategoryUpdateInput,
} from '../types'

function unwrap<T>(result: CategoryResult<T>): T {
  if (result.success) {
    return result.data
  }

  throw new Error(result.error)
}

export const categoryService = {
  list: async (): Promise<Category[]> => {
    return unwrap(await window.api.categories.list())
  },
  get: async (id: number): Promise<Category | null> => {
    return unwrap(await window.api.categories.get(id))
  },
  create: async (input: CategoryInput): Promise<Category> => {
    return unwrap(await window.api.categories.create(input))
  },
  update: async (id: number, input: CategoryUpdateInput): Promise<Category> => {
    return unwrap(await window.api.categories.update(id, input))
  },
  delete: async (id: number): Promise<void> => {
    unwrap(await window.api.categories.delete(id))
  },
  isNameAvailable: async (name: string, excludeId?: number): Promise<boolean> => {
    return unwrap(await window.api.categories.isNameAvailable(name, excludeId))
  },
}

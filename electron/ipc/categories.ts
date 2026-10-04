import { ipcMain } from 'electron'
import {
  CATEGORY_ERRORS,
  CategoryError,
  createCategory,
  deleteCategory,
  getCategoryById,
  listCategories,
  updateCategory,
} from '../services/categoryService'
import type {
  Category,
  CategoryInput,
  CategoryResult,
  CategoryUpdateInput,
} from '../types'

function toSuccess<T>(data: T): CategoryResult<T> {
  return { success: true, data }
}

function toFailure<T>(error: unknown, fallback: string): CategoryResult<T> {
  if (error instanceof CategoryError) {
    return { success: false, error: error.message }
  }

  console.error('[categories] Unexpected error:', error)
  return { success: false, error: fallback }
}

export function registerCategoryIpcHandlers(): void {
  ipcMain.handle('categories:list', (): CategoryResult<Category[]> => {
    try {
      return toSuccess(listCategories())
    } catch (error) {
      return toFailure(error, CATEGORY_ERRORS.unexpected)
    }
  })

  ipcMain.handle(
    'categories:get',
    (_event, id: number): CategoryResult<Category | null> => {
      try {
        return toSuccess(getCategoryById(id))
      } catch (error) {
        return toFailure(error, CATEGORY_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'categories:create',
    (_event, input: CategoryInput): CategoryResult<Category> => {
      try {
        return toSuccess(createCategory(input))
      } catch (error) {
        return toFailure(error, CATEGORY_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'categories:update',
    (_event, id: number, input: CategoryUpdateInput): CategoryResult<Category> => {
      try {
        return toSuccess(updateCategory(id, input))
      } catch (error) {
        return toFailure(error, CATEGORY_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'categories:delete',
    (_event, id: number): CategoryResult<null> => {
      try {
        return toSuccess(deleteCategory(id))
      } catch (error) {
        return toFailure(error, CATEGORY_ERRORS.unexpected)
      }
    },
  )
}

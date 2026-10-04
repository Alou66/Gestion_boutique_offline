import { ipcMain } from 'electron'
import {
  PRODUCT_ERRORS,
  createProduct,
  getProductById,
  listProducts,
  ProductError,
  setProductActive,
  updateProduct,
} from '../services/productService'
import type {
  Product,
  ProductFilters,
  ProductInput,
  ProductResult,
  ProductUpdateInput,
} from '../types'

function toSuccess<T>(data: T): ProductResult<T> {
  return { success: true, data }
}

function toFailure<T>(error: unknown, fallback: string): ProductResult<T> {
  if (error instanceof ProductError) {
    return { success: false, error: error.message }
  }

  console.error('[products] Unexpected error:', error)
  return { success: false, error: fallback }
}

export function registerProductIpcHandlers(): void {
  ipcMain.handle('products:list', (_event, filters?: ProductFilters): ProductResult<Product[]> => {
    try {
      return toSuccess(listProducts(filters ?? {}))
    } catch (error) {
      return toFailure(error, PRODUCT_ERRORS.unexpected)
    }
  })

  ipcMain.handle('products:get', (_event, id: number): ProductResult<Product> => {
    try {
      return toSuccess(getProductById(id))
    } catch (error) {
      return toFailure(error, PRODUCT_ERRORS.unexpected)
    }
  })

  ipcMain.handle(
    'products:create',
    (_event, input: ProductInput): ProductResult<Product> => {
      try {
        return toSuccess(createProduct(input))
      } catch (error) {
        return toFailure(error, PRODUCT_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'products:update',
    (_event, id: number, input: ProductUpdateInput): ProductResult<Product> => {
      try {
        return toSuccess(updateProduct(id, input))
      } catch (error) {
        return toFailure(error, PRODUCT_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'products:set-active',
    (_event, id: number, isActive: boolean): ProductResult<Product> => {
      try {
        return toSuccess(setProductActive(id, isActive))
      } catch (error) {
        return toFailure(error, PRODUCT_ERRORS.unexpected)
      }
    },
  )
}

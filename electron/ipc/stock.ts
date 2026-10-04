import { ipcMain } from 'electron'
import {
  adjustStock,
  getProductFormStock,
  getProductStock,
  initializeStock,
  listProductMovements,
  listStocks,
  STOCK_ERRORS,
  StockError,
} from '../services/stockService'
import type {
  StockAdjustInput,
  StockAdjustResult,
  StockFilters,
  StockFormLevel,
  StockInitializeInput,
  StockMovement,
  StockResult,
} from '../types'

function toSuccess<T>(data: T): StockResult<T> {
  return { success: true, data }
}

function toFailure<T>(error: unknown, fallback: string): StockResult<T> {
  if (error instanceof StockError) {
    return { success: false, error: error.message }
  }

  console.error('[stock] Unexpected error:', error)
  return { success: false, error: fallback }
}

export function registerStockIpcHandlers(): void {
  ipcMain.handle(
    'stock:list',
    (_event, filters?: StockFilters): StockResult<StockFormLevel[]> => {
      try {
        return toSuccess(listStocks(filters ?? {}))
      } catch (error) {
        return toFailure(error, STOCK_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'stock:get',
    (_event, productId: number): StockResult<StockFormLevel[]> => {
      try {
        return toSuccess(getProductStock(productId))
      } catch (error) {
        return toFailure(error, STOCK_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'stock:get-form',
    (_event, productId: number, form: string): StockResult<StockFormLevel> => {
      try {
        return toSuccess(getProductFormStock(productId, form))
      } catch (error) {
        return toFailure(error, STOCK_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'stock:initialize',
    (
      _event,
      productId: number,
      input: StockInitializeInput,
    ): StockResult<StockFormLevel[]> => {
      try {
        return toSuccess(initializeStock(productId, input))
      } catch (error) {
        return toFailure(error, STOCK_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'stock:adjust',
    (
      _event,
      productId: number,
      input: StockAdjustInput,
    ): StockResult<StockAdjustResult> => {
      try {
        return toSuccess(adjustStock(productId, input))
      } catch (error) {
        return toFailure(error, STOCK_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'stock:movements',
    (_event, productId: number): StockResult<StockMovement[]> => {
      try {
        return toSuccess(listProductMovements(productId))
      } catch (error) {
        return toFailure(error, STOCK_ERRORS.unexpected)
      }
    },
  )
}

import { ipcMain } from 'electron'
import {
  createTransformation,
  getTransformationById,
  getTransformationByReference,
  listTransformableProducts,
  listTransformations,
  TRANSFORMATION_ERRORS,
  TransformationError,
} from '../services/transformationService'
import type {
  Product,
  Transformation,
  TransformationCreateInput,
  TransformationDetail,
  TransformationFilters,
  TransformationResult,
} from '../types'

function toSuccess<T>(data: T): TransformationResult<T> {
  return { success: true, data }
}

function toFailure<T>(error: unknown, fallback: string): TransformationResult<T> {
  if (error instanceof TransformationError) {
    return { success: false, error: error.message }
  }

  console.error('[transformations] Unexpected error:', error)
  return { success: false, error: fallback }
}

/**
 * A transformation is only ever created and read: there is no update channel and
 * no delete channel, so a validated document stays immutable from the renderer.
 */
export function registerTransformationIpcHandlers(): void {
  ipcMain.handle(
    'transformations:list-products',
    (): TransformationResult<Product[]> => {
      try {
        return toSuccess(listTransformableProducts())
      } catch (error) {
        return toFailure(error, TRANSFORMATION_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'transformations:list',
    (_event, filters?: TransformationFilters): TransformationResult<Transformation[]> => {
      try {
        return toSuccess(listTransformations(filters ?? {}))
      } catch (error) {
        return toFailure(error, TRANSFORMATION_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'transformations:get',
    (_event, id: number): TransformationResult<TransformationDetail> => {
      try {
        return toSuccess(getTransformationById(id))
      } catch (error) {
        return toFailure(error, TRANSFORMATION_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'transformations:get-by-reference',
    (_event, reference: string): TransformationResult<TransformationDetail> => {
      try {
        return toSuccess(getTransformationByReference(reference))
      } catch (error) {
        return toFailure(error, TRANSFORMATION_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'transformations:create',
    (_event, input: TransformationCreateInput): TransformationResult<TransformationDetail> => {
      try {
        return toSuccess(createTransformation(input))
      } catch (error) {
        return toFailure(error, TRANSFORMATION_ERRORS.unexpected)
      }
    },
  )
}
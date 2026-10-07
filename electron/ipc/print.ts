import { ipcMain } from 'electron'
import {
  exportHtmlDocumentToPdf,
  PRINT_ERRORS,
  PrintError,
  previewHtmlDocument,
  printHtmlDocument,
} from '../services/printService'
import type { PrintPdfResult, PrintRequest, PrintResult } from '../types'

function toSuccess<T>(data: T): PrintResult<T> {
  return { success: true, data }
}

function toFailure<T>(error: unknown, fallback: string): PrintResult<T> {
  if (error instanceof PrintError) {
    return { success: false, error: error.message }
  }

  console.error('[print] Unexpected error:', error)

  return { success: false, error: fallback }
}

/**
 * Impression channels. They are as thin as the other modules: they read the
 * printable document, call `printService` and wrap the outcome in the
 * `{ success, data | error }` envelope. A cancelled save dialog is not an error:
 * it answers `{ success: true, data: { path: null } }`.
 */
export function registerPrintIpcHandlers(): void {
  ipcMain.handle(
    'print:html',
    async (_event, request: PrintRequest): Promise<PrintResult<null>> => {
      try {
        await printHtmlDocument(request?.html, request?.title)

        return toSuccess<null>(null)
      } catch (error) {
        return toFailure(error, PRINT_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'print:pdf',
    async (_event, request: PrintRequest): Promise<PrintPdfResult> => {
      try {
        return toSuccess({ path: await exportHtmlDocumentToPdf(request?.html, request?.title) })
      } catch (error) {
        return toFailure(error, PRINT_ERRORS.unexpected)
      }
    },
  )

  /**
   * Opens a visible preview window. The shopkeeper inspects the document and
   * closes it themselves: the preview is a real stop, not an automatic step of
   * the print or PDF flow.
   */
  ipcMain.handle(
    'print:preview',
    async (_event, request: PrintRequest): Promise<PrintResult<null>> => {
      try {
        await previewHtmlDocument(request?.html, request?.title)

        return toSuccess<null>(null)
      } catch (error) {
        return toFailure(error, PRINT_ERRORS.unexpected)
      }
    },
  )
}
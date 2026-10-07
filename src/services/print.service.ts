import type { PrintPdfResult, PrintResult } from '../types'

function unwrap<T>(result: PrintResult<T>): T {
  if (result.success) {
    return result.data
  }

  throw new Error(result.error)
}

/**
 * Renderer access layer of the native printing. The React code only builds the
 * HTML of the document: `window.print` never reaches `window.api.print` with
 * Node, Electron or a file path, exactly like every other renderer service.
 */
export const printService = {
  /** Opens the system print dialog on the document. */
  print: async (html: string, title: string): Promise<void> => {
    unwrap(await window.api.print.print({ html, title }))
  },
  /**
   * Generates the PDF offline and asks where to save it. Returns null when the
   * shopkeeper cancelled the save dialog: no error, no file.
   */
  savePdf: async (html: string, title: string): Promise<string | null> => {
    const result: PrintPdfResult = await window.api.print.savePdf({ html, title })
    return unwrap(result).path
  },
  /**
   * Opens a visible preview window so the shopkeeper can inspect the document
   * before printing or downloading it. The preview is a real stop: the
   * shopkeeper closes it themselves, nothing is printed or saved.
   */
  preview: async (html: string, title: string): Promise<void> => {
    unwrap(await window.api.print.preview({ html, title }))
  },
}
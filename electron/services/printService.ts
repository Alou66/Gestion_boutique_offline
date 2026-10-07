import { BrowserWindow, dialog } from 'electron'
import fs from 'node:fs/promises'

/**
 * Impression et PDF des documents de l'application (facture VTE-000001).
 *
 * Le renderer ne construit que le HTML de la facture : ce service ne connaît
 * aucune règle métier, il ne fait qu'imprimer ou convertir une page HTML, hors
 * ligne, avec le moteur Chromium déjà présent dans Electron.
 *
 * Aucun paquet supplémentaire n'est nécessaire : `webContents.printToPDF` est
 * un moteur PDF natif, il n'y a donc aucune dépendance à installer ni aucun
 * accès réseau.
 */

export const PRINT_ERRORS = {
  emptyDocument: "Le document à imprimer est vide.",
  documentTooLarge: 'Le document à imprimer est trop volumineux.',
  windowFailed: "La fenêtre d'impression n'a pas pu être ouverte.",
  printFailed: "La facture n'a pas pu être imprimée.",
  pdfFailed: "Le PDF de la facture n'a pas pu être généré.",
  saveFailed: "Le fichier PDF n'a pas pu être enregistré.",
  unexpected: "Une erreur inattendue est survenue.",
} as const

export type PrintErrorCode = keyof typeof PRINT_ERRORS

export class PrintError extends Error {
  readonly code: PrintErrorCode

  constructor(code: PrintErrorCode) {
    super(PRINT_ERRORS[code])
    this.name = 'PrintError'
    this.code = code
  }
}

/** A4 margins, in inches, applied when the document has no print CSS of its own. */
const PDF_MARGINS = { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } as const

/** Above this size the document is refused instead of being loaded. */
export const PRINT_DOCUMENT_MAX_LENGTH = 8_000_000

/** A printable document is a non empty HTML page, not an arbitrary string. */
export function assertPrintableDocument(html: unknown): string {
  if (typeof html !== 'string' || html.trim() === '') {
    throw new PrintError('emptyDocument')
  }

  if (html.length > PRINT_DOCUMENT_MAX_LENGTH) {
    throw new PrintError('documentTooLarge')
  }

  return html
}

/**
 * The document is loaded from a `data:` URL: the hidden window never reads a
 * file and never requests anything, which is what makes printing and PDF work
 * completely offline.
 */
export function buildDocumentUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/** Keeps only the last segment and drops the characters Windows forbids. */
export function sanitizePdfFileName(title: string): string {
  const base = String(title ?? '')
    .split(/[\\/]+/)
    .filter(Boolean)
    .pop() ?? 'facture'

  const safe = base.replace(/[:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()

  return safe === '' ? 'facture' : safe
}

/**
 * A hidden window sized like a sheet of A4 landscape: the document
 * is laid out by Chromium only, exactly like a printed sheet of
 * paper, with its two invoice copies side by side.
 */
function createDocumentWindow(title: string): BrowserWindow {
  return new BrowserWindow({
    show: false,
    title,
    width: 1123,
    height: 794,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    },
  })
}

/**
 * A visible preview window, sized like an A4 landscape sheet: the shopkeeper
 * inspects the document before printing or downloading it. The window owns its
 * own print and close buttons, so the preview is a real stop on its own.
 */
function createPreviewWindow(title: string): BrowserWindow {
  return new BrowserWindow({
    title,
    width: 1180,
    height: 860,
    backgroundColor: '#f1f5f9',
    webPreferences: {
      javascript: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    },
  })
}

function closeDocumentWindow(window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    window.destroy()
  }
}

/**
 * `webContents.print` answers either through its callback or through the
 * promise it now returns: both are handled, so the print flow never waits
 * forever on a version that dropped the callback.
 */
function printWebContents(webContents: Electron.WebContents): Promise<boolean> {
  return new Promise((resolve) => {
    // The invoice document is an A4 landscape sheet: the dialog opens
    // in landscape, matching the `@page` rule of the document.
    const options = { silent: false, printBackground: true, landscape: true }
    const legacyPrint = webContents.print as unknown as (
      printOptions: typeof options,
      callback: (success: boolean) => void,
    ) => Promise<boolean> | void
    const pending = legacyPrint.call(webContents, options, (success) => resolve(success))

    if (pending && typeof pending.then === 'function') {
      pending.then(resolve, () => resolve(false))
    }
  })
}

async function openDocumentWindow(html: string, title: string): Promise<BrowserWindow> {
  const window = createDocumentWindow(title)

  try {
    await window.loadURL(buildDocumentUrl(html))

    return window
  } catch {
    closeDocumentWindow(window)

    throw new PrintError('windowFailed')
  }
}

/** Every business failure keeps its readable message, anything else is logged. */
export function toPrintFailure(error: unknown, fallback: PrintErrorCode): PrintError {
  if (error instanceof PrintError) {
    return error
  }

  console.error('[print] Unexpected error:', error)

  return new PrintError(fallback)
}

/**
 * Prints the document through the system print dialog. Returns nothing: the
 * shopkeeper owns the printer, the paper and the number of copies.
 */
export async function printHtmlDocument(html: string, title = 'Document'): Promise<void> {
  const document = assertPrintableDocument(html)
  const window = await openDocumentWindow(document, title)

  try {
    const printed = await printWebContents(window.webContents)

    if (!printed) {
      throw new PrintError('printFailed')
    }
  } catch (error) {
    throw toPrintFailure(error, 'printFailed')
  } finally {
    closeDocumentWindow(window)
  }
}

/**
 * Opens a visible preview window so the shopkeeper can inspect the document
 * before printing or downloading it. The window keeps its own print button and
 * is closed by the shopkeeper when they are done: the preview is a real stop,
 * not an automatic step of the print or PDF flow.
 */
export async function previewHtmlDocument(html: string, title = 'Document'): Promise<void> {
  const document = assertPrintableDocument(html)
  const window = createPreviewWindow(title)

  try {
    await window.loadURL(buildDocumentUrl(document))
  } catch {
    closeDocumentWindow(window)

    throw new PrintError('windowFailed')
  }
}

/**
 * Generates the PDF of the document offline, then asks the shopkeeper where to
 * store it. Returns null when the save dialog was cancelled: a cancellation is
 * not an error and never leaves a file behind.
 */
export async function exportHtmlDocumentToPdf(
  html: string,
  title = 'Document',
): Promise<string | null> {
  const document = assertPrintableDocument(html)
  const window = await openDocumentWindow(document, title)

  try {
    let pdf: Buffer

    try {
      pdf = await window.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        landscape: true,
        margins: PDF_MARGINS,
      })
    } catch (error) {
      throw toPrintFailure(error, 'pdfFailed')
    }

    try {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Télécharger PDF',
        defaultPath: `${sanitizePdfFileName(title)}.pdf`,
        filters: [{ name: 'Document PDF', extensions: ['pdf'] }],
      })

      if (canceled || !filePath) {
        return null
      }

      await fs.writeFile(filePath, pdf)

      return filePath
    } catch (error) {
      throw toPrintFailure(error, 'saveFailed')
    }
  } finally {
    closeDocumentWindow(window)
  }
}

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { before, beforeEach, describe, it } from 'node:test'
import { registerIpcHandlers } from '../electron/ipc'
import {
  assertPrintableDocument,
  buildDocumentUrl,
  PRINT_ERRORS,
  PrintError,
  sanitizePdfFileName,
} from '../electron/services/printService'
import type { PrintResult } from '../electron/types'
import {
  invokeHandler,
  printStubs,
  registeredChannels,
  resetPrintStubs,
} from './stubs/electron'

/**
 * The preload bridge is imported so the test can inspect what the renderer is
 * offered for printing: nothing else than two async methods.
 */
import '../electron/preload'
import { exposedToMainWorld } from './stubs/electron'

const PRINT_CHANNELS = ['print:html', 'print:pdf']

/** A complete invoice page, as the renderer builds it. */
const INVOICE_HTML = `<!DOCTYPE html><html><head><title>Facture VTE-000001</title></head><body><p>25 000 FCFA</p></body></html>`

function invoke<T>(channel: string, request: unknown): Promise<PrintResult<T>> {
  return Promise.resolve(invokeHandler(channel, request) as PrintResult<T>)
}

function expectFailure<T>(result: PrintResult<T>): string {
  assert.equal(result.success, false, 'the handler must answer an explicit error')

  return result.success ? '' : result.error
}

function tempFile(name: string): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gestion-boutique-print-'))

  return path.join(folder, name)
}

describe('impression et PDF', () => {
  before(() => {
    registerIpcHandlers()
  })

  beforeEach(() => {
    resetPrintStubs()
  })

  describe('service impression', () => {
    it('charge le document depuis une URL data, donc hors ligne', () => {
      const url = buildDocumentUrl(INVOICE_HTML)

      assert.equal(url.startsWith('data:text/html;charset=utf-8,'), true)
      assert.equal(url.includes('http://'), false)
      assert.equal(url.includes('https://'), false)
      assert.equal(decodeURIComponent(url.split(',')[1]), INVOICE_HTML)
    })

    it('refuse un document vide ou trop volumineux', () => {
      assert.throws(() => assertPrintableDocument('   '), PrintError)
      assert.throws(() => assertPrintableDocument(undefined), PrintError)
      assert.throws(() => assertPrintableDocument('x'.repeat(8_000_001)), PrintError)

      try {
        assertPrintableDocument('')
      } catch (error) {
        assert.equal((error as PrintError).code, 'emptyDocument')
        assert.equal((error as PrintError).message, PRINT_ERRORS.emptyDocument)
      }
    })

    it('nettoie le nom de fichier proposé par la boîte de dialogue', () => {
      assert.equal(sanitizePdfFileName('Facture VTE-000001'), 'Facture VTE-000001')
      assert.equal(
        sanitizePdfFileName('../../facture:VTE*000001'),
        'facture VTE 000001',
      )
      assert.equal(sanitizePdfFileName(''), 'facture')
    })
  })

  describe('canaux IPC', () => {
    it('expose exactement les canaux attendus', () => {
      const channels = registeredChannels().filter((channel) => channel.startsWith('print:'))

      assert.deepEqual(channels, [...PRINT_CHANNELS].sort())
    })

    it('publie window.api.print avec ses deux méthodes', () => {
      const exposed = exposedToMainWorld.api as Record<string, Record<string, unknown>>

      assert.equal(typeof exposed.print, 'object')
      assert.equal(typeof exposed.print.print, 'function')
      assert.equal(typeof exposed.print.savePdf, 'function')
      assert.equal(Object.keys(exposed.print).length, 2)
      // The other modules keep their exact surface.
      assert.equal(Object.keys(exposed.invoices).length, 12)
    })

    it('imprime le document dans une fenêtre cachée puis la ferme', async () => {
      const result = await invoke<null>('print:html', {
        html: INVOICE_HTML,
        title: 'Facture VTE-000001',
      })

      assert.equal(result.success, true)
      assert.equal(printStubs.loadedUrls.length, 1)
      assert.equal(
        printStubs.loadedUrls[0].startsWith('data:text/html;charset=utf-8,'),
        true,
      )
      assert.deepEqual(printStubs.printOptions[0], {
        silent: false,
        printBackground: true,
        landscape: true,
      })
      // The hidden window is opened in A4 landscape proportions.
      const windowOptions = printStubs.windowOptions[0] as {
        width: number
        height: number
      }

      assert.equal(windowOptions.width > windowOptions.height, true)
      // The hidden window never leaks.
      assert.equal(printStubs.openWindows, 0)
    })

    it('supporte une impression répondue par une promesse', async () => {
      printStubs.printReturnsPromise = true

      assert.equal(
        (await invoke<null>('print:html', { html: INVOICE_HTML })).success,
        true,
      )

      resetPrintStubs()
      printStubs.printReturnsPromise = true
      printStubs.printSucceeds = false

      assert.equal(
        expectFailure(await invoke<null>('print:html', { html: INVOICE_HTML })),
        PRINT_ERRORS.printFailed,
      )
      assert.equal(printStubs.openWindows, 0)
    })

    it('n’ouvre aucune fenêtre pour un document vide', async () => {
      assert.equal(
        expectFailure(await invoke<null>('print:html', { html: '' })),
        PRINT_ERRORS.emptyDocument,
      )
      assert.equal(
        expectFailure(await invoke<null>('print:html', {})),
        PRINT_ERRORS.emptyDocument,
      )
      assert.equal(printStubs.loadedUrls.length, 0)
      assert.equal(printStubs.openWindows, 0)
    })

    it('remonte l’échec de l’impression et de l’ouverture de la fenêtre', async () => {
      printStubs.printSucceeds = false

      assert.equal(
        expectFailure(await invoke<null>('print:html', { html: INVOICE_HTML })),
        PRINT_ERRORS.printFailed,
      )
      assert.equal(printStubs.openWindows, 0)

      resetPrintStubs()
      printStubs.failToLoad = true

      assert.equal(
        expectFailure(await invoke<null>('print:html', { html: INVOICE_HTML })),
        PRINT_ERRORS.windowFailed,
      )
      assert.equal(printStubs.openWindows, 0)
    })

    it('génère le PDF hors ligne et l’enregistre où le commerçant l’a choisi', async () => {
      const target = tempFile('Facture VTE-000001.pdf')

      printStubs.savePath = target

      const result = await invoke<{ path: string | null }>('print:pdf', {
        html: INVOICE_HTML,
        title: 'Facture VTE-000001',
      })

      assert.equal(result.success, true)
      assert.equal(result.success ? result.data.path : null, target)
      assert.equal(fs.readFileSync(target).toString(), '%PDF-1.4 facture')
      assert.deepEqual(printStubs.pdfOptions[0], {
        printBackground: true,
        pageSize: 'A4',
        landscape: true,
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      })
      assert.deepEqual(
        (printStubs.saveOptions[0] as { defaultPath: string }).defaultPath,
        'Facture VTE-000001.pdf',
      )
      assert.equal(printStubs.openWindows, 0)

      fs.rmSync(path.dirname(target), { recursive: true, force: true })
    })

    it('traite l’annulation de la boîte de dialogue comme un succès sans fichier', async () => {
      printStubs.savePath = null

      const result = await invoke<{ path: string | null }>('print:pdf', {
        html: INVOICE_HTML,
        title: 'Facture VTE-000001',
      })

      assert.equal(result.success, true)
      assert.equal(result.success ? result.data.path : 'kept', null)
      assert.equal(printStubs.openWindows, 0)
    })

    it('remonte un échec de génération ou d’enregistrement du PDF', async () => {
      printStubs.pdfResult = new Error('chromium refused')

      assert.equal(
        expectFailure(await invoke('print:pdf', { html: INVOICE_HTML })),
        PRINT_ERRORS.pdfFailed,
      )

      resetPrintStubs()
      // A folder can never be overwritten by a file.
      printStubs.savePath = os.tmpdir()

      assert.equal(
        expectFailure(await invoke('print:pdf', { html: INVOICE_HTML })),
        PRINT_ERRORS.saveFailed,
      )
      assert.equal(printStubs.openWindows, 0)
    })
  })
})
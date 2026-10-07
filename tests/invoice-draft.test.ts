import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clearInvoiceDraft,
  isMeaningfulInvoiceDraft,
  readInvoiceDraft,
  saveInvoiceDraft,
} from '../src/pages/invoices/invoice-draft'
import type { InvoiceDraft } from '../src/pages/invoices/invoice-draft'
import {
  CASH_CLIENT_VALUE,
  createEmptyDraft,
  INVOICE_ITEMS_MAX,
  todayInputValue,
} from '../src/pages/invoices/schemas/invoice.schema'
import type {
  InvoiceItemDraft,
  InvoiceLineDraft,
} from '../src/pages/invoices/schemas/invoice.schema'

/**
 * Le brouillon rend la navigation sans perte : le contenu est
 * nettoyé à la lecture (lignes revalidées, date corrigée), et le
 * service métier reste l'autorité au moment de la création.
 */

const STORAGE_KEY = 'invoice-draft:v1'

/** Simule le stockage local du renderer, absent sous node. */
function stubStorage(initial: Record<string, string> = {}): void {
  const store: Record<string, string> = { ...initial }
  const storage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value)
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      for (const key of Object.keys(store)) {
        delete store[key]
      }
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length
    },
  }
  const globalScope = globalThis as { localStorage?: unknown }

  globalScope.localStorage = storage
}

function dropStorage(): void {
  const globalScope = globalThis as { localStorage?: unknown }

  globalScope.localStorage = undefined
}

function buildLine(overrides: Partial<InvoiceLineDraft> = {}): InvoiceLineDraft {
  return {
    key: 'line-1',
    productId: 1,
    form: 'SAC',
    quantity: 10,
    unitPrice: 2_500,
    lineTotal: 25_000,
    ...overrides,
  }
}

function buildEditor(overrides: Partial<InvoiceItemDraft> = {}): InvoiceItemDraft {
  return {
    key: 'editor-1',
    productId: '2',
    form: 'SEAU',
    quantity: '3',
    unitPrice: '1500',
    ...overrides,
  }
}

function buildDraft(overrides: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    date: '2026-10-05',
    clientId: '7',
    lines: [buildLine()],
    editor: createEmptyDraft(),
    editingKey: null,
    ...overrides,
  }
}

describe('brouillon de facture en cours', () => {
  it('sans stockage local, rien n’est lu ni mémorisé', () => {
    dropStorage()

    assert.equal(readInvoiceDraft(), null)
    saveInvoiceDraft(buildDraft())
    assert.equal(readInvoiceDraft(), null)
  })

  it('ne restaure rien sans contenu saisi ou avec un contenu illisible', () => {
    stubStorage({ [STORAGE_KEY]: 'pas du json' })
    assert.equal(readInvoiceDraft(), null)

    stubStorage({ [STORAGE_KEY]: '[]' })
    assert.equal(readInvoiceDraft(), null)

    stubStorage({})
    assert.equal(readInvoiceDraft(), null)

    stubStorage({
      [STORAGE_KEY]: JSON.stringify(
        buildDraft({
          lines: [],
          clientId: CASH_CLIENT_VALUE,
          editor: createEmptyDraft(),
        }),
      ),
    })
    assert.equal(readInvoiceDraft(), null)
  })

  it('retrouve les lignes, le client et la saisie en cours', () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify(
        buildDraft({
          lines: [buildLine({ quantity: 4, lineTotal: 0 })],
          editor: buildEditor(),
        }),
      ),
    })

    const restored = readInvoiceDraft()

    assert.equal(restored?.date, '2026-10-05')
    assert.equal(restored?.clientId, '7')
    assert.equal(restored?.editingKey, null)
    // lineTotal est recalculé, jamais cru tel quel.
    assert.deepEqual(restored?.lines, [
      {
        key: 'line-1',
        productId: 1,
        form: 'SAC',
        quantity: 4,
        unitPrice: 2_500,
        lineTotal: 10_000,
      },
    ])
    assert.deepEqual(restored?.editor, buildEditor())
  })

  it('écarte les lignes manifestement fausses', () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify(
        buildDraft({
          lines: [
            buildLine({ key: 'nul', quantity: 0 }),
            buildLine({ key: 'decimal', quantity: 1.5 }),
            buildLine({ key: 'negatif', quantity: -2 }),
            buildLine({ key: 'ok', quantity: 2 }),
          ],
        }),
      ),
    })

    const restored = readInvoiceDraft()

    assert.equal(restored?.lines.length, 1)
    assert.equal(restored?.lines[0].key, 'ok')
  })

  it('plafonne les lignes restaurées au maximum autorisé', () => {
    const lines = Array.from({ length: INVOICE_ITEMS_MAX + 5 }, (_, index) =>
      buildLine({ key: `line-${index}`, productId: index + 1 }),
    )

    stubStorage({ [STORAGE_KEY]: JSON.stringify(buildDraft({ lines })) })

    assert.equal(readInvoiceDraft()?.lines.length, INVOICE_ITEMS_MAX)
  })

  it('ramène une date invalide au jour du jour', () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify(buildDraft({ date: '2026-02-31' })),
    })

    assert.equal(readInvoiceDraft()?.date, todayInputValue())
  })

  it('garde la ligne en cours de modification quand elle existe encore', () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify(
        buildDraft({
          lines: [buildLine({ key: 'garde' })],
          editor: buildEditor(),
          editingKey: 'garde',
        }),
      ),
    })

    assert.equal(readInvoiceDraft()?.editingKey, 'garde')
  })

  it('repart d’un éditeur vide quand la ligne modifiée a disparu', () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify(
        buildDraft({
          lines: [buildLine({ key: 'garde' })],
          editor: buildEditor({ productId: '1', form: 'SAC' }),
          editingKey: 'disparue',
        }),
      ),
    })

    const restored = readInvoiceDraft()

    assert.equal(restored?.editingKey, null)
    // createEmptyDraft() génère une clé aléatoire : on compare les champs.
    assert.equal(restored?.editor.productId, '')
    assert.equal(restored?.editor.form, '')
    assert.equal(restored?.editor.quantity, '')
    assert.equal(restored?.editor.unitPrice, '')
  })

  it('garde une ligne en cours de saisie, même incomplète', () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify(
        buildDraft({
          lines: [],
          clientId: CASH_CLIENT_VALUE,
          editor: buildEditor({
            productId: '1',
            form: '',
            quantity: '',
            unitPrice: '',
          }),
        }),
      ),
    })

    const restored = readInvoiceDraft()

    assert.equal(restored?.editor.productId, '1')
    assert.equal(restored?.editor.form, '')
  })

  it('restaure un brouillon réduit au client choisi', () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify(
        buildDraft({
          lines: [],
          clientId: '7',
          editor: createEmptyDraft(),
        }),
      ),
    })

    assert.equal(readInvoiceDraft()?.clientId, '7')
  })

  it('ignore les valeurs d’un type inattendu', () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify({
        date: '2026-10-05',
        clientId: 7,
        lines: [buildLine()],
        editor: createEmptyDraft(),
      }),
    })

    const restored = readInvoiceDraft()

    assert.equal(restored?.clientId, '')
    assert.equal(restored?.lines.length, 1)
  })

  it('mémorise puis oublie le brouillon', () => {
    stubStorage()
    const content = buildDraft()

    saveInvoiceDraft(content)
    assert.deepEqual(readInvoiceDraft(), content)

    clearInvoiceDraft()
    assert.equal(readInvoiceDraft(), null)
  })
})

describe('contenu digne d’être restauré', () => {
  it('exige au moins une ligne, une saisie ou un client réel', () => {
    assert.equal(isMeaningfulInvoiceDraft(null), false)
    assert.equal(
      isMeaningfulInvoiceDraft(
        buildDraft({ lines: [], clientId: CASH_CLIENT_VALUE }),
      ),
      false,
    )
    assert.equal(
      isMeaningfulInvoiceDraft(
        buildDraft({ lines: [], editor: createEmptyDraft() }),
      ),
      true,
    )
    assert.equal(
      isMeaningfulInvoiceDraft(
        buildDraft({
          lines: [],
          clientId: CASH_CLIENT_VALUE,
          editor: buildEditor({ quantity: '2' }),
        }),
      ),
      true,
    )
  })
})

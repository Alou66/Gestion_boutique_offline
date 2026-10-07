import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clearSupplyDraft,
  isMeaningfulSupplyDraft,
  readSupplyDraft,
  saveSupplyDraft,
} from '../src/pages/supplies/supply-draft'
import type { SupplyDraft } from '../src/pages/supplies/supply-draft'
import {
  CASH_SUPPLIER_VALUE,
  createEmptyDraft,
  SUPPLY_ITEMS_MAX,
  todayInputValue,
} from '../src/pages/supplies/schemas/supply.schema'
import type {
  SupplyItemDraft,
  SupplyLineDraft,
} from '../src/pages/supplies/schemas/supply.schema'

/**
 * Le brouillon rend la navigation sans perte : le contenu est
 * nettoyé à la lecture (lignes revalidées, fournisseur élagué),
 * et le service métier reste l'autorité au moment de la
 * validation, qui est définitive.
 */

const STORAGE_KEY = 'supply-draft:v1'

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

function buildLine(overrides: Partial<SupplyLineDraft> = {}): SupplyLineDraft {
  return {
    key: 'line-1',
    productId: 1,
    form: 'SAC',
    quantity: 10,
    purchaseUnitPrice: 5_000,
    lineTotal: 50_000,
    ...overrides,
  }
}

function buildEditor(overrides: Partial<SupplyItemDraft> = {}): SupplyItemDraft {
  return {
    key: 'editor-1',
    productId: '2',
    form: 'SEAU',
    quantity: '3',
    purchaseUnitPrice: '1500',
    ...overrides,
  }
}

function buildDraft(overrides: Partial<SupplyDraft> = {}): SupplyDraft {
  return {
    date: '2026-10-05',
    supplierId: '1',
    lines: [buildLine()],
    editor: createEmptyDraft(),
    editingKey: null,
    ...overrides,
  }
}

describe('brouillon d’approvisionnement en cours', () => {
  it('sans stockage local, rien n’est lu ni mémorisé', () => {
    dropStorage()

    assert.equal(readSupplyDraft(), null)
    saveSupplyDraft(buildDraft())
    assert.equal(readSupplyDraft(), null)
  })

  it('ne restaure rien sans contenu saisi ou avec un contenu illisible', () => {
    stubStorage({ [STORAGE_KEY]: 'pas du json' })
    assert.equal(readSupplyDraft(), null)

    stubStorage({ [STORAGE_KEY]: '[]' })
    assert.equal(readSupplyDraft(), null)

    stubStorage({})
    assert.equal(readSupplyDraft(), null)

    stubStorage({
      [STORAGE_KEY]: JSON.stringify(
        buildDraft({
          lines: [],
          supplierId: '',
          editor: createEmptyDraft(),
        }),
      ),
    })
    assert.equal(readSupplyDraft(), null)
  })

  it('retrouve le fournisseur, les lignes et la saisie en cours', () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify(
        buildDraft({
          lines: [buildLine({ quantity: 4, lineTotal: 0 })],
          editor: buildEditor(),
        }),
      ),
    })

    const restored = readSupplyDraft()

    assert.equal(restored?.date, '2026-10-05')
    assert.equal(restored?.supplierId, '1')
    assert.equal(restored?.editingKey, null)
    // lineTotal est recalculé, jamais cru tel quel.
    assert.deepEqual(restored?.lines, [
      {
        key: 'line-1',
        productId: 1,
        form: 'SAC',
        quantity: 4,
        purchaseUnitPrice: 5_000,
        lineTotal: 20_000,
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
            buildLine({ key: 'prix', purchaseUnitPrice: -2 }),
            buildLine({ key: 'ok', quantity: 2 }),
          ],
        }),
      ),
    })

    const restored = readSupplyDraft()

    assert.equal(restored?.lines.length, 1)
    assert.equal(restored?.lines[0].key, 'ok')
  })

  it('plafonne les lignes restaurées au maximum autorisé', () => {
    const lines = Array.from({ length: SUPPLY_ITEMS_MAX + 5 }, (_, index) =>
      buildLine({ key: `line-${index}`, productId: index + 1 }),
    )

    stubStorage({ [STORAGE_KEY]: JSON.stringify(buildDraft({ lines })) })

    assert.equal(readSupplyDraft()?.lines.length, SUPPLY_ITEMS_MAX)
  })

  it('ramène une date invalide au jour du jour', () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify(
        buildDraft({
          date: '2026-13-01',
        }),
      ),
    })

    const restored = readSupplyDraft()

    assert.equal(restored?.date, todayInputValue())
    assert.equal(restored?.supplierId, '1')
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

    assert.equal(readSupplyDraft()?.editingKey, 'garde')
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

    const restored = readSupplyDraft()

    assert.equal(restored?.editingKey, null)
    // createEmptyDraft() génère une clé aléatoire : on compare les champs.
    assert.equal(restored?.editor.productId, '')
    assert.equal(restored?.editor.form, '')
    assert.equal(restored?.editor.quantity, '')
    assert.equal(restored?.editor.purchaseUnitPrice, '')
  })

  it('garde une ligne en cours de saisie, même incomplète', () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify(
        buildDraft({
          lines: [],
          supplierId: '',
          editor: buildEditor({
            productId: '1',
            form: '',
            quantity: '',
            purchaseUnitPrice: '',
          }),
        }),
      ),
    })

    const restored = readSupplyDraft()

    assert.equal(restored?.editor.productId, '1')
    assert.equal(restored?.editor.form, '')
  })

  it('restaure un brouillon réduit au fournisseur saisi', () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify(
        buildDraft({
          lines: [],
          supplierId: '7',
          editor: createEmptyDraft(),
        }),
      ),
    })

    assert.equal(readSupplyDraft()?.supplierId, '7')
  })

  it('ignore les valeurs d’un type inattendu', () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify({
        date: '2026-10-05',
        supplierId: 42,
        lines: [buildLine()],
        editor: createEmptyDraft(),
      }),
    })

    const restored = readSupplyDraft()

    assert.equal(restored?.supplierId, CASH_SUPPLIER_VALUE)
    assert.equal(restored?.lines.length, 1)
  })

  it('mémorise puis oublie le brouillon', () => {
    stubStorage()
    const content = buildDraft()

    saveSupplyDraft(content)
    assert.deepEqual(readSupplyDraft(), content)

    clearSupplyDraft()
    assert.equal(readSupplyDraft(), null)
  })
})

describe('contenu digne d’être restauré', () => {
  it('exige au moins une ligne, un fournisseur ou une saisie', () => {
    assert.equal(isMeaningfulSupplyDraft(null), false)
    assert.equal(
      isMeaningfulSupplyDraft(
        buildDraft({ lines: [], supplierId: '' }),
      ),
      false,
    )
    assert.equal(
      isMeaningfulSupplyDraft(
        buildDraft({ lines: [], supplierId: '1' }),
      ),
      true,
    )
    assert.equal(
      isMeaningfulSupplyDraft(
        buildDraft({
          lines: [],
          supplierId: '',
          editor: buildEditor({ quantity: '2' }),
        }),
      ),
      true,
    )
  })
})

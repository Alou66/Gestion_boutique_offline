import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Client, Product, SaleDetail, SaleItem, StockFormLevel } from '../electron/types'
import {
  buildAvailableStock,
  buildInvoiceConfirmationMessage,
  CASH_CLIENT_VALUE,
  computeLineTotal,
  createEmptyDraft,
  getConfiguredSalePrice,
  getLineKey,
  getProductForms,
  INVOICE_MESSAGES,
  invoiceFormSchema,
  invoiceItemFormSchema,
  isSameLine,
  parseNumberField,
  readAvailableStock,
  readDraftLineTotal,
  resolveClientSelection,
  sumLineTotals,
  toDraft,
  toInvoiceInput,
  toLineDrafts,
  validateDraftLine,
} from '../src/pages/invoices/schemas/invoice.schema'
import type { InvoiceLineDraft } from '../src/pages/invoices/schemas/invoice.schema'

/**
 * The renderer form only makes obviously wrong entries visible before the round
 * trip: the main process stays the authority for the reference, the official
 * total, the stock and the payment status.
 */

function buildSimpleProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'SUCRE 1 KG',
    categoryId: 1,
    categoryName: 'BOISSONS',
    purchasePrice: 5_000,
    salePrice: 7_000,
    isTransformable: false,
    primaryForm: 'SAC',
    secondaryForm: null,
    conversionQuantity: null,
    secondarySalePrice: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function buildTransformableProduct(overrides: Partial<Product> = {}): Product {
  return buildSimpleProduct({
    id: 2,
    name: 'CHOCOPAIN 5 KG',
    isTransformable: true,
    primaryForm: 'CARTON',
    secondaryForm: 'SEAU',
    conversionQuantity: 4,
    secondarySalePrice: 1_500,
    ...overrides,
  })
}

function buildClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 7,
    name: 'AWA DIOP',
    phone: '771234567',
    address: 'Pikine, Dakar',
    isActive: true,
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function buildItem(overrides: Partial<SaleItem> = {}): SaleItem {
  return {
    id: 1,
    saleId: 1,
    productId: 1,
    productName: 'SUCRE 1 KG',
    form: 'SAC',
    quantity: 10,
    unitPrice: 2_500,
    lineTotal: 25_000,
    ...overrides,
  }
}

function buildInvoice(overrides: Partial<SaleDetail> = {}): SaleDetail {
  const items = overrides.items ?? [buildItem()]

  return {
    id: 1,
    reference: 'VTE-000001',
    clientId: 7,
    clientName: 'AWA DIOP',
    saleDate: new Date(2026, 9, 5),
    status: 'VALIDEE',
    totalAmount: 25_000,
    paidAmount: 0,
    remainingAmount: 25_000,
    paymentStatus: 'NON_PAYEE',
    createdAt: new Date(),
    updatedAt: new Date(),
    items,
    paymentSummary: { paidAmount: 0, remainingAmount: 25_000, status: 'NON_PAYEE' },
    ...overrides,
  }
}

function buildLevel(overrides: Partial<StockFormLevel> = {}): StockFormLevel {
  return {
    productId: 1,
    productName: 'SUCRE 1 KG',
    categoryId: 1,
    categoryName: 'BOISSONS',
    form: 'SAC',
    quantity: 20,
    hasMovements: true,
    isProductActive: true,
    isLegacyForm: false,
    ...overrides,
  }
}

describe('formulaire de facture', () => {
  it('accepte une facture valide avec plusieurs lignes', () => {
    const parsed = invoiceFormSchema.safeParse({
      date: '2026-10-05',
      clientId: 7,
      items: [
        { productId: 1, form: 'SAC', quantity: 10, unitPrice: 2_500 },
        { productId: 2, form: 'SEAU', quantity: 4, unitPrice: 1_500 },
      ],
    })

    assert.equal(parsed.success, true)

    const payload = parsed.success ? toInvoiceInput(parsed.data) : null

    assert.equal(payload?.date, '2026-10-05')
    assert.equal(payload?.clientId, 7)
    // The price billed by the shopkeeper is sent as is: it is the historical
    // snapshot of the line, the service never recomputes it.
    assert.deepEqual(payload?.items, [
      { productId: 1, form: 'SAC', quantity: 10, unitPrice: 2_500 },
      { productId: 2, form: 'SEAU', quantity: 4, unitPrice: 1_500 },
    ])
    // The renderer never sends a total: the service recomputes it.
    assert.equal('totalAmount' in (payload ?? {}), false)
  })

  it('accepte une facture sans client choisi, pour le client comptant', () => {
    const parsed = invoiceFormSchema.safeParse({
      date: '2026-10-05',
      clientId: null,
      items: [{ productId: 1, form: 'SAC', quantity: 2, unitPrice: 2_500 }],
    })

    assert.equal(parsed.success, true)
    assert.equal(parsed.success ? parsed.data.clientId : 'client', null)
  })

  it('refuse une facture sans ligne', () => {
    const parsed = invoiceFormSchema.safeParse({
      date: '2026-10-05',
      clientId: 7,
      items: [],
    })

    assert.equal(parsed.success, false)
    assert.equal(
      parsed.success ? '' : parsed.error.issues[0].message,
      INVOICE_MESSAGES.itemsRequired,
    )
  })

  it('refuse une date absente, mal formée ou hors plage', () => {
    const cases: [unknown, string][] = [
      ['', INVOICE_MESSAGES.dateRequired],
      ['05/10/2026', INVOICE_MESSAGES.dateInvalid],
      ['2026-13-01', INVOICE_MESSAGES.dateInvalid],
      ['2026-02-31', INVOICE_MESSAGES.dateInvalid],
      ['1999-12-31', INVOICE_MESSAGES.dateOutOfRange],
    ]

    for (const [date, expected] of cases) {
      const parsed = invoiceFormSchema.safeParse({
        date,
        clientId: 7,
        items: [{ productId: 1, form: 'SAC', quantity: 1, unitPrice: 100 }],
      })

      assert.equal(parsed.success, false, `${String(date)} must be refused`)
      assert.equal(parsed.success ? '' : parsed.error.issues[0].message, expected)
    }
  })

  it('refuse une quantité nulle, négative ou décimale', () => {
    for (const quantity of [0, -1, 1.5]) {
      const parsed = invoiceFormSchema.safeParse({
        date: '2026-10-05',
        clientId: 7,
        items: [{ productId: 1, form: 'SAC', quantity, unitPrice: 2_500 }],
      })

      assert.equal(parsed.success, false, `${quantity} must be refused`)
      assert.equal(
        parsed.success ? '' : parsed.error.issues[0].message,
        INVOICE_MESSAGES.quantityInvalid,
      )
    }
  })

  it('refuse un prix négatif ou décimal et accepte zéro', () => {
    for (const unitPrice of [-1, 1.5]) {
      const parsed = invoiceFormSchema.safeParse({
        date: '2026-10-05',
        clientId: 7,
        items: [{ productId: 1, form: 'SAC', quantity: 1, unitPrice }],
      })

      assert.equal(parsed.success, false, `${unitPrice} must be refused`)
    }

    const free = invoiceFormSchema.safeParse({
      date: '2026-10-05',
      clientId: 7,
      items: [{ productId: 1, form: 'SAC', quantity: 1, unitPrice: 0 }],
    })

    assert.equal(free.success, true)
  })

  it('refuse deux lignes du même produit dans la même forme', () => {
    const parsed = invoiceFormSchema.safeParse({
      date: '2026-10-05',
      clientId: 7,
      items: [
        { productId: 1, form: 'SAC', quantity: 10, unitPrice: 2_500 },
        { productId: 1, form: ' sac ', quantity: 5, unitPrice: 2_500 },
      ],
    })

    assert.equal(parsed.success, false)
    assert.equal(
      parsed.success ? '' : parsed.error.issues[0].message,
      INVOICE_MESSAGES.duplicateLine,
    )
  })

  it('accepte le même produit dans deux formes différentes', () => {
    const parsed = invoiceFormSchema.safeParse({
      date: '2026-10-05',
      clientId: 7,
      items: [
        { productId: 2, form: 'CARTON', quantity: 2, unitPrice: 10_000 },
        { productId: 2, form: 'SEAU', quantity: 8, unitPrice: 1_500 },
      ],
    })

    assert.equal(parsed.success, true)
  })

  it('valide une ligne unique avant de l’ajouter', () => {
    assert.equal(
      invoiceItemFormSchema.safeParse({
        productId: 1,
        form: 'SAC',
        quantity: 12,
        unitPrice: 2_400,
      }).success,
      true,
    )
    assert.equal(
      invoiceItemFormSchema.safeParse({
        productId: 1,
        form: 'SAC',
        quantity: 0,
        unitPrice: 2_400,
      }).success,
      false,
    )
  })
})

/**
 * Le sélecteur de client : la valeur par défaut est le client comptant, jamais
 * un client inactif, et le renderer ne crée aucun client.
 */
describe('sélection du client de la facture', () => {
  const cashClient = buildClient({ id: 1, name: 'CLIENT COMPTANT', isSystem: true })
  const activeClient = buildClient()
  const clients = [cashClient, activeClient]

  it('utilise le client comptant quand aucun client n’est choisi', () => {
    assert.deepEqual(resolveClientSelection(CASH_CLIENT_VALUE, clients), {
      ok: true,
      clientId: null,
    })
    assert.deepEqual(resolveClientSelection('', clients), { ok: true, clientId: null })
  })

  it('accepte un client proposé par la liste', () => {
    assert.deepEqual(resolveClientSelection('7', clients), { ok: true, clientId: 7 })
  })

  it('refuse une valeur absente, décimale ou inconnue', () => {
    assert.deepEqual(resolveClientSelection('abc', clients), {
      ok: false,
      error: INVOICE_MESSAGES.clientRequired,
    })
    assert.deepEqual(resolveClientSelection('2.5', clients), {
      ok: false,
      error: INVOICE_MESSAGES.clientRequired,
    })
    // An inactive or deleted client is not part of the offered list.
    assert.deepEqual(resolveClientSelection('4242', clients), {
      ok: false,
      error: INVOICE_MESSAGES.clientNotFound,
    })
    assert.deepEqual(resolveClientSelection('7', [cashClient]), {
      ok: false,
      error: INVOICE_MESSAGES.clientNotFound,
    })
  })
})

describe('produits, formes et prix de la facture', () => {
  it('propose les formes du produit sélectionné', () => {
    assert.deepEqual(getProductForms(buildSimpleProduct()), ['SAC'])
    assert.deepEqual(getProductForms(buildTransformableProduct()), ['CARTON', 'SEAU'])
    assert.deepEqual(getProductForms(null), [])
  })

  it('préremplit le prix configuré de la forme vendue', () => {
    const simple = buildSimpleProduct()
    const transformable = buildTransformableProduct()

    assert.equal(getConfiguredSalePrice(simple, 'SAC'), 7_000)
    assert.equal(getConfiguredSalePrice(transformable, 'CARTON'), 7_000)
    assert.equal(getConfiguredSalePrice(transformable, 'SEAU'), 1_500)
    assert.equal(getConfiguredSalePrice(simple, 'BIDON'), 7_000)
    assert.equal(getConfiguredSalePrice(null, 'SAC'), null)
    assert.equal(
      getConfiguredSalePrice(buildSimpleProduct({ salePrice: 1_500 }), 'SAC'),
      1_500,
    )
  })

  it('refuse une ligne dont la forme n’appartient pas au produit', () => {
    const products = [buildSimpleProduct(), buildTransformableProduct()]
    const available = buildAvailableStock([
      buildLevel(),
      buildLevel({ productId: 2, form: 'CARTON', quantity: 10 }),
      buildLevel({ productId: 2, form: 'SEAU', quantity: 40 }),
    ])

    assert.equal(validateDraftLine(1, 'SAC', 5, products, available), null)
    assert.equal(validateDraftLine(2, 'CARTON', 5, products, available), null)
    assert.equal(validateDraftLine(2, 'SEAU', 5, products, available), null)
    assert.equal(
      validateDraftLine(1, 'CARTON', 5, products, available),
      INVOICE_MESSAGES.formInvalid,
    )
    assert.equal(
      validateDraftLine(2, 'BIDON', 5, products, available),
      INVOICE_MESSAGES.formInvalid,
    )
    assert.equal(
      validateDraftLine(4242, 'SAC', 1, products, available),
      INVOICE_MESSAGES.productNotFound,
    )
    assert.equal(
      validateDraftLine(1, 'SAC', 1, [buildSimpleProduct({ isActive: false })], available),
      INVOICE_MESSAGES.productInactive,
    )
  })

  it('refuse une quantité supérieure au stock disponible de la forme vendue', () => {
    const products = [buildSimpleProduct(), buildTransformableProduct()]
    const available = buildAvailableStock([
      buildLevel({ quantity: 20 }),
      buildLevel({ productId: 2, form: 'CARTON', quantity: 10 }),
      buildLevel({ productId: 2, form: 'SEAU', quantity: 2 }),
    ])

    assert.equal(validateDraftLine(1, 'SAC', 20, products, available), null)
    assert.equal(
      validateDraftLine(1, 'SAC', 21, products, available),
      INVOICE_MESSAGES.insufficientStock,
    )
    // No automatic conversion: SEAU has only 2 units even if CARTON has 10.
    assert.equal(
      validateDraftLine(2, 'SEAU', 3, products, available),
      INVOICE_MESSAGES.insufficientStock,
    )
  })

  it('rend la quantité déjà portée par la facture en cours de modification', () => {
    const invoice = buildInvoice({
      items: [
        buildItem({ productId: 2, form: 'CARTON', quantity: 6, lineTotal: 60_000 }),
        buildItem({ id: 2, productId: 2, form: 'SEAU', quantity: 2, lineTotal: 3_000 }),
      ],
      totalAmount: 63_000,
    })
    const available = buildAvailableStock(
      [
        buildLevel({ productId: 2, form: 'CARTON', quantity: 8 }),
        buildLevel({ productId: 2, form: 'SEAU', quantity: 1 }),
      ],
      invoice,
    )

    // The invoice already took 6 CARTONS and 2 SEAUX: what it gave back can be
    // sold again, exactly like in the main process.
    assert.equal(readAvailableStock(available, 2, 'CARTON'), 14)
    assert.equal(readAvailableStock(available, 2, 'SEAU'), 3)

    const products = [buildTransformableProduct()]

    assert.equal(validateDraftLine(2, 'CARTON', 14, products, available), null)
    assert.equal(
      validateDraftLine(2, 'CARTON', 15, products, available),
      INVOICE_MESSAGES.insufficientStock,
    )
  })
})

/** Saisie des lignes : totaux affichés, identité d'une ligne, rechargement. */
describe('saisie des lignes de facture', () => {
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

  it('calcule le total de la ligne saisie puis le sous-total', () => {
    assert.equal(computeLineTotal(10, 2_500), 25_000)
    // Display only: an input being typed never produces NaN.
    assert.equal(computeLineTotal(NaN, 2_500), 0)
    assert.equal(computeLineTotal(10, -1), 0)

    assert.equal(
      readDraftLineTotal({
        key: 'k',
        productId: '1',
        form: 'SAC',
        quantity: '10',
        unitPrice: '2500',
      }),
      25_000,
    )
    assert.equal(
      readDraftLineTotal({
        key: 'k',
        productId: '1',
        form: 'SAC',
        quantity: '',
        unitPrice: '2500',
      }),
      0,
    )

    assert.equal(
      sumLineTotals([
        buildLine(),
        buildLine({
          key: 'line-2',
          productId: 2,
          quantity: 4,
          unitPrice: 10_000,
          lineTotal: 40_000,
        }),
      ]),
      65_000,
    )
  })

  it('identifie une ligne par son produit et sa forme', () => {
    assert.equal(getLineKey(1, 'SAC'), getLineKey(1, ' sac '))
    assert.notEqual(getLineKey(1, 'SAC'), getLineKey(1, 'SEAU'))
    assert.notEqual(getLineKey(1, 'SAC'), getLineKey(2, 'SAC'))
  })

  it('recharge une ligne dans les champs sans la modifier', () => {
    const line = buildLine()
    const draft = toDraft(line)

    assert.deepEqual(draft, {
      key: 'line-1',
      productId: '1',
      form: 'SAC',
      quantity: '10',
      unitPrice: '2500',
    })
    assert.equal(isSameLine(draft, line), true)
    assert.equal(isSameLine({ ...draft, quantity: '15' }, line), false)
    assert.equal(isSameLine({ ...draft, form: 'CARTON' }, line), false)
  })

  it('crée une ligne vide et garde les champs numériques vides en undefined', () => {
    const draft = createEmptyDraft()

    assert.equal(draft.productId, '')
    assert.equal(draft.form, '')
    assert.equal(draft.quantity, '')
    assert.equal(draft.unitPrice, '')
    assert.equal(parseNumberField(''), undefined)
    assert.equal(parseNumberField(' 12 '), 12)
  })

  it('reprend les lignes existantes avec le prix facturé à la création', () => {
    const lines = toLineDrafts([
      { productId: 1, form: 'SAC', quantity: 10, unitPrice: 1_400 },
      { productId: 2, form: 'SEAU', quantity: 3, unitPrice: 1_500 },
    ])

    assert.equal(lines.length, 2)
    assert.equal(lines[0].unitPrice, 1_400)
    assert.equal(lines[0].lineTotal, 14_000)
    assert.equal(lines[1].lineTotal, 4_500)
    // Two distinct keys: both lines stay editable.
    assert.notEqual(lines[0].key, lines[1].key)
    // Reverting them keeps the historical price, not the current product price.
    assert.equal(sumLineTotals(lines), 18_500)
  })
})

describe('confirmation avant enregistrement', () => {
  it('résume la facture, son client, son total et son effet sur le stock', () => {
    const grouped = new Intl.NumberFormat('fr-FR')
    const message = buildInvoiceConfirmationMessage(
      {
        date: '2026-10-05',
        clientId: 7,
        items: [
          { productId: 1, form: 'SAC', quantity: 10, unitPrice: 2_500 },
          { productId: 2, form: 'SEAU', quantity: 5, unitPrice: 1_500 },
        ],
      },
      'AWA DIOP',
    )

    assert.equal(message.includes('AWA DIOP'), true)
    assert.equal(message.includes('2 lignes'), true)
    // 25 000 + 7 500
    assert.equal(message.includes(grouped.format(32_500)), true)
    assert.equal(message.includes('stock sera décrémenté'), true)
  })

  it('rappelle qu\'une modification corrige le stock et pas la création', () => {
    const message = buildInvoiceConfirmationMessage(
      {
        date: '2026-10-05',
        clientId: null,
        items: [{ productId: 1, form: 'SAC', quantity: 1, unitPrice: 2_500 }],
      },
      'CLIENT COMPTANT',
      true,
    )

    assert.equal(message.includes('1 ligne '), true)
    assert.equal(message.includes('CLIENT COMPTANT'), true)
    assert.equal(message.includes('différence de quantité'), true)
  })
})
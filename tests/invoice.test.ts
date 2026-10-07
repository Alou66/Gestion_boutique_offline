import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { eq } from 'drizzle-orm'
import { getDb } from '../electron/database/client'
import {
  clients,
  payments,
  products,
  saleItems,
  sales,
  stockMovements,
} from '../electron/database/schema'
import { createClient, setClientActive } from '../electron/services/clientService'
import { getProductFormStock, initializeStock } from '../electron/services/stockService'
import { updateProduct } from '../electron/services/productService'
import {
  addPayment,
  cancelInvoice,
  computePaymentStatus,
  createInvoice,
  deleteInvoice,
  deletePayment,
  formatInvoiceReference,
  getInvoiceById,
  getInvoiceByReference,
  getInvoicePaymentSummary,
  InvoiceError,
  listInvoicePayments,
  listInvoices,
  updateInvoice,
  updatePayment,
} from '../electron/services/invoiceService'
import type { InvoiceErrorCode } from '../electron/services/invoiceService'
import type {
  Category,
  Client,
  Product,
  SaleItemInput,
  SalePaymentSummary,
} from '../electron/types'
import {
  closeTestDatabase,
  execSql,
  reopenTestDatabase,
  resetTestDatabase,
  seedCategory,
  seedSimpleProduct,
  seedTransformableProduct,
  setProductActive,
} from './helpers/database'

function expectInvoiceError(code: InvoiceErrorCode, run: () => unknown): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(
      error instanceof InvoiceError,
      `expected InvoiceError, received ${String(error)}`,
    )
    assert.equal(error.code, code)
    return true
  })
}

function invoiceCount(): number {
  return getDb().select().from(sales).all().length
}

function itemCount(): number {
  return getDb().select().from(saleItems).all().length
}

function paymentCount(): number {
  return getDb().select().from(payments).all().length
}

function movementCount(): number {
  return getDb().select().from(stockMovements).all().length
}

function balanceOf(productId: number, form: string): number {
  return getProductFormStock(productId, form).quantity
}

/** Movements of a product, oldest first, as (type, direction, quantity). */
function movementsOf(productId: number): [string, string, number, string | null][] {
  return getDb()
    .select()
    .from(stockMovements)
    .all()
    .filter((movement) => movement.productId === productId)
    .sort((left, right) => left.id - right.id)
    .map((movement) => [
      movement.movementType,
      movement.direction,
      movement.quantity,
      movement.reason,
    ])
}

function line(
  product: Product,
  form: string,
  quantity: number,
  unitPrice?: number,
): SaleItemInput {
  return unitPrice === undefined
    ? { productId: product.id, form, quantity }
    : { productId: product.id, form, quantity, unitPrice }
}

function summary(
  paidAmount: number,
  remainingAmount: number,
  status: SalePaymentSummary['status'],
): SalePaymentSummary {
  return { paidAmount, remainingAmount, status }
}

describe('module Facturation', () => {
  let category: Category
  let simpleProduct: Product
  let transformableProduct: Product
  let client: Client

  beforeEach(() => {
    resetTestDatabase()
    category = seedCategory('BOISSONS')
    simpleProduct = seedSimpleProduct(category, 'SUCRE 1 KG')
    transformableProduct = seedTransformableProduct(category, 'CHOCOPAIN 5 KG')
    client = createClient({ name: 'Awa Diop', phone: '771234567' })

    // The stock module owns the initial stock: a product without any movement
    // simply has a stock of 0 and can never be sold.
    initializeStock(simpleProduct.id, {
      productId: simpleProduct.id,
      quantities: [{ form: 'SAC', quantity: 20 }],
    })
    initializeStock(transformableProduct.id, {
      productId: transformableProduct.id,
      quantities: [
        { form: 'CARTON', quantity: 10 },
        { form: 'SEAU', quantity: 2 },
      ],
    })
  })

  after(() => {
    closeTestDatabase()
  })

  describe('création', () => {
    it('enregistre une facture avec une seule ligne', () => {
      const invoice = createInvoice({
        date: '2026-10-04',
        clientId: client.id,
        items: [line(simpleProduct, 'SAC', 10, 2_500)],
      })

      assert.equal(invoice.reference, 'VTE-000001')
      assert.equal(invoice.status, 'VALIDEE')
      assert.equal(invoice.clientId, client.id)
      assert.equal(invoice.clientName, 'AWA DIOP')
      assert.equal(invoice.totalAmount, 25_000)
      assert.equal(invoice.paymentStatus, 'NON_PAYEE')
      assert.equal(invoice.paidAmount, 0)
      assert.equal(invoice.remainingAmount, 25_000)
      assert.equal(invoice.items.length, 1)
      assert.deepEqual(
        {
          productId: invoice.items[0].productId,
          productName: invoice.items[0].productName,
          form: invoice.items[0].form,
          quantity: invoice.items[0].quantity,
          unitPrice: invoice.items[0].unitPrice,
          lineTotal: invoice.items[0].lineTotal,
        },
        {
          productId: simpleProduct.id,
          productName: 'SUCRE 1 KG',
          form: 'SAC',
          quantity: 10,
          unitPrice: 2_500,
          lineTotal: 25_000,
        },
      )
      assert.equal(invoice.saleDate.getFullYear(), 2026)
      assert.equal(invoice.saleDate.getMonth(), 9)
      assert.equal(invoice.saleDate.getDate(), 4)
    })

    it('enregistre une facture avec plusieurs produits', () => {
      const riz = seedSimpleProduct(category, 'RIZ 25 KG', { salePrice: 12_000 })

      initializeStock(riz.id, {
        productId: riz.id,
        quantities: [{ form: 'SAC', quantity: 10 }],
      })

      const invoice = createInvoice({
        date: '2026-10-04',
        items: [
          line(transformableProduct, 'CARTON', 5, 15_000),
          line(simpleProduct, 'SAC', 4, 2_500),
          line(riz, 'SAC', 2, 12_000),
        ],
      })

      assert.equal(invoice.items.length, 3)
      // 75 000 + 10 000 + 24 000
      assert.equal(invoice.totalAmount, 109_000)
    })

    it('calcule le total et chaque total de ligne à partir des lignes', () => {
      const invoice = createInvoice({
        date: '2026-10-04',
        items: [
          line(transformableProduct, 'CARTON', 10, 10_000),
          line(transformableProduct, 'SEAU', 2, 2_500),
          line(simpleProduct, 'SAC', 7, 999),
        ],
      })

      assert.deepEqual(
        invoice.items.map((item) => [
          item.quantity,
          item.unitPrice,
          item.lineTotal,
        ]),
        [
          [10, 10_000, 100_000],
          [2, 2_500, 5_000],
          [7, 999, 6_993],
        ],
      )

      const sumOfLines = invoice.items.reduce((sum, item) => sum + item.lineTotal, 0)

      assert.equal(invoice.totalAmount, sumOfLines)
      assert.equal(invoice.totalAmount, 111_993)

      const stored = getDb().select({ total: sales.totalAmount }).from(sales).get()

      assert.equal(stored?.total, 111_993)
    })

    it('ne fait jamais confiance au total envoyé par le renderer', () => {
      // The total is not even part of the input: it can only come from the lines.
      const invoice = createInvoice({
        date: '2026-10-04',
        totalAmount: 1,
        items: [line(simpleProduct, 'SAC', 2, 3_000)],
      } as never)

      assert.equal(invoice.totalAmount, 6_000)
    })

    it('accepte un prix à 0 et normalise la forme saisie', () => {
      const invoice = createInvoice({
        date: '2026-10-04',
        items: [line(simpleProduct, '  sac ', 2, 0)],
      })

      assert.equal(invoice.items[0].form, 'SAC')
      assert.equal(invoice.items[0].unitPrice, 0)
      assert.equal(invoice.totalAmount, 0)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 18)
    })

    it('utilise la date du jour quand aucune date n\'est envoyée', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })

      assert.ok(invoice.saleDate instanceof Date)
      assert.equal(invoice.saleDate.getFullYear(), new Date().getFullYear())
    })

    it('refuse une date invalide ou hors plage', () => {
      expectInvoiceError('dateInvalid', () =>
        createInvoice({ date: '04/10/2026', items: [line(simpleProduct, 'SAC', 1, 100)] }),
      )
      expectInvoiceError('dateInvalid', () =>
        createInvoice({ date: '2026-02-31', items: [line(simpleProduct, 'SAC', 1, 100)] }),
      )
      expectInvoiceError('dateOutOfRange', () =>
        createInvoice({ date: '1999-12-31', items: [line(simpleProduct, 'SAC', 1, 100)] }),
      )

      assert.equal(invoiceCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(movementCount(), 3)
    })

    it('refuse une facture sans ligne', () => {
      expectInvoiceError('itemsRequired', () => createInvoice({ date: '2026-10-04', items: [] }))
      expectInvoiceError('itemsRequired', () => createInvoice({ date: '2026-10-04' } as never))

      assert.equal(invoiceCount(), 0)
    })
  })

  describe('références', () => {
    it('génère VTE-000001 puis les suivantes', () => {
      const first = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })
      const second = createInvoice({
        date: '2026-10-05',
        items: [line(simpleProduct, 'SAC', 1, 100)],
      })
      const third = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })

      assert.deepEqual(
        [first.reference, second.reference, third.reference],
        ['VTE-000001', 'VTE-000002', 'VTE-000003'],
      )
      assert.equal(formatInvoiceReference(1), 'VTE-000001')
      assert.equal(formatInvoiceReference(1_234_567), 'VTE-1234567')
    })

    it('garde une référence unique et l\'interdit en base', () => {
      createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })
      createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })

      assert.equal(
        new Set(listInvoices().map((invoice) => invoice.reference)).size,
        2,
      )

      assert.throws(() =>
        getDb()
          .insert(sales)
          .values({
            reference: 'VTE-000001',
            clientId: client.id,
            saleDate: new Date(2026, 9, 4),
            status: 'VALIDEE',
            totalAmount: 0,
            createdAt: new Date(),
          })
          .run(),
      )
    })

    it('reste correcte après la suppression d\'une facture', () => {
      createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })
      const second = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })
      const third = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })

      assert.deepEqual(
        [second.reference, third.reference],
        ['VTE-000002', 'VTE-000003'],
      )

      // The last facture is cancelled then deleted: the next reference must not
      // collide with the one that was freed.
      cancelInvoice(third.id)
      deleteInvoice(third.id)

      const next = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })

      assert.equal(next.reference, 'VTE-000003')
      assert.equal(
        new Set(listInvoices().map((invoice) => invoice.reference)).size,
        3,
      )

      // Deleting a facture never rewinds the sequence either: the freed
      // reference is reused only when it is really free.
      const first = listInvoices()[2]

      cancelInvoice(first.id)
      deleteInvoice(first.id)

      const afterMiddle = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })

      assert.equal(afterMiddle.reference, 'VTE-000005')
      assert.equal(
        new Set(listInvoices().map((invoice) => invoice.reference)).size,
        3,
      )
      assert.deepEqual(
        listInvoices()
          .map((invoice) => invoice.reference)
          .sort(),
        ['VTE-000002', 'VTE-000003', 'VTE-000005'],
      )
    })
  })

  describe('client', () => {
    it('utilise le client sélectionné', () => {
      const invoice = createInvoice({
        clientId: client.id,
        items: [line(simpleProduct, 'SAC', 1, 100)],
      })

      assert.equal(invoice.clientId, client.id)
      assert.equal(invoice.clientName, 'AWA DIOP')
    })

    it('utilise automatiquement CLIENT COMPTANT quand aucun client n\'est choisi', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })

      assert.equal(invoice.clientName, 'CLIENT COMPTANT')

      const systemClients = getDb()
        .select()
        .from(clients)
        .all()
        .filter((candidate) => candidate.name === 'CLIENT COMPTANT')

      assert.equal(systemClients.length, 1)
      assert.equal(systemClients[0].isSystem, true)
      assert.equal(invoice.clientId, systemClients[0].id)
    })

    it('ne crée jamais un second CLIENT COMPTANT', () => {
      const first = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })
      const second = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })
      const third = createInvoice({
        clientId: null,
        items: [line(simpleProduct, 'SAC', 1, 100)],
      })

      assert.equal(first.clientId, second.clientId)
      assert.equal(first.clientId, third.clientId)
      assert.equal(
        getDb()
          .select()
          .from(clients)
          .all()
          .filter((candidate) => candidate.name === 'CLIENT COMPTANT').length,
        1,
      )
    })

    it('refuse un client inexistant ou inactif', () => {
      expectInvoiceError('clientNotFound', () =>
        createInvoice({ clientId: 4242, items: [line(simpleProduct, 'SAC', 1, 100)] }),
      )
      expectInvoiceError('clientNotFound', () =>
        createInvoice({ clientId: 0, items: [line(simpleProduct, 'SAC', 1, 100)] }),
      )

      setClientActive(client.id, false)

      expectInvoiceError('clientInactive', () =>
        createInvoice({ clientId: client.id, items: [line(simpleProduct, 'SAC', 1, 100)] }),
      )

      assert.equal(invoiceCount(), 0)
      assert.equal(movementCount(), 3)
    })
  })

  describe('produits, formes et quantités', () => {
    it('refuse un produit inexistant', () => {
      expectInvoiceError('productNotFound', () =>
        createInvoice({
          date: '2026-10-04',
          items: [{ productId: 4242, form: 'SAC', quantity: 1, unitPrice: 100 }],
        }),
      )

      assert.equal(invoiceCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(movementCount(), 3)
    })

    it('vend un produit actif et refuse un produit inactif', () => {
      const invoice = createInvoice({
        items: [line(transformableProduct, 'CARTON', 2, 15_000)],
      })

      assert.equal(invoice.items[0].productId, transformableProduct.id)

      setProductActive(transformableProduct.id, false)

      expectInvoiceError('productInactive', () =>
        createInvoice({ items: [line(transformableProduct, 'CARTON', 2, 15_000)] }),
      )

      assert.equal(invoiceCount(), 1)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 8)
    })

    it('refuse une forme qui n\'appartient pas au produit', () => {
      expectInvoiceError('formInvalid', () =>
        createInvoice({ items: [line(simpleProduct, 'CARTON', 1, 100)] }),
      )
      expectInvoiceError('formInvalid', () =>
        createInvoice({ items: [line(transformableProduct, 'BIDON', 1, 100)] }),
      )
      expectInvoiceError('formRequired', () =>
        createInvoice({
          items: [
            {
              productId: simpleProduct.id,
              form: '   ',
              quantity: 1,
              unitPrice: 100,
            },
          ],
        }),
      )

      assert.equal(invoiceCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(movementCount(), 3)
    })

    it('vend un produit transformable dans sa forme principale ou secondaire', () => {
      createInvoice({ items: [line(transformableProduct, 'CARTON', 2, 15_000)] })

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 8)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 2)

      createInvoice({ items: [line(transformableProduct, 'SEAU', 1, 4_000)] })

      // No automatic conversion: only the sold form leaves the stock.
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 1)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 8)
    })

    it('refuse une quantité nulle, négative, décimale ou absente', () => {
      expectInvoiceError('quantityInvalid', () =>
        createInvoice({ items: [line(simpleProduct, 'SAC', 0, 100)] }),
      )
      expectInvoiceError('quantityInvalid', () =>
        createInvoice({ items: [line(simpleProduct, 'SAC', -5, 100)] }),
      )
      expectInvoiceError('quantityInvalid', () =>
        createInvoice({ items: [line(simpleProduct, 'SAC', 1.5, 100)] }),
      )
      expectInvoiceError('quantityRequired', () =>
        createInvoice({
          items: [
            {
              productId: simpleProduct.id,
              form: 'SAC',
              quantity: undefined as never,
              unitPrice: 100,
            },
          ],
        }),
      )
      expectInvoiceError('quantityTooHigh', () =>
        createInvoice({ items: [line(simpleProduct, 'SAC', 1_000_001, 100)] }),
      )

      assert.equal(invoiceCount(), 0)
      assert.equal(movementCount(), 3)
    })

    it('refuse un prix négatif, décimal ou absent quand le produit n\'en a pas', () => {
      expectInvoiceError('unitPriceInvalid', () =>
        createInvoice({ items: [line(simpleProduct, 'SAC', 1, -1)] }),
      )
      expectInvoiceError('unitPriceInvalid', () =>
        createInvoice({ items: [line(simpleProduct, 'SAC', 1, 1.5)] }),
      )
      // A price sent as text is a price error too, never a generic one.
      expectInvoiceError('unitPriceInvalid', () =>
        createInvoice({
          items: [
            {
              productId: simpleProduct.id,
              form: 'SAC',
              quantity: 1,
              unitPrice: '1000' as never,
            },
          ],
        }),
      )
      expectInvoiceError('unitPriceTooHigh', () =>
        createInvoice({ items: [line(simpleProduct, 'SAC', 1, 1_000_000_001)] }),
      )

      assert.equal(invoiceCount(), 0)
    })

    it('refuse deux lignes du même produit dans la même forme', () => {
      expectInvoiceError('duplicateLine', () =>
        createInvoice({
          items: [
            line(simpleProduct, 'SAC', 10, 2_500),
            line(simpleProduct, 'SAC', 5, 2_500),
          ],
        }),
      )

      assert.equal(invoiceCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 20)
    })

    it('accepte le même produit dans deux formes différentes', () => {
      const invoice = createInvoice({
        items: [
          line(transformableProduct, 'CARTON', 2, 15_000),
          line(transformableProduct, 'SEAU', 1, 4_000),
        ],
      })

      assert.equal(invoice.items.length, 2)
      assert.equal(invoice.totalAmount, 34_000)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 8)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 1)
    })
  })

  describe('prix historique', () => {
    it('copie le prix configuré du produit dans la ligne', () => {
      const invoice = createInvoice({
        items: [
          line(transformableProduct, 'CARTON', 2),
          line(transformableProduct, 'SEAU', 2),
          line(simpleProduct, 'SAC', 4),
        ],
      })

      // 2 x 15 000, 3 x 4 000 (secondary_sale_price), 4 x 7 000
      assert.deepEqual(
        invoice.items.map((item) => [item.form, item.unitPrice, item.lineTotal]),
        [
          ['CARTON', 15_000, 30_000],
          ['SEAU', 4_000, 8_000],
          ['SAC', 7_000, 28_000],
        ],
      )
      // 30 000 + 8 000 + 28 000
      assert.equal(invoice.totalAmount, 66_000)
    })

    it('accepte un prix manuel différent du prix du produit', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 2, 1_400)] })

      assert.equal(invoice.items[0].unitPrice, 1_400)
      assert.equal(invoice.totalAmount, 2_800)
      // The configuration of the product is never rewritten by a facture.
      assert.equal(getDb().select().from(products).get()?.salePrice, 7_000)
    })

    it('conserve le prix facturé même après une modification du prix du produit', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 2, 1_400)] })

      updateProduct(simpleProduct.id, {
        name: simpleProduct.name,
        categoryId: simpleProduct.categoryId,
        purchasePrice: 5_000,
        salePrice: 1_600,
        isTransformable: false,
        primaryForm: 'SAC',
      })

      const reread = getInvoiceById(invoice.id)

      assert.equal(reread.items[0].unitPrice, 1_400)
      assert.equal(reread.items[0].lineTotal, 2_800)
      assert.equal(reread.totalAmount, 2_800)

      // And a new facture uses the new configured price.
      const next = createInvoice({ items: [line(simpleProduct, 'SAC', 1)] })

      assert.equal(next.items[0].unitPrice, 1_600)
    })

    it('refuse de facturer une forme dont le prix n\'est pas configuré', () => {
      const product = seedSimpleProduct(category, 'SAVON', { salePrice: 0 })
      const other = seedTransformableProduct(category, 'CHOCOPAIN 2 KG')

      initializeStock(product.id, {
        productId: product.id,
        quantities: [{ form: 'SAC', quantity: 5 }],
      })
      initializeStock(other.id, {
        productId: other.id,
        quantities: [
          { form: 'CARTON', quantity: 5 },
          { form: 'SEAU', quantity: 5 },
        ],
      })

      // A configured price of 0 is a real price.
      const freeProduct = createInvoice({ items: [line(product, 'SAC', 1)] })

      assert.equal(freeProduct.items[0].unitPrice, 0)
      assert.equal(freeProduct.totalAmount, 0)

      // The product module requires a secondary price today: the guard below only
      // protects the legacy rows that carry no configured price for a form.
      execSql(
        `update products set secondary_sale_price = null where id = ${other.id}`,
      )

      expectInvoiceError('unitPriceNotConfigured', () =>
        createInvoice({ items: [line(other, 'SEAU', 1)] }),
      )

      // A price typed by the shopkeeper is always accepted.
      const priced = createInvoice({ items: [line(other, 'SEAU', 1, 2_500)] })

      assert.equal(priced.items[0].unitPrice, 2_500)
      assert.equal(priced.totalAmount, 2_500)
    })
  })

  describe('impact sur le stock', () => {
    it('décrémente le stock et crée un mouvement SALE OUT par ligne', () => {
      createInvoice({
        items: [
          line(transformableProduct, 'CARTON', 4, 15_000),
          line(transformableProduct, 'SEAU', 2, 4_000),
        ],
      })

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 6)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 0)
      assert.equal(movementCount(), 5)

      assert.deepEqual(movementsOf(transformableProduct.id).slice(-2), [
        ['SALE', 'OUT', 4, 'Facture VTE-000001'],
        ['SALE', 'OUT', 2, 'Facture VTE-000001'],
      ])
    })

    it('utilise uniquement le stock de la forme vendue, sans conversion', () => {
      // 10 CARTON and 2 SEAU: selling 3 SEAUX can never borrow the CARTONs, and
      // 1 CARTON is never converted into SEAUX either.
      expectInvoiceError('insufficientStock', () =>
        createInvoice({ items: [line(transformableProduct, 'SEAU', 3, 4_000)] }),
      )

      expectInvoiceError('insufficientStock', () =>
        createInvoice({
          items: [
            line(transformableProduct, 'CARTON', 5, 15_000),
            line(transformableProduct, 'SEAU', 3, 4_000),
          ],
        }),
      )

      assert.equal(invoiceCount(), 0)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 2)

      // The exact stock of the sold form is always accepted.
      const invoice = createInvoice({ items: [line(transformableProduct, 'SEAU', 2, 4_000)] })

      assert.equal(invoice.items[0].form, 'SEAU')
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 0)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
    })

    it('refuse une vente supérieure au stock et ne crée rien', () => {
      expectInvoiceError('insufficientStock', () =>
        createInvoice({ items: [line(transformableProduct, 'CARTON', 12, 15_000)] }),
      )

      assert.equal(invoiceCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(movementCount(), 3)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
    })

    it('refuse une vente partielle dont le cumul dépasse le stock', () => {
      expectInvoiceError('insufficientStock', () =>
        createInvoice({
          items: [
            line(transformableProduct, 'CARTON', 8, 15_000),
            line(transformableProduct, 'SEAU', 3, 4_000),
          ],
        }),
      )

      assert.equal(invoiceCount(), 0)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 2)
    })

    it('ne rend jamais le stock négatif, même avec plusieurs factures', () => {
      createInvoice({ items: [line(transformableProduct, 'CARTON', 10, 15_000)] })

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 0)

      expectInvoiceError('insufficientStock', () =>
        createInvoice({ items: [line(transformableProduct, 'CARTON', 1, 15_000)] }),
      )

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 0)
      assert.equal(invoiceCount(), 1)
    })

    it('vend un produit sans aucun mouvement seulement si le stock le permet', () => {
      const product = seedSimpleProduct(category, 'RIZ 25 KG')

      expectInvoiceError('insufficientStock', () =>
        createInvoice({ items: [line(product, 'SAC', 1, 5_000)] }),
      )

      initializeStock(product.id, {
        productId: product.id,
        quantities: [{ form: 'SAC', quantity: 5 }],
      })

      const invoice = createInvoice({ items: [line(product, 'SAC', 5, 5_000)] })

      assert.equal(invoice.reference, 'VTE-000001')
      assert.equal(balanceOf(product.id, 'SAC'), 0)
    })

    it('cumule le stock initial, l\'approvisionnement et la facture', () => {
      createInvoice({ items: [line(transformableProduct, 'CARTON', 3, 15_000)] })

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 7)
      assert.deepEqual(
        movementsOf(transformableProduct.id).map(([type, direction, quantity]) => [
          type,
          direction,
          quantity,
        ]),
        [
          ['STOCK_INITIAL', 'IN', 10],
          ['STOCK_INITIAL', 'IN', 2],
          ['SALE', 'OUT', 3],
        ],
      )
    })
  })

  describe('transaction', () => {
    it('annule tout si un mouvement de stock échoue', () => {
      // The three STOCK_INITIAL movements already exist: the trigger aborts the
      // first SALE insert, like a real write failure would.
      execSql(`
        CREATE TRIGGER test_fail_first_sale_movement
        BEFORE INSERT ON stock_movements
        WHEN NEW.movement_type = 'SALE'
        BEGIN
          SELECT RAISE(ABORT, 'injected failure');
        END;
      `)

      try {
        assert.throws(() =>
          createInvoice({
            items: [
              line(transformableProduct, 'CARTON', 5, 15_000),
              line(simpleProduct, 'SAC', 5, 2_000),
            ],
          }),
        )
      } finally {
        execSql('DROP TRIGGER test_fail_first_sale_movement')
      }

      assert.equal(invoiceCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(paymentCount(), 0)
      assert.equal(movementCount(), 3)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 20)

      // The failed facture consumed neither its reference nor its movements.
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 5, 2_000)] })

      assert.equal(invoice.reference, 'VTE-000001')
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 15)
    })

    it('annule tout si une ligne échoue', () => {
      execSql(`
        CREATE TRIGGER test_fail_second_sale_item
        BEFORE INSERT ON sale_items
        WHEN (SELECT count(*) FROM sale_items) > 0
        BEGIN
          SELECT RAISE(ABORT, 'injected failure');
        END;
      `)

      try {
        assert.throws(() =>
          createInvoice({
            items: [
              line(transformableProduct, 'CARTON', 5, 15_000),
              line(simpleProduct, 'SAC', 5, 2_000),
            ],
          }),
        )
      } finally {
        execSql('DROP TRIGGER test_fail_second_sale_item')
      }

      assert.equal(invoiceCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(movementCount(), 3)
    })

    it('n\'écrit rien quand un produit est inactif au milieu des lignes', () => {
      setProductActive(transformableProduct.id, false)

      expectInvoiceError('productInactive', () =>
        createInvoice({
          items: [
            line(simpleProduct, 'SAC', 5, 2_000),
            line(transformableProduct, 'CARTON', 5, 15_000),
          ],
        }),
      )

      assert.equal(invoiceCount(), 0)
      assert.equal(movementCount(), 3)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 20)
    })
  })

  describe('statut de paiement', () => {
    it('dérive NON_PAYEE, PARTIELLEMENT_PAYEE et PAYEE des paiements', () => {
      assert.equal(computePaymentStatus(50_000, 0), 'NON_PAYEE')
      assert.equal(computePaymentStatus(50_000, 20_000), 'PARTIELLEMENT_PAYEE')
      assert.equal(computePaymentStatus(50_000, 49_999), 'PARTIELLEMENT_PAYEE')
      assert.equal(computePaymentStatus(50_000, 50_000), 'PAYEE')
    })

    it('passe de NON_PAYEE à PAYEE par les paiements', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 10, 5_000)] })

      assert.equal(invoice.paymentStatus, 'NON_PAYEE')
      assert.deepEqual(summary(0, 50_000, 'NON_PAYEE'), invoice.paymentSummary)

      addPayment(invoice.id, 20_000)

      const partial = getInvoiceById(invoice.id)

      assert.deepEqual(summary(20_000, 30_000, 'PARTIELLEMENT_PAYEE'), partial.paymentSummary)
      assert.equal(partial.paidAmount, 20_000)
      assert.equal(partial.remainingAmount, 30_000)
      assert.equal(partial.paymentStatus, 'PARTIELLEMENT_PAYEE')

      addPayment(invoice.id, 30_000)

      const paid = getInvoiceById(invoice.id)

      assert.deepEqual(summary(50_000, 0, 'PAYEE'), paid.paymentSummary)
      assert.equal(getInvoicePaymentSummary(invoice.id).status, 'PAYEE')
      assert.equal(paymentCount(), 2)
    })

    it('refuse un paiement supérieur au reste à payer', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 10, 5_000)] })

      addPayment(invoice.id, 30_000)

      expectInvoiceError('paymentTooHigh', () => addPayment(invoice.id, 20_001))

      assert.equal(paymentCount(), 1)
      assert.equal(getInvoicePaymentSummary(invoice.id).paidAmount, 30_000)

      // The exact remaining amount is always accepted.
      addPayment(invoice.id, 20_000)

      assert.equal(getInvoicePaymentSummary(invoice.id).status, 'PAYEE')
      expectInvoiceError('paymentTooHigh', () => addPayment(invoice.id, 1))
    })

    it('refuse un montant nul, négatif, décimal ou trop grand', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 10, 5_000)] })

      expectInvoiceError('paymentInvalid', () => addPayment(invoice.id, 0))
      expectInvoiceError('paymentInvalid', () => addPayment(invoice.id, -100))
      expectInvoiceError('paymentInvalid', () => addPayment(invoice.id, 1_000.5))
      expectInvoiceError('paymentTooHigh', () => addPayment(invoice.id, 1_000_000_001))
      expectInvoiceError('paymentRequired', () => addPayment(invoice.id, undefined as never))

      assert.equal(paymentCount(), 0)
      expectInvoiceError('notFound', () => addPayment(4242, 1_000))
      expectInvoiceError('notFound', () => addPayment(0, 1_000))
    })

    it('refuse un paiement sur une facture annulée ou inexistante', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })

      cancelInvoice(invoice.id)

      expectInvoiceError('paymentOnCancelledSale', () => addPayment(invoice.id, 100))
    })

    it('enregistre la date du paiement et la date du jour par défaut', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 5_000)] })

      const dated = addPayment(invoice.id, 1_000, '2026-10-03')

      assert.equal(dated.saleId, invoice.id)
      assert.equal(dated.amount, 1_000)
      assert.equal(dated.paymentDate.getFullYear(), 2026)
      assert.equal(dated.paymentDate.getMonth(), 9)
      assert.equal(dated.paymentDate.getDate(), 3)

      const today = addPayment(invoice.id, 1_000)

      assert.equal(today.paymentDate.getFullYear(), new Date().getFullYear())

      expectInvoiceError('dateInvalid', () => addPayment(invoice.id, 1_000, '03/10/2026'))
      expectInvoiceError('dateInvalid', () => addPayment(invoice.id, 1_000, '2026-02-31'))
      expectInvoiceError('dateOutOfRange', () => addPayment(invoice.id, 1_000, '1999-12-31'))

      assert.equal(paymentCount(), 2)
    })
  })

  describe('paiements', () => {
    it('modifie un paiement en recalculant hors de l\'ancien montant', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 10, 5_000)] })

      const first = addPayment(invoice.id, 20_000, '2026-10-03')
      const second = addPayment(invoice.id, 10_000, '2026-10-04')

      // 20 000 + 25 000 = 45 000 <= 50 000
      const updated = updatePayment(second.id, 25_000, '2026-10-05')

      assert.equal(updated.id, second.id)
      assert.equal(updated.amount, 25_000)
      assert.equal(updated.paymentDate.getDate(), 5)
      assert.equal(getInvoicePaymentSummary(invoice.id).paidAmount, 45_000)
      assert.equal(getInvoicePaymentSummary(invoice.id).status, 'PARTIELLEMENT_PAYEE')
      assert.equal(first.amount, 20_000)

      // 20 000 + 40 000 = 60 000 > 50 000
      expectInvoiceError('paymentTooHigh', () => updatePayment(second.id, 40_000))
      expectInvoiceError('paymentTooHigh', () => updatePayment(first.id, 50_001))
      expectInvoiceError('paymentInvalid', () => updatePayment(second.id, 0))

      assert.equal(getInvoicePaymentSummary(invoice.id).paidAmount, 45_000)

      // The total itself is always allowed on the remaining facture.
      const full = updatePayment(second.id, 30_000)

      assert.equal(full.amount, 30_000)
      assert.equal(getInvoicePaymentSummary(invoice.id).status, 'PAYEE')
    })

    it('conserve la date du paiement quand elle n\'est pas renvoyée', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 10, 5_000)] })
      const payment = addPayment(invoice.id, 5_000, '2026-10-03')

      const updated = updatePayment(payment.id, 6_000)

      assert.equal(updated.paymentDate.getTime(), payment.paymentDate.getTime())
    })

    it('supprime un paiement et recalcule le statut', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 10, 5_000)] })

      addPayment(invoice.id, 20_000)
      const second = addPayment(invoice.id, 30_000)

      assert.equal(getInvoicePaymentSummary(invoice.id).status, 'PAYEE')

      deletePayment(second.id)

      assert.deepEqual(summary(20_000, 30_000, 'PARTIELLEMENT_PAYEE'), getInvoicePaymentSummary(invoice.id))
      assert.equal(paymentCount(), 1)

      deletePayment(listInvoicePayments(invoice.id)[0].id)

      assert.deepEqual(summary(0, 50_000, 'NON_PAYEE'), getInvoicePaymentSummary(invoice.id))
      assert.equal(paymentCount(), 0)
    })

    it('refuse de modifier ou supprimer un paiement inexistant', () => {
      expectInvoiceError('paymentNotFound', () => updatePayment(4242, 1_000))
      expectInvoiceError('paymentNotFound', () => updatePayment(0, 1_000))
      expectInvoiceError('paymentNotFound', () => deletePayment(4242))
      expectInvoiceError('paymentNotFound', () => deletePayment(0))
      expectInvoiceError('notFound', () => listInvoicePayments(4242))
      expectInvoiceError('notFound', () => getInvoicePaymentSummary(4242))
    })

    it('liste les paiements de la plus récente à la plus ancienne', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 10, 5_000)] })

      addPayment(invoice.id, 1_000, '2026-10-03')
      addPayment(invoice.id, 2_000, '2026-10-04')

      assert.deepEqual(
        listInvoicePayments(invoice.id).map((payment) => [
          payment.amount,
          payment.paymentDate.getDate(),
        ]),
        [
          [2_000, 4],
          [1_000, 3],
        ],
      )
    })
  })

  describe('verrouillage', () => {
    it('laisse modifier une facture non payée', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 2, 2_000)] })

      const updated = updateInvoice(invoice.id, {
        items: [line(simpleProduct, 'SAC', 3, 2_500)],
      })

      assert.equal(updated.items[0].quantity, 3)
      assert.equal(updated.items[0].unitPrice, 2_500)
      assert.equal(updated.totalAmount, 7_500)
    })

    it('verrouille le contenu d\'une facture partiellement payée', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 2, 2_000)] })

      addPayment(invoice.id, 2_000)

      expectInvoiceError('locked', () =>
        updateInvoice(invoice.id, { items: [line(simpleProduct, 'SAC', 5, 2_000)] }),
      )
      expectInvoiceError('locked', () =>
        updateInvoice(invoice.id, { clientId: null, items: [line(simpleProduct, 'SAC', 2, 2_000)] }),
      )

      const reread = getInvoiceById(invoice.id)

      assert.equal(reread.items[0].quantity, 2)
      assert.equal(reread.totalAmount, 4_000)
      assert.equal(reread.paidAmount, 2_000)

      // The payments themselves stay editable.
      const payment = listInvoicePayments(invoice.id)[0]

      assert.equal(updatePayment(payment.id, 3_000).amount, 3_000)
      assert.equal(getInvoicePaymentSummary(invoice.id).paidAmount, 3_000)

      deletePayment(payment.id)

      assert.equal(getInvoicePaymentSummary(invoice.id).status, 'NON_PAYEE')
      // Once the facture is unpaid again, its content can be modified.
      assert.equal(
        updateInvoice(invoice.id, { items: [line(simpleProduct, 'SAC', 5, 2_000)] })
          .items[0].quantity,
        5,
      )
    })

    it('verrouille le contenu d\'une facture payée', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 2, 2_000)] })

      addPayment(invoice.id, 4_000)

      assert.equal(getInvoicePaymentSummary(invoice.id).status, 'PAYEE')

      expectInvoiceError('locked', () =>
        updateInvoice(invoice.id, { items: [line(simpleProduct, 'SAC', 1, 1_000)] }),
      )

      const payment = listInvoicePayments(invoice.id)[0]

      assert.equal(updatePayment(payment.id, 3_000).amount, 3_000)
      assert.equal(getInvoicePaymentSummary(invoice.id).status, 'PARTIELLEMENT_PAYEE')
      expectInvoiceError('locked', () =>
        updateInvoice(invoice.id, { items: [line(simpleProduct, 'SAC', 1, 1_000)] }),
      )

      assert.equal(deletePayment(payment.id), null)
      assert.equal(getInvoicePaymentSummary(invoice.id).status, 'NON_PAYEE')
    })

    it('refuse de modifier une facture annulée', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 2, 2_000)] })

      cancelInvoice(invoice.id)

      expectInvoiceError('alreadyCancelled', () =>
        updateInvoice(invoice.id, { items: [line(simpleProduct, 'SAC', 1, 2_000)] }),
      )
    })

    it('refuse une facture inexistante', () => {
      expectInvoiceError('notFound', () =>
        updateInvoice(4242, { items: [line(simpleProduct, 'SAC', 1, 100)] }),
      )
      expectInvoiceError('notFound', () =>
        updateInvoice(0, { items: [line(simpleProduct, 'SAC', 1, 100)] }),
      )
      expectInvoiceError('notFound', () => cancelInvoice(4242))
      expectInvoiceError('notFound', () => deleteInvoice(4242))
      expectInvoiceError('notFound', () => getInvoiceById(4242))
      expectInvoiceError('notFound', () => getInvoiceById(0))
      expectInvoiceError('notFound', () => getInvoiceByReference('VTE-999999'))
    })
  })

  describe('modification', () => {
    it('modifie le client et la date', () => {
      const invoice = createInvoice({
        date: '2026-10-04',
        clientId: client.id,
        items: [line(simpleProduct, 'SAC', 2, 2_000)],
      })

      const updated = updateInvoice(invoice.id, {
        date: '2026-10-06',
        items: [line(simpleProduct, 'SAC', 2, 2_000)],
      })

      assert.equal(updated.clientId, client.id)
      assert.equal(updated.saleDate.getDate(), 6)

      // No client submitted: the current one is kept.
      assert.equal(
        updateInvoice(invoice.id, { items: [line(simpleProduct, 'SAC', 2, 2_000)] })
          .clientId,
        client.id,
      )

      // An explicit null goes back to the system client.
      const comptant = updateInvoice(invoice.id, {
        clientId: null,
        items: [line(simpleProduct, 'SAC', 2, 2_000)],
      })

      assert.equal(comptant.clientName, 'CLIENT COMPTANT')
      // No compensating movement at all: only the client and the date changed.
      assert.equal(movementCount(), 4)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 18)
    })

    it('modifie le prix sans toucher au stock', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 2, 2_000)] })

      const updated = updateInvoice(invoice.id, {
        items: [line(simpleProduct, 'SAC', 2, 1_400)],
      })

      assert.equal(updated.items[0].unitPrice, 1_400)
      assert.equal(updated.totalAmount, 2_800)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 18)
      assert.equal(
        movementsOf(simpleProduct.id).filter(([type]) => type === 'SALE').length,
        1,
      )
    })

    it('augmente la quantité avec un seul mouvement compensatoire', () => {
      // 20 CARTONS, a facture of 5: the stock is really at 15.
      const product = seedSimpleProduct(category, 'RIZ 25 KG')

      initializeStock(product.id, {
        productId: product.id,
        quantities: [{ form: 'SAC', quantity: 20 }],
      })

      const invoice = createInvoice({ items: [line(product, 'SAC', 5, 4_000)] })

      assert.equal(balanceOf(product.id, 'SAC'), 15)

      updateInvoice(invoice.id, { items: [line(product, 'SAC', 8, 4_000)] })

      // 5 -> 8 writes only OUT 3.
      assert.equal(balanceOf(product.id, 'SAC'), 12)
      assert.deepEqual(
        movementsOf(product.id).map(([type, direction, quantity]) => [
          type,
          direction,
          quantity,
        ]),
        [
          ['STOCK_INITIAL', 'IN', 20],
          ['SALE', 'OUT', 5],
          ['SALE', 'OUT', 3],
        ],
      )
    })

    it('diminue la quantité avec un seul mouvement compensatoire', () => {
      const invoice = createInvoice({ items: [line(transformableProduct, 'CARTON', 8, 15_000)] })

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 2)

      updateInvoice(invoice.id, { items: [line(transformableProduct, 'CARTON', 3, 15_000)] })

      // 8 -> 3 writes only IN 5.
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 7)
      assert.deepEqual(
        movementsOf(transformableProduct.id).slice(-2),
        [
          ['SALE', 'OUT', 8, 'Facture VTE-000001'],
          ['AJUSTEMENT', 'IN', 5, 'Modification facture VTE-000001'],
        ],
      )
    })

    it('ne modifie ni ne supprime jamais les mouvements d\'origine', () => {
      const invoice = createInvoice({ items: [line(transformableProduct, 'CARTON', 5, 15_000)] })

      updateInvoice(invoice.id, { items: [line(transformableProduct, 'CARTON', 2, 15_000)] })
      updateInvoice(invoice.id, { items: [line(transformableProduct, 'CARTON', 9, 15_000)] })

      const sales = movementsOf(transformableProduct.id).filter(([type]) => type === 'SALE')

      // The initial SALE 5 is still there, ids included.
      assert.deepEqual(sales[0], ['SALE', 'OUT', 5, 'Facture VTE-000001'])
      // 5 -> 2 gives IN 3 back, 2 -> 9 takes OUT 7 more: the SALE 5 of the
      // creation is still there.
      assert.deepEqual(
        movementsOf(transformableProduct.id).map(([, direction, quantity]) => [
          direction,
          quantity,
        ]),
        [
          ['IN', 10],
          ['IN', 2],
          ['OUT', 5],
          ['IN', 3],
          ['OUT', 7],
        ],
      )
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 1)
    })

    it('compense un changement de produit', () => {
      const riz = seedSimpleProduct(category, 'RIZ 25 KG')

      initializeStock(riz.id, {
        productId: riz.id,
        quantities: [{ form: 'SAC', quantity: 10 }],
      })

      const invoice = createInvoice({ items: [line(transformableProduct, 'CARTON', 5, 15_000)] })

      updateInvoice(invoice.id, { items: [line(riz, 'SAC', 3, 5_000)] })

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
      assert.equal(balanceOf(riz.id, 'SAC'), 7)
      assert.deepEqual(movementsOf(transformableProduct.id).slice(-1), [
        ['AJUSTEMENT', 'IN', 5, 'Modification facture VTE-000001'],
      ])
      assert.deepEqual(movementsOf(riz.id).slice(-1), [
        ['SALE', 'OUT', 3, 'Facture VTE-000001'],
      ])

      const reread = getInvoiceById(invoice.id)

      assert.equal(reread.items.length, 1)
      assert.equal(reread.items[0].productId, riz.id)
      assert.equal(reread.items[0].productName, 'RIZ 25 KG')
      assert.equal(reread.totalAmount, 15_000)
    })

    it('compense un changement de forme sans conversion automatique', () => {
      const invoice = createInvoice({ items: [line(transformableProduct, 'CARTON', 5, 15_000)] })

      updateInvoice(invoice.id, { items: [line(transformableProduct, 'SEAU', 2, 4_000)] })

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 0)
      assert.deepEqual(movementsOf(transformableProduct.id).slice(-2), [
        ['SALE', 'OUT', 2, 'Facture VTE-000001'],
        ['AJUSTEMENT', 'IN', 5, 'Modification facture VTE-000001'],
      ])
      assert.equal(getInvoiceById(invoice.id).totalAmount, 8_000)
    })

    it('ajoute et supprime des lignes dans la même modification', () => {
      const invoice = createInvoice({ items: [line(transformableProduct, 'CARTON', 5, 15_000)] })

      updateInvoice(invoice.id, {
        items: [
          line(simpleProduct, 'SAC', 4, 2_000),
          line(transformableProduct, 'CARTON', 6, 15_000),
        ],
      })

      // 10 CARTON - 6 CARTON sold on the facture
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 4)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 16)

      const reread = getInvoiceById(invoice.id)

      assert.equal(reread.items.length, 2)
      assert.equal(reread.totalAmount, 98_000)
      assert.deepEqual(
        movementsOf(transformableProduct.id).map(([, direction, quantity]) => [
          direction,
          quantity,
        ]),
        [
          ['IN', 10],
          ['IN', 2],
          ['OUT', 5],
          ['OUT', 1],
        ],
      )
    })

    it('donne la quantité disponible en restored par l\'ancienne facture', () => {
      // Stock really at 5 because the facture already took 3 out of 8.
      const product = seedSimpleProduct(category, 'RIZ 25 KG')

      initializeStock(product.id, {
        productId: product.id,
        quantities: [{ form: 'SAC', quantity: 8 }],
      })

      const invoice = createInvoice({ items: [line(product, 'SAC', 3, 4_000)] })

      assert.equal(balanceOf(product.id, 'SAC'), 5)

      // 5 + 3 = 8 available, so 7 is allowed although only 5 are on the shelf.
      const updated = updateInvoice(invoice.id, { items: [line(product, 'SAC', 7, 4_000)] })

      assert.equal(updated.items[0].quantity, 7)
      assert.equal(balanceOf(product.id, 'SAC'), 1)

      // 9 is not: 8 available is the maximum.
      expectInvoiceError('insufficientStock', () =>
        updateInvoice(invoice.id, { items: [line(product, 'SAC', 9, 4_000)] }),
      )

      assert.equal(balanceOf(product.id, 'SAC'), 1)
      assert.equal(getInvoiceById(invoice.id).items[0].quantity, 7)
    })

    it('refuse une modification en stock insuffisant et annule tout', () => {
      const invoice = createInvoice({ items: [line(transformableProduct, 'CARTON', 5, 15_000)] })

      expectInvoiceError('insufficientStock', () =>
        updateInvoice(invoice.id, {
          items: [
            line(transformableProduct, 'CARTON', 5, 15_000),
            line(transformableProduct, 'SEAU', 5, 4_000),
          ],
        }),
      )

      const reread = getInvoiceById(invoice.id)

      assert.equal(reread.items.length, 1)
      assert.equal(reread.totalAmount, 75_000)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 5)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 2)
      assert.equal(movementCount(), 4)
    })

    it('annule tout si un mouvement compensatoire échoue', () => {
      const invoice = createInvoice({ items: [line(transformableProduct, 'CARTON', 5, 15_000)] })

      execSql(`
        CREATE TRIGGER test_fail_compensating_movement
        BEFORE INSERT ON stock_movements
        WHEN NEW.movement_type = 'AJUSTEMENT'
        BEGIN
          SELECT RAISE(ABORT, 'injected failure');
        END;
      `)

      try {
        assert.throws(() =>
          updateInvoice(invoice.id, { items: [line(transformableProduct, 'CARTON', 2, 15_000)] }),
        )
      } finally {
        execSql('DROP TRIGGER test_fail_compensating_movement')
      }

      const reread = getInvoiceById(invoice.id)

      assert.equal(reread.items[0].quantity, 5)
      assert.equal(reread.totalAmount, 75_000)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 5)
      assert.equal(itemCount(), 1)
      assert.equal(movementCount(), 4)
    })

    it('applique les mêmes validations qu\'à la création', () => {
      const invoice = createInvoice({ items: [line(transformableProduct, 'CARTON', 5, 15_000)] })

      expectInvoiceError('itemsRequired', () => updateInvoice(invoice.id, { items: [] }))
      expectInvoiceError('quantityInvalid', () =>
        updateInvoice(invoice.id, { items: [line(transformableProduct, 'CARTON', 0, 15_000)] }),
      )
      expectInvoiceError('duplicateLine', () =>
        updateInvoice(invoice.id, {
          items: [
            line(transformableProduct, 'CARTON', 1, 15_000),
            line(transformableProduct, 'CARTON', 2, 15_000),
          ],
        }),
      )
      expectInvoiceError('formInvalid', () =>
        updateInvoice(invoice.id, { items: [line(transformableProduct, 'BIDON', 1, 15_000)] }),
      )
      expectInvoiceError('clientNotFound', () =>
        updateInvoice(invoice.id, {
          clientId: 4242,
          items: [line(transformableProduct, 'CARTON', 1, 15_000)],
        }),
      )
      expectInvoiceError('unitPriceInvalid', () =>
        updateInvoice(invoice.id, { items: [line(transformableProduct, 'CARTON', 1, -5)] }),
      )
      expectInvoiceError('productInactive', () => {
        setProductActive(transformableProduct.id, false)

        return updateInvoice(invoice.id, { items: [line(transformableProduct, 'CARTON', 1, 15_000)] })
      })

      assert.equal(getInvoiceById(invoice.id).items[0].quantity, 5)
    })
  })

  describe('annulation', () => {
    it('annule une facture non payée et restitue le stock', () => {
      const invoice = createInvoice({
        items: [
          line(transformableProduct, 'CARTON', 5, 15_000),
          line(transformableProduct, 'SEAU', 2, 4_000),
        ],
      })

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 5)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 0)

      const cancelled = cancelInvoice(invoice.id)

      assert.equal(cancelled.status, 'ANNULEE')
      assert.equal(cancelled.reference, 'VTE-000001')
      assert.equal(cancelled.totalAmount, 83_000)
      assert.equal(getInvoiceById(invoice.id).status, 'ANNULEE')

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 2)

      // The original movements are kept: the history is append-only.
      assert.deepEqual(movementsOf(transformableProduct.id).slice(-2), [
        ['AJUSTEMENT', 'IN', 5, 'Annulation facture VTE-000001'],
        ['AJUSTEMENT', 'IN', 2, 'Annulation facture VTE-000001'],
      ])
      assert.equal(movementCount(), 7)
    })

    it('annule une facture dont la date a été modifiée', () => {
      const invoice = createInvoice({ items: [line(transformableProduct, 'CARTON', 5, 15_000)] })

      updateInvoice(invoice.id, { items: [line(transformableProduct, 'CARTON', 8, 15_000)] })
      cancelInvoice(invoice.id)

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
      assert.deepEqual(
        movementsOf(transformableProduct.id).map(([, direction, quantity]) => [
          direction,
          quantity,
        ]),
        [
          ['IN', 10],
          ['IN', 2],
          ['OUT', 5],
          ['OUT', 3],
          ['IN', 8],
        ],
      )
    })

    it('refuse d\'annuler une facture partiellement payée ou payée', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 10, 5_000)] })

      addPayment(invoice.id, 20_000)

      expectInvoiceError('cancelNotAllowed', () => cancelInvoice(invoice.id))
      assert.equal(getInvoiceById(invoice.id).status, 'VALIDEE')

      addPayment(invoice.id, 30_000)

      expectInvoiceError('cancelNotAllowed', () => cancelInvoice(invoice.id))
      assert.equal(getInvoiceById(invoice.id).status, 'VALIDEE')
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 10)
    })

    it('annule après suppression du paiement', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 10, 5_000)] })
      const payment = addPayment(invoice.id, 20_000)

      expectInvoiceError('cancelNotAllowed', () => cancelInvoice(invoice.id))

      deletePayment(payment.id)

      assert.equal(cancelInvoice(invoice.id).status, 'ANNULEE')
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 20)
    })

    it('refuse d\'annuler deux fois une facture déjà annulée', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })

      cancelInvoice(invoice.id)

      expectInvoiceError('alreadyCancelled', () => cancelInvoice(invoice.id))
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 20)
    })

    it('annule tout si un mouvement de restitution échoue', () => {
      const invoice = createInvoice({ items: [line(transformableProduct, 'CARTON', 5, 15_000)] })

      execSql(`
        CREATE TRIGGER test_fail_cancellation_movement
        BEFORE INSERT ON stock_movements
        WHEN (SELECT count(*) FROM stock_movements) > 3
        BEGIN
          SELECT RAISE(ABORT, 'injected failure');
        END;
      `)

      try {
        assert.throws(() => cancelInvoice(invoice.id))
      } finally {
        execSql('DROP TRIGGER test_fail_cancellation_movement')
      }

      assert.equal(getInvoiceById(invoice.id).status, 'VALIDEE')
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 5)
      assert.equal(movementCount(), 4)
    })
  })

  describe('suppression', () => {
    it('refuse de supprimer une facture validée', () => {
      const invoice = createInvoice({ items: [line(transformableProduct, 'CARTON', 5, 15_000)] })

      expectInvoiceError('deleteNotAllowed', () => deleteInvoice(invoice.id))

      assert.equal(invoiceCount(), 1)
      assert.equal(itemCount(), 1)
    })

    it('refuse de supprimer une facture partiellement payée ou payée', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 10, 5_000)] })

      addPayment(invoice.id, 20_000)

      expectInvoiceError('deleteNotAllowed', () => deleteInvoice(invoice.id))
      expectInvoiceError('cancelNotAllowed', () => cancelInvoice(invoice.id))

      addPayment(invoice.id, 30_000)

      expectInvoiceError('deleteNotAllowed', () => deleteInvoice(invoice.id))

      assert.equal(invoiceCount(), 1)
      assert.equal(paymentCount(), 2)
    })

    it('supprime une facture annulée, ses lignes, et garde les mouvements', () => {
      const invoice = createInvoice({
        items: [
          line(transformableProduct, 'CARTON', 5, 15_000),
          line(simpleProduct, 'SAC', 2, 2_000),
        ],
      })

      cancelInvoice(invoice.id)

      assert.equal(deleteInvoice(invoice.id), null)

      assert.equal(invoiceCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(paymentCount(), 0)
      assert.equal(listInvoices().length, 0)
      expectInvoiceError('notFound', () => getInvoiceById(invoice.id))
      expectInvoiceError('notFound', () => cancelInvoice(invoice.id))

      // 3 STOCK_INITIAL + 2 SALE + 2 AJUSTEMENT IN, all kept after the deletion.
      assert.equal(movementCount(), 7)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 20)
    })

    it('supprime une facture annulée même dont les lignes ont été modifiées', () => {
      const invoice = createInvoice({ items: [line(transformableProduct, 'CARTON', 5, 15_000)] })

      updateInvoice(invoice.id, { items: [line(simpleProduct, 'SAC', 3, 2_000)] })
      cancelInvoice(invoice.id)
      deleteInvoice(invoice.id)

      assert.equal(invoiceCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 20)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
    })
  })

  describe('lecture', () => {
    it('liste les factures de la plus récente à la plus ancienne', () => {
      createInvoice({ date: '2026-10-03', items: [line(simpleProduct, 'SAC', 2, 1_000)] })
      const second = createInvoice({
        date: '2026-10-04',
        items: [line(transformableProduct, 'CARTON', 10, 15_000)],
      })

      addPayment(second.id, 50_000)

      const list = listInvoices()

      assert.deepEqual(
        list.map((invoice) => [
          invoice.reference,
          invoice.totalAmount,
          invoice.paidAmount,
          invoice.remainingAmount,
          invoice.paymentStatus,
        ]),
        [
          ['VTE-000002', 150_000, 50_000, 100_000, 'PARTIELLEMENT_PAYEE'],
          ['VTE-000001', 2_000, 0, 2_000, 'NON_PAYEE'],
        ],
      )
    })

    it('filtre la liste par référence, par client et par statut', () => {
      createInvoice({ items: [line(simpleProduct, 'SAC', 1, 1_000)] })
      createInvoice({
        clientId: client.id,
        items: [line(transformableProduct, 'CARTON', 1, 15_000)],
      })

      assert.deepEqual(
        listInvoices({ search: 'vte-000002' }).map((invoice) => invoice.reference),
        ['VTE-000002'],
      )
      assert.deepEqual(
        listInvoices({ clientSearch: 'awa' }).map((invoice) => invoice.reference),
        ['VTE-000002'],
      )
      assert.deepEqual(
        listInvoices({ clientSearch: 'zzz' }),
        [],
      )
      assert.deepEqual(
        listInvoices({ status: 'ANNULEE' }),
        [],
      )

      cancelInvoice(listInvoices()[1].id)

      assert.deepEqual(
        listInvoices({ status: 'ANNULEE' }).map((invoice) => invoice.reference),
        ['VTE-000001'],
      )
    })

    it('filtre la liste par date de facture', () => {
      const first = createInvoice({
        date: '2026-10-04',
        items: [line(simpleProduct, 'SAC', 1, 1_000)],
      })
      const second = createInvoice({
        date: '2026-10-07',
        items: [line(simpleProduct, 'SAC', 1, 1_000)],
      })

      assert.deepEqual(
        listInvoices({ dateFrom: '2026-10-07', dateTo: '2026-10-07' }).map((invoice) => invoice.reference),
        [second.reference],
      )
      assert.deepEqual(
        listInvoices({ dateFrom: '2026-10-04', dateTo: '2026-10-06' }).map((invoice) => invoice.reference),
        [first.reference],
      )
      assert.deepEqual(
        listInvoices({ dateFrom: '2026-10-01' }).map((invoice) => invoice.reference),
        [second.reference, first.reference],
      )
    })

    it('relit une facture par identifiant et par référence', () => {
      const created = createInvoice({ items: [line(simpleProduct, 'SAC', 2, 1_000)] })

      assert.deepEqual(getInvoiceById(created.id).items, created.items)
      assert.deepEqual(getInvoiceByReference('vte-000001').items, created.items)
      assert.equal(getInvoiceByReference('  vte-000001  ').id, created.id)
    })

    it('affiche la date de facture choisie', () => {
      const invoice = createInvoice({
        date: '2026-10-04',
        items: [line(simpleProduct, 'SAC', 1, 100)],
      })

      assert.equal(invoice.saleDate.getFullYear(), 2026)
      assert.equal(invoice.saleDate.getMonth(), 9)
      assert.equal(invoice.saleDate.getDate(), 4)
      assert.equal(listInvoices()[0].saleDate.getTime(), invoice.saleDate.getTime())
    })
  })

  describe('intégrité SQLite', () => {
    it('interdit une facture sans client, avec un statut inconnu ou un total négatif', () => {
      const base = {
        reference: 'VTE-000001',
        clientId: client.id,
        saleDate: new Date(2026, 9, 4),
        status: 'VALIDEE' as const,
        totalAmount: 0,
        createdAt: new Date(),
      }

      assert.throws(() =>
        getDb()
          .insert(sales)
          .values({ ...base, clientId: null as never })
          .run(),
      )

      assert.throws(() =>
        getDb()
          .insert(sales)
          .values({ ...base, status: 'SUPPRIMEE' as never })
          .run(),
      )

      assert.throws(() =>
        getDb()
          .insert(sales)
          .values({ ...base, totalAmount: -1 })
          .run(),
      )

      assert.throws(() =>
        getDb()
          .insert(sales)
          .values({ ...base, reference: null as never })
          .run(),
      )

      assert.equal(invoiceCount(), 0)
    })

    it('interdit une facture rattachée à un client inexistant', () => {
      assert.throws(() =>
        getDb()
          .insert(sales)
          .values({
            reference: 'VTE-000001',
            clientId: 4242,
            saleDate: new Date(2026, 9, 4),
            status: 'VALIDEE',
            totalAmount: 0,
            createdAt: new Date(),
          })
          .run(),
      )

      assert.equal(invoiceCount(), 0)
    })

    it('interdit une ligne à quantité nulle, prix négatif ou total négatif', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })

      const base = {
        saleId: invoice.id,
        productId: simpleProduct.id,
        form: 'SEAU',
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100,
      }

      assert.throws(() =>
        getDb()
          .insert(saleItems)
          .values({ ...base, form: 'SAC', quantity: 0, lineTotal: 0 })
          .run(),
      )

      assert.throws(() =>
        getDb()
          .insert(saleItems)
          .values({ ...base, form: 'BIDON', unitPrice: -1, lineTotal: -1 })
          .run(),
      )

      assert.throws(() =>
        getDb()
          .insert(saleItems)
          .values({ ...base, form: 'LITRE', lineTotal: -100 })
          .run(),
      )

      assert.throws(() =>
        getDb()
          .insert(saleItems)
          .values({ ...base, form: 'BIDON', productId: 4242 })
          .run(),
      )

      assert.equal(itemCount(), 1)
    })

    it('interdit deux lignes identiques sur une même facture', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })

      assert.throws(() =>
        getDb()
          .insert(saleItems)
          .values({
            saleId: invoice.id,
            productId: simpleProduct.id,
            form: 'SAC',
            quantity: 7,
            unitPrice: 100,
            lineTotal: 700,
          })
          .run(),
      )

      assert.equal(itemCount(), 1)
    })

    it('interdit un paiement nul, négatif ou sans facture', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 100)] })
      const base = { saleId: invoice.id, amount: 1_000, paymentDate: new Date() }

      assert.throws(() => getDb().insert(payments).values({ ...base, amount: 0 }).run())
      assert.throws(() => getDb().insert(payments).values({ ...base, amount: -1 }).run())
      assert.throws(() =>
        getDb().insert(payments).values({ ...base, saleId: 4242 }).run(),
      )
      assert.throws(() =>
        getDb().insert(payments).values({ ...base, amount: null as never }).run(),
      )

      assert.equal(paymentCount(), 0)
    })

    it('interdit de supprimer un produit vendu et de supprimer un client facturé', () => {
      createInvoice({
        clientId: client.id,
        items: [line(transformableProduct, 'CARTON', 1, 15_000)],
      })

      assert.throws(() =>
        getDb()
          .delete(products)
          .where(eq(products.id, transformableProduct.id))
          .run(),
      )
      assert.throws(() => getDb().delete(clients).where(eq(clients.id, client.id)).run())

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 9)
    })

    it('impose les contraintes du mouvement SALE au niveau SQL', () => {
      // SALE is accepted, as an OUT movement naming its facture.
      getDb()
        .insert(stockMovements)
        .values({
          productId: transformableProduct.id,
          form: 'CARTON',
          movementType: 'SALE',
          direction: 'OUT',
          quantity: 1,
          reason: 'Facture VTE-000001',
        })
        .run()

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 9)

      // It is never an entry.
      assert.throws(() =>
        getDb()
          .insert(stockMovements)
          .values({
            productId: transformableProduct.id,
            form: 'CARTON',
            movementType: 'SALE',
            direction: 'IN',
            quantity: 1,
            reason: 'Facture VTE-000001',
          })
          .run(),
      )

      // And it always names the facture that wrote it.
      assert.throws(() =>
        getDb()
          .insert(stockMovements)
          .values({
            productId: transformableProduct.id,
            form: 'CARTON',
            movementType: 'SALE',
            direction: 'OUT',
            quantity: 1,
            reason: null,
          })
          .run(),
      )

      assert.throws(() =>
        getDb()
          .insert(stockMovements)
          .values({
            productId: transformableProduct.id,
            form: 'CARTON',
            // A type of a module that does not exist yet.
            movementType: 'VENTE' as never,
            direction: 'OUT',
            quantity: 1,
            reason: 'Facture VTE-000001',
          })
          .run(),
      )

      assert.equal(movementCount(), 4)
    })

    it('ne stocke ni mode de paiement ni statut de paiement', () => {
      const paymentColumns = columnsOf('payments')
      const saleColumns = columnsOf('sales')

      assert.equal(paymentColumns.includes('payment_method'), false)
      assert.equal(paymentColumns.includes('paid_amount'), false)
      assert.equal(paymentColumns.includes('payment_status'), false)
      assert.equal(saleColumns.includes('payment_status'), false)
      assert.equal(saleColumns.includes('paid_amount'), false)
      assert.equal(saleColumns.includes('remaining_amount'), false)
    })

    it('cascade les lignes et les paiements quand la facture disparaît', () => {
      const invoice = createInvoice({ items: [line(simpleProduct, 'SAC', 2, 100)] })

      addPayment(invoice.id, 100)

      getDb().delete(sales).where(eq(sales.id, invoice.id)).run()

      assert.equal(itemCount(), 0)
      assert.equal(paymentCount(), 0)
    })
  })

  describe('persistance', () => {
    it('conserve la facture, ses lignes, ses paiements et le stock après réouverture', () => {
      const invoice = createInvoice({
        date: '2026-10-04',
        clientId: client.id,
        items: [
          line(transformableProduct, 'CARTON', 5, 15_000),
          line(simpleProduct, 'SAC', 4, 2_500),
        ],
      })

      // The content is modified while the facture is still unpaid, then paid.
      updateInvoice(invoice.id, {
        date: '2026-10-06',
        items: [
          line(transformableProduct, 'CARTON', 5, 15_000),
          line(simpleProduct, 'SAC', 4, 2_500),
        ],
      })
      addPayment(invoice.id, 30_000, '2026-10-05')

      reopenTestDatabase()

      const reread = getInvoiceByReference('VTE-000001')

      assert.equal(reread.status, 'VALIDEE')
      assert.equal(reread.clientName, 'AWA DIOP')
      assert.equal(reread.saleDate.getDate(), 6)
      assert.equal(reread.totalAmount, 85_000)
      assert.equal(reread.items.length, 2)
      assert.deepEqual(summary(30_000, 55_000, 'PARTIELLEMENT_PAYEE'), reread.paymentSummary)
      assert.equal(listInvoicePayments(invoice.id)[0].amount, 30_000)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 5)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 16)

      const next = createInvoice({ items: [line(simpleProduct, 'SAC', 1, 2_500)] })

      assert.equal(next.reference, 'VTE-000002')
    })
  })
})

/** Small local helper, kept out of the shared test helpers. */
function columnsOf(table: string): string[] {
  const rows = getDb().$client.pragma(`table_info(${table})`) as unknown as {
    name: string
  }[]

  return rows.map((row) => row.name)
}

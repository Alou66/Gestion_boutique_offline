import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { registerIpcHandlers } from '../electron/ipc'
import { createClient, setClientActive } from '../electron/services/clientService'
import { INVOICE_ERRORS } from '../electron/services/invoiceService'
import { initializeStock } from '../electron/services/stockService'
import type {
  Category,
  Client,
  Payment,
  Product,
  Sale,
  SaleDetail,
  SaleItemInput,
  SaleResult,
} from '../electron/types'
import {
  closeTestDatabase,
  resetTestDatabase,
  seedCategory,
  seedSimpleProduct,
  seedTransformableProduct,
  setProductActive,
} from './helpers/database'
import { invokeHandler, registeredChannels } from './stubs/electron'

/**
 * The renderer only reaches the main process through the preload bridge. The
 * bridge is imported here so the test can inspect exactly what it published.
 */
import '../electron/preload'
import { exposedToMainWorld } from './stubs/electron'

const INVOICE_CHANNELS = [
  'invoices:create',
  'invoices:get-by-id',
  'invoices:get-by-reference',
  'invoices:list',
  'invoices:update',
  'invoices:cancel',
  'invoices:delete',
  'invoices:add-payment',
  'invoices:update-payment',
  'invoices:delete-payment',
  'invoices:get-payment-summary',
  'invoices:list-payments',
]

function invoke<T>(channel: string, ...args: unknown[]): SaleResult<T> {
  return invokeHandler(channel, ...args) as SaleResult<T>
}

/** Every business failure must come back as a readable message, never thrown. */
function expectFailure<T>(channel: string, ...args: unknown[]): string {
  const result = invoke<T>(channel, ...args)

  assert.equal(
    result.success,
    false,
    `${channel} must answer with an explicit business error, not a thrown error`,
  )

  return result.success ? '' : result.error
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

/** Creates one unpaid facture of 10 SUCRE SAC at 2 500 FCFA (total 25 000). */
function createInvoiceViaIpc(product: Product, clientId?: number): SaleDetail {
  const created = invoke<SaleDetail>('invoices:create', {
    date: '2026-10-04',
    clientId,
    items: [line(product, 'SAC', 10, 2_500)],
  })

  assert.equal(created.success, true)

  return created.success ? created.data : ({} as SaleDetail)
}

function collectKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (value === null || typeof value !== 'object') {
    return found
  }

  for (const [key, nested] of Object.entries(value)) {
    found.add(key)
    collectKeys(nested, found)
  }

  return found
}

/**
 * The bridge is the only door of the renderer: `ipcRenderer`, SQLite, Drizzle,
 * `fs` and `process` must never appear anywhere in what it publishes.
 */
describe('pont de sécurité du preload (facturation)', () => {
  const exposed = exposedToMainWorld.api as Record<string, Record<string, unknown>>

  it("publie une unique API sous window.api, sans ipcRenderer ni base de donnees", () => {
    assert.deepEqual(Object.keys(exposedToMainWorld), ['api'])
    assert.equal(typeof exposed, 'object')
    assert.equal(exposed, exposedToMainWorld.api)

    const keys = collectKeys(exposedToMainWorld)

    for (const forbidden of [
      'ipcRenderer',
      'ipcMain',
      'webFrame',
      'db',
      'getDb',
      'sqlite',
      'better-sqlite3',
      'drizzle',
      'fs',
      'path',
      'process',
      'require',
      'electron',
    ]) {
      assert.equal(keys.has(forbidden), false, `${forbidden} must not reach the renderer`)
    }
  })

  it('expose window.api.invoices avec les douze méthodes attendues', () => {
    const invoices = exposed.invoices

    assert.equal(typeof invoices, 'object')

    for (const method of [
      'create',
      'getById',
      'getByReference',
      'list',
      'update',
      'cancel',
      'delete',
      'addPayment',
      'updatePayment',
      'deletePayment',
      'getPaymentSummary',
      'listPayments',
    ]) {
      assert.equal(typeof invoices[method], 'function', `missing window.api.invoices.${method}`)
    }

    assert.equal(Object.keys(invoices).length, 12)
  })

  it('laisse les autres modules exposer leur API comme avant', () => {
    for (const module of [
      'database',
      'settings',
      'auth',
      'categories',
      'products',
      'stock',
      'supplies',
      'transformations',
      'clients',
    ]) {
      assert.equal(typeof exposed[module], 'object', `missing window.api.${module}`)
    }
  })
})

describe('canaux IPC des factures', () => {
  let category: Category
  let simpleProduct: Product
  let transformableProduct: Product
  let client: Client

  before(() => {
    registerIpcHandlers()
  })

  beforeEach(() => {
    resetTestDatabase()
    category = seedCategory('BOISSONS')
    simpleProduct = seedSimpleProduct(category, 'SUCRE 1 KG')
    transformableProduct = seedTransformableProduct(category, 'CHOCOPAIN 5 KG')
    client = createClient({ name: 'Awa Diop', phone: '771234567' })
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

  it('expose exactement les canaux attendus', () => {
    const channels = registeredChannels().filter((channel) => channel.startsWith('invoices:'))

    assert.deepEqual(channels, [...INVOICE_CHANNELS].sort())
  })

  describe('création', () => {
    it('crée une facture valide et renvoie son détail recalculé', () => {
      const created = invoke<SaleDetail>('invoices:create', {
        date: '2026-10-04',
        clientId: client.id,
        items: [line(simpleProduct, 'SAC', 10, 2_500)],
      })

      assert.equal(created.success, true)

      const invoice = created.success ? created.data : ({} as SaleDetail)

      assert.equal(invoice.reference, 'VTE-000001')
      assert.equal(invoice.status, 'VALIDEE')
      assert.equal(invoice.clientName, 'AWA DIOP')
      assert.equal(invoice.totalAmount, 25_000)
      assert.equal(invoice.paidAmount, 0)
      assert.equal(invoice.remainingAmount, 25_000)
      assert.equal(invoice.paymentStatus, 'NON_PAYEE')
      assert.deepEqual(invoice.paymentSummary, {
        paidAmount: 0,
        remainingAmount: 25_000,
        status: 'NON_PAYEE',
      })
      assert.equal(invoice.items.length, 1)
      assert.equal(invoice.items[0].unitPrice, 2_500)
      assert.equal(invoice.items[0].lineTotal, 25_000)
    })

    it('utilise le client comptant quand aucun client n’est choisi', () => {
      const created = invoke<SaleDetail>('invoices:create', {
        date: '2026-10-04',
        items: [line(simpleProduct, 'SAC', 2, 2_500)],
      })

      assert.equal(created.success, true)
      assert.equal(created.success ? created.data.clientName : '', 'CLIENT COMPTANT')
    })

    it('refuse un stock insuffisant', () => {
      assert.equal(
        expectFailure('invoices:create', {
          date: '2026-10-04',
          items: [line(simpleProduct, 'SAC', 21, 2_500)],
        }),
        INVOICE_ERRORS.insufficientStock,
      )

      assert.equal(
        expectFailure('invoices:create', {
          date: '2026-10-04',
          items: [line(simpleProduct, 'SAC', 5), line(transformableProduct, 'SEAU', 3)],
        }),
        INVOICE_ERRORS.insufficientStock,
      )
    })

    it('refuse un produit inactif', () => {
      setProductActive(simpleProduct.id, false)

      assert.equal(
        expectFailure('invoices:create', {
          date: '2026-10-04',
          items: [line(simpleProduct, 'SAC', 1, 2_500)],
        }),
        INVOICE_ERRORS.productInactive,
      )
    })

    it('refuse un client inactif et un client inexistant', () => {
      setClientActive(client.id, false)

      assert.equal(
        expectFailure('invoices:create', {
          date: '2026-10-04',
          clientId: client.id,
          items: [line(simpleProduct, 'SAC', 1, 2_500)],
        }),
        INVOICE_ERRORS.clientInactive,
      )

      assert.equal(
        expectFailure('invoices:create', {
          date: '2026-10-04',
          clientId: 4242,
          items: [line(simpleProduct, 'SAC', 1, 2_500)],
        }),
        INVOICE_ERRORS.clientNotFound,
      )
    })

    it('refuse une forme invalide, un produit inexistant et une date invalide', () => {
      assert.equal(
        expectFailure('invoices:create', {
          date: '2026-10-04',
          items: [line(simpleProduct, 'BIDON', 1, 2_500)],
        }),
        INVOICE_ERRORS.formInvalid,
      )

      assert.equal(
        expectFailure('invoices:create', {
          date: '2026-10-04',
          items: [line({ id: 4242 } as Product, 'SAC', 1, 2_500)],
        }),
        INVOICE_ERRORS.productNotFound,
      )

      assert.equal(
        expectFailure('invoices:create', {
          date: '04/10/2026',
          items: [line(simpleProduct, 'SAC', 1, 2_500)],
        }),
        INVOICE_ERRORS.dateInvalid,
      )
    })
  })

  describe('lecture', () => {
    it('relit une facture par id et par référence', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      const byId = invoke<SaleDetail>('invoices:get-by-id', invoice.id)
      const byReference = invoke<SaleDetail>('invoices:get-by-reference', 'vte-000001')

      assert.equal(byId.success ? byId.data.reference : '', 'VTE-000001')
      assert.equal(byReference.success ? byReference.data.id : -1, invoice.id)
      assert.equal(byReference.success ? byReference.data.items.length : -1, 1)
    })

    it('renvoie une facture inexistante comme erreur métier', () => {
      assert.equal(
        expectFailure('invoices:get-by-id', 4242),
        INVOICE_ERRORS.notFound,
      )
      assert.equal(
        expectFailure('invoices:get-by-reference', 'VTE-999999'),
        INVOICE_ERRORS.notFound,
      )
      assert.equal(
        expectFailure('invoices:get-by-id', 0),
        INVOICE_ERRORS.notFound,
      )
    })

    it('liste une liste vide puis plusieurs factures, de la plus récente à la plus ancienne', () => {
      const empty = invoke<Sale[]>('invoices:list')

      assert.equal(empty.success, true)
      assert.deepEqual(empty.success ? empty.data : null, [])

      const first = invoke<SaleDetail>('invoices:create', {
        date: '2026-10-01',
        clientId: client.id,
        items: [line(simpleProduct, 'SAC', 2, 2_500)],
      })
      const second = invoke<SaleDetail>('invoices:create', {
        date: '2026-10-02',
        items: [line(simpleProduct, 'SAC', 4, 2_500)],
      })

      assert.equal(first.success, true)
      assert.equal(second.success, true)

      const listed = invoke<Sale[]>('invoices:list')

      assert.deepEqual(
        listed.success ? listed.data.map((sale) => sale.reference) : [],
        ['VTE-000002', 'VTE-000001'],
      )
      assert.deepEqual(
        listed.success ? listed.data.map((sale) => [sale.totalAmount, sale.paidAmount]) : [],
        [
          [10_000, 0],
          [5_000, 0],
        ],
      )
    })

    it('filtre la liste par référence, client et statut', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      const filtered = invoke<Sale[]>('invoices:list', { search: 'vte-000001' })
      const byClient = invoke<Sale[]>('invoices:list', { clientId: client.id })
      const cancelled = invoke<Sale[]>('invoices:list', { status: 'ANNULEE' })

      assert.equal(filtered.success ? filtered.data.length : -1, 1)
      assert.equal(byClient.success ? byClient.data[0].id : -1, invoice.id)
      assert.deepEqual(cancelled.success ? cancelled.data : null, [])
    })
  })

  describe('modification', () => {
    it('modifie une facture non payée', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      const updated = invoke<SaleDetail>('invoices:update', invoice.id, {
        date: '2026-10-05',
        items: [line(simpleProduct, 'SAC', 12, 3_000)],
      })

      assert.equal(updated.success, true)

      const sale = updated.success ? updated.data : ({} as SaleDetail)

      assert.equal(sale.id, invoice.id)
      assert.equal(sale.reference, 'VTE-000001')
      assert.equal(sale.totalAmount, 36_000)
      assert.equal(sale.remainingAmount, 36_000)
      assert.equal(sale.items[0].quantity, 12)
      assert.equal(sale.items[0].unitPrice, 3_000)
    })

    it('refuse de modifier une facture partiellement payée', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      const paid = invoke<Payment>('invoices:add-payment', invoice.id, { amount: 10_000 })

      assert.equal(paid.success, true)

      assert.equal(
        expectFailure('invoices:update', invoice.id, {
          date: '2026-10-05',
          items: [line(simpleProduct, 'SAC', 12, 3_000)],
        }),
        INVOICE_ERRORS.locked,
      )
    })

    it('refuse de modifier une facture payée', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      const paid = invoke<Payment>('invoices:add-payment', invoice.id, { amount: 25_000 })

      assert.equal(paid.success, true)

      assert.equal(
        expectFailure('invoices:update', invoice.id, {
          items: [line(simpleProduct, 'SAC', 1, 2_500)],
        }),
        INVOICE_ERRORS.locked,
      )
    })

    it('refuse de modifier une facture inexistante ou déjà annulée', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      assert.equal(
        expectFailure('invoices:update', 4242, {
          items: [line(simpleProduct, 'SAC', 1, 2_500)],
        }),
        INVOICE_ERRORS.notFound,
      )

      const cancelled = invoke<Sale>('invoices:cancel', invoice.id)

      assert.equal(cancelled.success, true)

      assert.equal(
        expectFailure('invoices:update', invoice.id, {
          items: [line(simpleProduct, 'SAC', 1, 2_500)],
        }),
        INVOICE_ERRORS.alreadyCancelled,
      )
    })
  })

  describe('annulation', () => {
    it('annule une facture non payée', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      const cancelled = invoke<Sale>('invoices:cancel', invoice.id)

      assert.equal(cancelled.success, true)
      assert.equal(cancelled.success ? cancelled.data.status : '', 'ANNULEE')
      assert.equal(cancelled.success ? cancelled.data.reference : '', 'VTE-000001')
    })

    it('refuse d’annuler une facture payée ou déjà annulée', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      assert.equal(
        expectFailure('invoices:cancel', 4242),
        INVOICE_ERRORS.notFound,
      )

      const paid = invoke<Payment>('invoices:add-payment', invoice.id, { amount: 25_000 })

      assert.equal(paid.success, true)

      assert.equal(
        expectFailure('invoices:cancel', invoice.id),
        INVOICE_ERRORS.cancelNotAllowed,
      )

      const unpaid = createInvoiceViaIpc(simpleProduct, client.id)

      assert.equal(invoke('invoices:cancel', unpaid.id).success, true)
      assert.equal(
        expectFailure('invoices:cancel', unpaid.id),
        INVOICE_ERRORS.alreadyCancelled,
      )
    })
  })

  describe('suppression', () => {
    it('supprime une facture annulée', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      assert.equal(invoke('invoices:cancel', invoice.id).success, true)

      const deleted = invoke<null>('invoices:delete', invoice.id)

      assert.equal(deleted.success, true)
      assert.equal(deleted.success ? deleted.data : 'kept', null)
      assert.equal(
        expectFailure('invoices:get-by-id', invoice.id),
        INVOICE_ERRORS.notFound,
      )
      const remaining = invoke<Sale[]>('invoices:list')

      assert.deepEqual(
        remaining.success ? remaining.data.map((sale) => sale.id) : [],
        [],
      )
    })

    it('refuse de supprimer une facture validée', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      assert.equal(
        expectFailure('invoices:delete', invoice.id),
        INVOICE_ERRORS.deleteNotAllowed,
      )
      assert.equal(
        expectFailure('invoices:delete', 4242),
        INVOICE_ERRORS.notFound,
      )
    })
  })

  describe('paiements', () => {
    it('ajoute un paiement valide et met à jour le résumé', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      const paid = invoke<Payment>('invoices:add-payment', invoice.id, {
        amount: 10_000,
        date: '2026-10-06',
      })

      assert.equal(paid.success, true)
      assert.equal(paid.success ? paid.data.amount : -1, 10_000)
      assert.equal(paid.success ? paid.data.saleId : -1, invoice.id)

      const summary = invoke<{ paidAmount: number; remainingAmount: number; status: string }>(
        'invoices:get-payment-summary',
        invoice.id,
      )

      assert.deepEqual(summary.success ? summary.data : null, {
        paidAmount: 10_000,
        remainingAmount: 15_000,
        status: 'PARTIELLEMENT_PAYEE',
      })
    })

    it('refuse un paiement supérieur au reste dû', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      assert.equal(
        expectFailure('invoices:add-payment', invoice.id, { amount: 25_001 }),
        INVOICE_ERRORS.paymentTooHigh,
      )

      assert.equal(invoke('invoices:add-payment', invoice.id, { amount: 20_000 }).success, true)

      assert.equal(
        expectFailure('invoices:add-payment', invoice.id, { amount: 6_000 }),
        INVOICE_ERRORS.paymentTooHigh,
      )
      assert.equal(
        expectFailure('invoices:add-payment', invoice.id, { amount: 0 }),
        INVOICE_ERRORS.paymentInvalid,
      )
      assert.equal(
        expectFailure('invoices:add-payment', 4242, { amount: 1_000 }),
        INVOICE_ERRORS.notFound,
      )
    })

    it('modifie un paiement valide', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)
      const created = invoke<Payment>('invoices:add-payment', invoice.id, { amount: 10_000 })

      assert.equal(created.success, true)

      const paymentId = created.success ? created.data.id : 0
      const updated = invoke<Payment>('invoices:update-payment', paymentId, {
        amount: 15_000,
        date: '2026-10-07',
      })

      assert.equal(updated.success, true)
      assert.equal(updated.success ? updated.data.amount : -1, 15_000)

      const summary = invoke<{ paidAmount: number; remainingAmount: number; status: string }>(
        'invoices:get-payment-summary',
        invoice.id,
      )

      assert.deepEqual(summary.success ? summary.data : null, {
        paidAmount: 15_000,
        remainingAmount: 10_000,
        status: 'PARTIELLEMENT_PAYEE',
      })
    })

    it('refuse une modification qui dépasse le total de la facture', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)
      const first = invoke<Payment>('invoices:add-payment', invoice.id, { amount: 10_000 })
      const second = invoke<Payment>('invoices:add-payment', invoice.id, { amount: 10_000 })

      assert.equal(first.success, true)
      assert.equal(second.success, true)

      const secondId = second.success ? second.data.id : 0

      assert.equal(
        expectFailure('invoices:update-payment', secondId, { amount: 20_000 }),
        INVOICE_ERRORS.paymentTooHigh,
      )
      assert.equal(
        expectFailure('invoices:update-payment', 4242, { amount: 1_000 }),
        INVOICE_ERRORS.paymentNotFound,
      )
    })

    it('supprime un paiement et recalcule le statut', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)
      const created = invoke<Payment>('invoices:add-payment', invoice.id, { amount: 25_000 })

      assert.equal(created.success, true)

      const paymentId = created.success ? created.data.id : 0
      const deleted = invoke<null>('invoices:delete-payment', paymentId)

      assert.equal(deleted.success, true)
      assert.equal(deleted.success ? deleted.data : 'kept', null)

      const summary = invoke<{ paidAmount: number; remainingAmount: number; status: string }>(
        'invoices:get-payment-summary',
        invoice.id,
      )

      assert.deepEqual(summary.success ? summary.data : null, {
        paidAmount: 0,
        remainingAmount: 25_000,
        status: 'NON_PAYEE',
      })
      assert.equal(
        expectFailure('invoices:delete-payment', paymentId),
        INVOICE_ERRORS.paymentNotFound,
      )
    })

    it('refuse un paiement sur une facture annulée', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      assert.equal(invoke('invoices:cancel', invoice.id).success, true)
      assert.equal(
        expectFailure('invoices:add-payment', invoice.id, { amount: 1_000 }),
        INVOICE_ERRORS.paymentOnCancelledSale,
      )
    })
  })

  describe('résumé et liste des paiements', () => {
    it('renvoie un résumé vide pour une facture sans paiement', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      const summary = invoke<{ paidAmount: number; remainingAmount: number; status: string }>(
        'invoices:get-payment-summary',
        invoice.id,
      )
      const listed = invoke<Payment[]>('invoices:list-payments', invoice.id)

      assert.deepEqual(summary.success ? summary.data : null, {
        paidAmount: 0,
        remainingAmount: 25_000,
        status: 'NON_PAYEE',
      })
      assert.deepEqual(listed.success ? listed.data : null, [])
    })

    it('liste les paiements de la plus récente à la plus ancienne', () => {
      const invoice = createInvoiceViaIpc(simpleProduct, client.id)

      assert.equal(invoke('invoices:add-payment', invoice.id, { amount: 5_000 }).success, true)
      assert.equal(invoke('invoices:add-payment', invoice.id, { amount: 7_000 }).success, true)

      const listed = invoke<Payment[]>('invoices:list-payments', invoice.id)

      assert.deepEqual(
        listed.success ? listed.data.map((payment) => payment.amount) : [],
        [7_000, 5_000],
      )
      assert.equal(
        expectFailure('invoices:get-payment-summary', 4242),
        INVOICE_ERRORS.notFound,
      )
      assert.equal(
        expectFailure('invoices:list-payments', 4242),
        INVOICE_ERRORS.notFound,
      )
    })
  })

  it('ne casse pas les modules existants', () => {
    const invoice = createInvoiceViaIpc(simpleProduct, client.id)

    assert.equal(invoice.reference, 'VTE-000001')

    const auth = invokeHandler('auth:status') as { isConfigured: boolean }

    assert.equal(auth.isConfigured, false)
    assert.equal(invoke<unknown[]>('categories:list').success, true)
    assert.equal(invoke<Product[]>('products:list').success, true)
    assert.equal(invoke<Client[]>('clients:list').success, true)
    assert.equal(invoke<unknown[]>('clients:ensure-system').success, true)
    assert.equal(invoke<unknown[]>('supplies:list').success, true)
    assert.equal(invoke<unknown[]>('transformations:list').success, true)

    const stock = invoke<{ quantity: number }[]>('stock:get', simpleProduct.id)

    assert.equal(stock.success ? stock.data[0].quantity : -1, 10)
  })
})
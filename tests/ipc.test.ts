import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { registerIpcHandlers } from '../electron/ipc'
import { STOCK_ERRORS } from '../electron/services/stockService'
import type { Category, Product, StockResult } from '../electron/types'
import {
  closeTestDatabase,
  resetTestDatabase,
  seedCategory,
  seedSimpleProduct,
  seedTransformableProduct,
} from './helpers/database'
import { invokeHandler, registeredChannels } from './stubs/electron'

function invoke<T>(channel: string, ...args: unknown[]): StockResult<T> {
  return invokeHandler(channel, ...args) as StockResult<T>
}

function expectFailure<T>(channel: string, ...args: unknown[]): string {
  const result = invoke<T>(channel, ...args)

  assert.equal(
    result.success,
    false,
    `${channel} must answer with an explicit business error, not a thrown error`,
  )

  return result.success ? '' : result.error
}

/**
 * The renderer never sees a SQLite or Node error: every channel answers with the
 * { success, data | error } envelope and an explicit business message.
 */
describe('canaux IPC du stock', () => {
  let category: Category
  let simpleProduct: Product
  let transformableProduct: Product

  before(() => {
    registerIpcHandlers()
  })

  beforeEach(() => {
    resetTestDatabase()
    category = seedCategory('BOISSONS')
    simpleProduct = seedSimpleProduct(category, 'SUCRE 1 KG')
    transformableProduct = seedTransformableProduct(category, 'CHOCOPAIN 5 KG')
  })

  after(() => {
    closeTestDatabase()
  })

  it('expose les canaux attendus', () => {
    const channels = registeredChannels()

    for (const channel of [
      'stock:list',
      'stock:get',
      'stock:get-form',
      'stock:initialize',
      'stock:adjust',
      'stock:movements',
    ]) {
      assert.ok(channels.includes(channel), `missing channel ${channel}`)
    }
  })

  it('liste le stock et l’initialise puis l’ajuste', () => {
    const listed = invoke<{ quantity: number }[]>('stock:list')

    assert.equal(listed.success, true)
    assert.equal(listed.success ? listed.data.length : -1, 3)

    const initialized = invoke<{ quantity: number }[]>('stock:initialize', transformableProduct.id, {
      productId: transformableProduct.id,
      quantities: [
        { form: 'CARTON', quantity: 10 },
        { form: 'SEAU', quantity: 3 },
      ],
    })

    assert.equal(initialized.success, true)
    assert.deepEqual(
      initialized.success
        ? initialized.data.map((level) => [level.form, level.quantity])
        : [],
      [
        ['CARTON', 10],
        ['SEAU', 3],
      ],
    )

    const adjusted = invoke<{ stock: { quantity: number } }>(
      'stock:adjust',
      transformableProduct.id,
      {
        productId: transformableProduct.id,
        form: 'CARTON',
        direction: 'OUT',
        quantity: 1,
        reason: 'Produit endommagé',
      },
    )

    assert.equal(adjusted.success, true)
    assert.equal(adjusted.success ? adjusted.data.stock.quantity : -1, 9)

    const form = invoke<{ quantity: number }>('stock:get-form', transformableProduct.id, 'SEAU')

    assert.equal(form.success ? form.data.quantity : -1, 3)

    const movements = invoke<{ length: number }>('stock:movements', transformableProduct.id)

    assert.equal(movements.success ? movements.data.length : -1, 3)
  })

  it('renvoie un message métier explicite au lieu d’une erreur inattendue', () => {
    assert.equal(
      expectFailure('stock:initialize', simpleProduct.id, {
        productId: simpleProduct.id,
        quantities: [{ form: 'SAC', quantity: 0 }],
      }),
      STOCK_ERRORS.positiveQuantityRequired,
    )

    assert.equal(
      expectFailure('stock:initialize', simpleProduct.id, {
        productId: simpleProduct.id,
        quantities: [{ form: 'BIDON', quantity: 3 }],
      }),
      STOCK_ERRORS.formInvalid,
    )

    assert.equal(
      expectFailure('stock:initialize', 4242, {
        productId: 4242,
        quantities: [{ form: 'SAC', quantity: 3 }],
      }),
      STOCK_ERRORS.productNotFound,
    )

    assert.equal(
      expectFailure('stock:adjust', simpleProduct.id, {
        productId: simpleProduct.id,
        form: 'SAC',
        direction: 'IN',
        quantity: 2,
        reason: '   ',
      }),
      STOCK_ERRORS.reasonRequired,
    )

    assert.equal(
      expectFailure('stock:adjust', simpleProduct.id, {
        productId: simpleProduct.id,
        form: 'SAC',
        direction: 'IN',
        quantity: 2,
        reason: 'Entrée',
      }),
      STOCK_ERRORS.notInitialized,
    )

    assert.equal(
      expectFailure('stock:get-form', transformableProduct.id, 'BIDON'),
      STOCK_ERRORS.formInvalid,
    )
  })

  it('ne casse pas les canaux existants', () => {
    const products = invoke<unknown[]>('products:list', { search: 'choco' })
    const categories = invoke<unknown[]>('categories:list')

    assert.equal(products.success, true)
    assert.equal(products.success ? products.data.length : -1, 1)
    assert.equal(categories.success, true)
    assert.equal(categories.success ? categories.data.length : -1, 1)
  })
})
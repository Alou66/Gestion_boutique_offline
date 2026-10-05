import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { registerIpcHandlers } from '../electron/ipc'
import { STOCK_ERRORS } from '../electron/services/stockService'
import { initializeStock } from '../electron/services/stockService'
import { SUPPLY_ERRORS } from '../electron/services/supplyService'
import { TRANSFORMATION_ERRORS } from '../electron/services/transformationService'
import type {
  Category,
  Product,
  StockResult,
  SupplyDetail,
  TransformationDetail,
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

    const initialized = invoke<{ form: string; quantity: number }[]>(
      'stock:initialize',
      transformableProduct.id,
      {
        productId: transformableProduct.id,
        quantities: [
          { form: 'CARTON', quantity: 10 },
          { form: 'SEAU', quantity: 3 },
        ],
      },
    )

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
        direction: 'OUT',
        quantity: 2,
        reason: 'Sortie impossible',
      }),
      STOCK_ERRORS.insufficientStock,
    )

    assert.equal(
      expectFailure('stock:get-form', transformableProduct.id, 'BIDON'),
      STOCK_ERRORS.formInvalid,
    )
  })

  it('traite un produit sans mouvement comme un stock à zéro', () => {
    const listed = invoke<{ productName: string; form: string; quantity: number; hasMovements: boolean }[]>(
      'stock:list',
    )

    assert.deepEqual(
      listed.success
        ? listed.data.map((level) => [level.productName, level.form, level.quantity, level.hasMovements])
        : [],
      [
        ['CHOCOPAIN 5 KG', 'CARTON', 0, false],
        ['CHOCOPAIN 5 KG', 'SEAU', 0, false],
        ['SUCRE 1 KG', 'SAC', 0, false],
      ],
    )

    // No initialization first: the reception is accepted right away.
    const created = invoke<{ totalAmount: number }>('supplies:create', {
      date: '2026-10-04',
      items: [{ productId: simpleProduct.id, form: 'SAC', quantity: 20, purchaseUnitPrice: 2_500 }],
    })

    assert.equal(created.success, true)

    const form = invoke<{ quantity: number }>('stock:get-form', simpleProduct.id, 'SAC')

    assert.equal(form.success ? form.data.quantity : -1, 20)

    // The reception is an APPROVISIONNEMENT IN movement, never an initialization.
    const movements = invoke<{ movementType: string; direction: string }[]>(
      'stock:movements',
      simpleProduct.id,
    )

    assert.deepEqual(
      movements.success
        ? movements.data.map((movement) => [movement.movementType, movement.direction])
        : [],
      [['APPROVISIONNEMENT', 'IN']],
    )
  })

  it('refuse une initialisation sur un produit qui a déjà des mouvements', () => {
    invoke('supplies:create', {
      date: '2026-10-04',
      items: [{ productId: simpleProduct.id, form: 'SAC', quantity: 5, purchaseUnitPrice: 1_000 }],
    })

    assert.equal(
      expectFailure('stock:initialize', simpleProduct.id, {
        productId: simpleProduct.id,
        quantities: [{ form: 'SAC', quantity: 50 }],
      }),
      STOCK_ERRORS.alreadyHasMovements,
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

/**
 * The renderer never sees a SQLite or Node error on the supply channels either,
 * and a validated supply stays immutable: there is no update and no delete
 * channel to call.
 */
describe('canaux IPC des approvisionnements', () => {
  let category: Category
  let simpleProduct: Product

  before(() => {
    registerIpcHandlers()
  })

  beforeEach(() => {
    resetTestDatabase()
    category = seedCategory('BOISSONS')
    simpleProduct = seedSimpleProduct(category, 'SUCRE 1 KG')
    initializeStock(simpleProduct.id, {
      productId: simpleProduct.id,
      quantities: [{ form: 'SAC', quantity: 20 }],
    })
  })

  after(() => {
    closeTestDatabase()
  })

  it('expose les canaux attendus et rien de plus', () => {
    const channels = registeredChannels()

    for (const channel of [
      'supplies:list',
      'supplies:get',
      'supplies:get-by-reference',
      'supplies:create',
    ]) {
      assert.ok(channels.includes(channel), `missing channel ${channel}`)
    }

    assert.equal(
      channels.some((channel) => channel.startsWith('supplies:update')),
      false,
    )
    assert.equal(
      channels.some((channel) => channel.startsWith('supplies:delete')),
      false,
    )
  })

  it('liste, crée puis relit un approvisionnement', () => {
    const created = invoke<SupplyDetail>(
      'supplies:create',
      {
        date: '2026-10-04',
        supplierName: 'Grossiste Sokna',
        items: [
          { productId: simpleProduct.id, form: 'SAC', quantity: 10, purchaseUnitPrice: 2_500 },
        ],
      },
    )

    assert.equal(created.success, true)

    const supply = created.success ? created.data : ({} as SupplyDetail)

    assert.equal(supply.reference, 'APP-000001')
    assert.equal(supply.totalAmount, 25_000)
    assert.equal(supply.items.length, 1)

    const listed = invoke<{ reference: string; itemCount: number }[]>('supplies:list')

    assert.deepEqual(
      listed.success ? listed.data.map((row) => [row.reference, row.itemCount]) : [],
      [['APP-000001', 1]],
    )

    const byId = invoke<{ reference: string }>('supplies:get', supply.id)
    const byReference = invoke<{ reference: string }>(
      'supplies:get-by-reference',
      'app-000001',
    )

    assert.equal(byId.success ? byId.data.reference : '', 'APP-000001')
    assert.equal(byReference.success ? byReference.data.reference : '', 'APP-000001')

    // The stock went through the APPROVISIONNEMENT movements.
    const movements = invoke<{ movementType: string; signedQuantity: number }[]>(
      'stock:movements',
      simpleProduct.id,
    )

    assert.equal(
      movements.success
        ? movements.data.filter((movement) => movement.movementType === 'APPROVISIONNEMENT').length
        : -1,
      1,
    )
  })

  it('renvoie un message métier explicite au lieu d\'une erreur inattendue', () => {
    assert.equal(
      expectFailure('supplies:create', {
        date: '2026-10-04',
        items: [{ productId: 4242, form: 'SAC', quantity: 1, purchaseUnitPrice: 100 }],
      }),
      SUPPLY_ERRORS.productNotFound,
    )

    assert.equal(
      expectFailure('supplies:create', {
        date: '2026-10-04',
        items: [{ productId: simpleProduct.id, form: 'CARTON', quantity: 1, purchaseUnitPrice: 100 }],
      }),
      SUPPLY_ERRORS.formInvalid,
    )

    assert.equal(
      expectFailure('supplies:create', {
        date: '2026-10-04',
        items: [{ productId: simpleProduct.id, form: 'SAC', quantity: 0, purchaseUnitPrice: 100 }],
      }),
      SUPPLY_ERRORS.quantityInvalid,
    )

    assert.equal(
      expectFailure('supplies:create', {
        date: '2026-10-04',
        items: [
          { productId: simpleProduct.id, form: 'SAC', quantity: 1, purchaseUnitPrice: 100 },
          { productId: simpleProduct.id, form: 'SAC', quantity: 2, purchaseUnitPrice: 100 },
        ],
      }),
      SUPPLY_ERRORS.duplicateLine,
    )

    assert.equal(
      expectFailure('supplies:get', 4242),
      SUPPLY_ERRORS.notFound,
    )

    setProductActive(simpleProduct.id, false)

    assert.equal(
      expectFailure('supplies:create', {
        date: '2026-10-04',
        items: [{ productId: simpleProduct.id, form: 'SAC', quantity: 1, purchaseUnitPrice: 100 }],
      }),
      SUPPLY_ERRORS.productInactive,
    )
  })
})
/**
 * The renderer never sees a SQLite or Node error on the transformation channels
 * either, and a validated transformation stays immutable: there is no update and
 * no delete channel to call.
 */
describe('canaux IPC des transformations', () => {
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
    initializeStock(transformableProduct.id, {
      productId: transformableProduct.id,
      quantities: [
        { form: 'CARTON', quantity: 10 },
        { form: 'SEAU', quantity: 3 },
      ],
    })
  })

  after(() => {
    closeTestDatabase()
  })

  it('expose les canaux attendus et rien de plus', () => {
    const channels = registeredChannels()

    for (const channel of [
      'transformations:list-products',
      'transformations:list',
      'transformations:get',
      'transformations:get-by-reference',
      'transformations:create',
    ]) {
      assert.ok(channels.includes(channel), `missing channel ${channel}`)
    }

    assert.equal(
      channels.some((channel) => channel.startsWith('transformations:update')),
      false,
    )
    assert.equal(
      channels.some((channel) => channel.startsWith('transformations:delete')),
      false,
    )
  })

  it('ne propose dans le select que les produits actifs et transformables', () => {
    setProductActive(simpleProduct.id, false)

    const products = invoke<Product[]>('transformations:list-products')

    assert.equal(products.success, true)
    assert.deepEqual(
      products.success ? products.data.map((product) => product.id) : [],
      [transformableProduct.id],
    )
  })

  it('liste, crée puis relit une transformation', () => {
    const created = invoke<TransformationDetail>('transformations:create', {
      productId: transformableProduct.id,
      sourceForm: 'CARTON',
      sourceQuantity: 2,
      date: '2026-10-04',
    })

    assert.equal(created.success, true)

    const transformation = created.success ? created.data : ({} as TransformationDetail)

    assert.equal(transformation.reference, 'TRF-000001')
    assert.equal(transformation.sourceForm, 'CARTON')
    assert.equal(transformation.sourceQuantity, 2)
    assert.equal(transformation.destinationForm, 'SEAU')
    assert.equal(transformation.destinationQuantity, 8)
    assert.deepEqual(
      transformation.stockAfter.map((level) => [level.form, level.quantity]),
      [
        ['CARTON', 8],
        ['SEAU', 11],
      ],
    )

    const listed = invoke<{ reference: string }[]>('transformations:list')

    assert.deepEqual(
      listed.success ? listed.data.map((row) => row.reference) : [],
      ['TRF-000001'],
    )

    const byId = invoke<{ reference: string }>('transformations:get', transformation.id)
    const byReference = invoke<{ reference: string }>(
      'transformations:get-by-reference',
      'trf-000001',
    )

    assert.equal(byId.success ? byId.data.reference : '', 'TRF-000001')
    assert.equal(byReference.success ? byReference.data.reference : '', 'TRF-000001')

    // The stock went through the two TRANSFORMATION movements.
    const movements = invoke<{ movementType: string; direction: string; quantity: number }[]>(
      'stock:movements',
      transformableProduct.id,
    )

    assert.deepEqual(
      movements.success
        ? movements.data
            .filter((movement) => movement.movementType === 'TRANSFORMATION')
            .map((movement) => [movement.direction, movement.quantity])
        : [],
      [
        ['IN', 8],
        ['OUT', 2],
      ],
    )
  })

  it('renvoie un message métier explicite au lieu d\'une erreur inattendue', () => {
    assert.equal(
      expectFailure('transformations:create', {
        productId: 4242,
        sourceForm: 'CARTON',
        sourceQuantity: 1,
      }),
      TRANSFORMATION_ERRORS.productNotFound,
    )

    assert.equal(
      expectFailure('transformations:create', {
        productId: simpleProduct.id,
        sourceForm: 'SAC',
        sourceQuantity: 1,
      }),
      TRANSFORMATION_ERRORS.productNotTransformable,
    )

    assert.equal(
      expectFailure('transformations:create', {
        productId: transformableProduct.id,
        sourceForm: 'BIDON',
        sourceQuantity: 1,
      }),
      TRANSFORMATION_ERRORS.formInvalid,
    )

    assert.equal(
      expectFailure('transformations:create', {
        productId: transformableProduct.id,
        sourceForm: 'CARTON',
        sourceQuantity: 0,
      }),
      TRANSFORMATION_ERRORS.quantityInvalid,
    )

    assert.equal(
      expectFailure('transformations:create', {
        productId: transformableProduct.id,
        sourceForm: 'SEAU',
        sourceQuantity: 1,
      }),
      TRANSFORMATION_ERRORS.conversionInvalid,
    )

    assert.equal(
      expectFailure('transformations:create', {
        productId: transformableProduct.id,
        sourceForm: 'CARTON',
        sourceQuantity: 11,
      }),
      TRANSFORMATION_ERRORS.insufficientStock,
    )

    assert.equal(
      expectFailure('transformations:get', 4242),
      TRANSFORMATION_ERRORS.notFound,
    )

    setProductActive(transformableProduct.id, false)

    assert.equal(
      expectFailure('transformations:create', {
        productId: transformableProduct.id,
        sourceForm: 'CARTON',
        sourceQuantity: 2,
      }),
      TRANSFORMATION_ERRORS.productInactive,
    )
  })

  it('ne casse pas les canaux existants', () => {
    const products = invoke<Product[]>('transformations:create', {
      productId: transformableProduct.id,
      sourceForm: 'CARTON',
      sourceQuantity: 1,
    })

    assert.equal(products.success, true)

    const supplies = invoke<unknown[]>('supplies:list')

    assert.equal(supplies.success, true)
    assert.equal(supplies.success ? supplies.data.length : -1, 0)
  })
})

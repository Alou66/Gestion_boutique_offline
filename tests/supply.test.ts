import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { getDb } from '../electron/database/client'
import { stockMovements, supplyItems, supplies } from '../electron/database/schema'
import {
  adjustStock,
  getProductFormStock,
  getProductStock,
  initializeStock,
  listProductMovements,
  StockError,
} from '../electron/services/stockService'
import type { StockErrorCode } from '../electron/services/stockService'
import { getProductById } from '../electron/services/productService'
import {
  createSupply,
  getSupplyById,
  getSupplyByReference,
  listSupplies,
  SupplyError,
} from '../electron/services/supplyService'
import type { SupplyErrorCode } from '../electron/services/supplyService'
import type {
  Category,
  Product,
  StockMovementType,
  SupplyItemInput,
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

function expectSupplyError(code: SupplyErrorCode, run: () => unknown): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(
      error instanceof SupplyError,
      `expected SupplyError, received ${String(error)}`,
    )
    assert.equal(error.code, code)
    return true
  })
}

function expectStockError(code: StockErrorCode, run: () => unknown): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof StockError, `expected StockError, received ${String(error)}`)
    assert.equal(error.code, code)
    return true
  })
}

function movementCount(): number {
  return getDb().select().from(stockMovements).all().length
}

function supplyCount(): number {
  return getDb().select().from(supplies).all().length
}

function itemCount(): number {
  return getDb().select().from(supplyItems).all().length
}

function balanceOf(productId: number, form: string): number {
  return getProductFormStock(productId, form).quantity
}

function line(
  product: Product,
  form: string,
  quantity: number,
  purchaseUnitPrice: number,
): SupplyItemInput {
  return { productId: product.id, form, quantity, purchaseUnitPrice }
}

describe('module Approvisionnement', () => {
  let category: Category
  let simpleProduct: Product
  let transformableProduct: Product

  beforeEach(() => {
    resetTestDatabase()
    category = seedCategory('BOISSONS')
    simpleProduct = seedSimpleProduct(category, 'SUCRE 1 KG')
    transformableProduct = seedTransformableProduct(category, 'CHOCOPAIN 5 KG')

    // The stock module owns the initial stock: it is optional. A product without
    // any movement simply has a stock of 0 and can be received directly, so these
    // two initializations are not a precondition of a supply.
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
    it('enregistre un approvisionnement avec une seule ligne', () => {
      const supply = createSupply({
        date: '2026-10-04',
        supplierName: 'Grossiste Sokna',
        items: [line(simpleProduct, 'SAC', 10, 2_500)],
      })

      assert.equal(supply.reference, 'APP-000001')
      assert.equal(supply.itemCount, 1)
      assert.equal(supply.totalAmount, 25_000)
      assert.equal(supply.supplierName, 'Grossiste Sokna')
      assert.equal(supply.items.length, 1)
      assert.deepEqual(
        {
          productId: supply.items[0].productId,
          productName: supply.items[0].productName,
          form: supply.items[0].form,
          quantity: supply.items[0].quantity,
          purchaseUnitPrice: supply.items[0].purchaseUnitPrice,
          lineTotal: supply.items[0].lineTotal,
        },
        {
          productId: simpleProduct.id,
          productName: 'SUCRE 1 KG',
          form: 'SAC',
          quantity: 10,
          purchaseUnitPrice: 2_500,
          lineTotal: 25_000,
        },
      )
    })

    it('enregistre un approvisionnement avec plusieurs produits', () => {
      const sucre = seedSimpleProduct(category, 'SUCRE 50 KG')
      const riz = seedSimpleProduct(category, 'RIZ 25 KG')

      initializeStock(sucre.id, {
        productId: sucre.id,
        quantities: [{ form: 'SAC', quantity: 1 }],
      })
      initializeStock(riz.id, {
        productId: riz.id,
        quantities: [{ form: 'SAC', quantity: 1 }],
      })

      const supply = createSupply({
        date: '2026-10-04',
        items: [
          line(sucre, 'SAC', 10, 15_000),
          line(simpleProduct, 'SAC', 20, 4_500),
          line(riz, 'SAC', 5, 12_000),
        ],
      })

      assert.equal(supply.itemCount, 3)
      assert.equal(supply.items.length, 3)
      // 150 000 + 90 000 + 60 000
      assert.equal(supply.totalAmount, 300_000)
      assert.deepEqual(
        supply.items.map((item) => item.lineTotal),
        [150_000, 90_000, 60_000],
      )
    })

    it('génère la référence automatiquement et séquentiellement', () => {
      const first = createSupply({
        date: '2026-10-04',
        items: [line(simpleProduct, 'SAC', 1, 100)],
      })
      const second = createSupply({
        date: '2026-10-05',
        items: [line(simpleProduct, 'SAC', 1, 100)],
      })
      const third = createSupply({
        items: [line(simpleProduct, 'SAC', 1, 100)],
      })

      assert.deepEqual(
        [first.reference, second.reference, third.reference],
        ['APP-000001', 'APP-000002', 'APP-000003'],
      )
      // The date of the document defaults to today when it is not sent.
      assert.ok(third.date instanceof Date)
    })

    it('garde une référence unique et l\'interdit en base', () => {
      const first = createSupply({
        date: '2026-10-04',
        items: [line(simpleProduct, 'SAC', 1, 100)],
      })
      const second = createSupply({
        date: '2026-10-05',
        items: [line(simpleProduct, 'SAC', 2, 100)],
      })

      assert.notEqual(first.reference, second.reference)
      assert.equal(
        new Set(listSupplies().map((supply) => supply.reference)).size,
        2,
      )

      assert.throws(() =>
        getDb()
          .insert(supplies)
          .values({
            reference: 'APP-000001',
            date: new Date(2026, 9, 4),
            totalAmount: 0,
            createdAt: new Date(),
          })
          .run(),
      )
    })

    it('calcule le total à partir des lignes et jamais depuis la saisie', () => {
      const supply = createSupply({
        date: '2026-10-04',
        items: [
          line(transformableProduct, 'CARTON', 10, 10_000),
          line(transformableProduct, 'SEAU', 4, 2_500),
        ],
      })

      const sumOfLines = supply.items.reduce((sum, item) => sum + item.lineTotal, 0)

      assert.equal(sumOfLines, 110_000)
      assert.equal(supply.totalAmount, sumOfLines)

      const storedTotal = getDb()
        .select({ total: supplies.totalAmount })
        .from(supplies)
        .get()

      assert.equal(storedTotal?.total, 110_000)
    })

    it('calcule correctement chaque total de ligne', () => {
      const supply = createSupply({
        date: '2026-10-04',
        items: [
          line(transformableProduct, 'CARTON', 10, 10_000),
          line(transformableProduct, 'SEAU', 3, 2_500),
          line(simpleProduct, 'SAC', 7, 999),
        ],
      })

      assert.deepEqual(
        supply.items.map((item) => [
          item.quantity,
          item.purchaseUnitPrice,
          item.lineTotal,
        ]),
        [
          [10, 10_000, 100_000],
          [3, 2_500, 7_500],
          [7, 999, 6_993],
        ],
      )
      assert.equal(supply.totalAmount, 114_493)
    })

    it('accepte un prix d\'achat à 0 et normalise la forme saisie', () => {
      const supply = createSupply({
        date: '2026-10-04',
        items: [line(simpleProduct, '  sac ', 2, 0)],
      })

      assert.equal(supply.items[0].form, 'SAC')
      assert.equal(supply.items[0].purchaseUnitPrice, 0)
      assert.equal(supply.items[0].lineTotal, 0)
      assert.equal(supply.totalAmount, 0)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 22)
    })

    it('refuse une date invalide ou hors plage', () => {
      expectSupplyError('dateInvalid', () =>
        createSupply({ date: '04/10/2026', items: [line(simpleProduct, 'SAC', 1, 100)] }),
      )

      expectSupplyError('dateInvalid', () =>
        createSupply({ date: '2026-02-31', items: [line(simpleProduct, 'SAC', 1, 100)] }),
      )

      expectSupplyError('dateOutOfRange', () =>
        createSupply({ date: '1999-12-31', items: [line(simpleProduct, 'SAC', 1, 100)] }),
      )

      assert.equal(supplyCount(), 0)
      assert.equal(itemCount(), 0)
    })
  })

  describe('produits', () => {
    it('refuse un produit inexistant', () => {
      expectSupplyError('productNotFound', () =>
        createSupply({
          date: '2026-10-04',
          items: [{ productId: 4242, form: 'SAC', quantity: 1, purchaseUnitPrice: 100 }],
        }),
      )

      assert.equal(supplyCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(movementCount(), 3)
    })

    it('refuse un produit inactif', () => {
      setProductActive(transformableProduct.id, false)

      expectSupplyError('productInactive', () =>
        createSupply({
          date: '2026-10-04',
          items: [line(transformableProduct, 'CARTON', 5, 10_000)],
        }),
      )

      assert.equal(supplyCount(), 0)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
    })

    it('accepte un produit simple dans sa forme unique', () => {
      const supply = createSupply({
        date: '2026-10-04',
        items: [line(simpleProduct, 'SAC', 5, 2_000)],
      })

      assert.equal(supply.items[0].form, 'SAC')
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 25)
    })

    it('accepte un produit transformable dans sa forme principale ou secondaire', () => {
      createSupply({
        date: '2026-10-04',
        items: [line(transformableProduct, 'CARTON', 5, 10_000)],
      })

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 15)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 2)

      createSupply({
        date: '2026-10-04',
        items: [line(transformableProduct, 'SEAU', 5, 2_500)],
      })

      // No automatic conversion: the received SEAUX are added to the SEAUX.
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 7)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 15)
    })

    it('refuse une forme qui n\'appartient pas au produit', () => {
      expectSupplyError('formInvalid', () =>
        createSupply({
          date: '2026-10-04',
          items: [line(simpleProduct, 'CARTON', 5, 10_000)],
        }),
      )

      expectSupplyError('formInvalid', () =>
        createSupply({
          date: '2026-10-04',
          items: [line(transformableProduct, 'BIDON', 5, 10_000)],
        }),
      )

      expectSupplyError('formInvalid', () =>
        createSupply({
          date: '2026-10-04',
          items: [line(transformableProduct, 'CARTON', 5, 10_000), line(transformableProduct, 'BIDON', 1, 10_000)],
        }),
      )

      assert.equal(supplyCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(movementCount(), 3)
    })

    it('approvisionne un produit sans aucun mouvement, sans initialisation préalable', () => {
      const newProduct = seedSimpleProduct(category, 'RIZ 25 KG')

      assert.equal(balanceOf(newProduct.id, 'SAC'), 0)

      const supply = createSupply({
        date: '2026-10-04',
        items: [line(newProduct, 'SAC', 20, 4_000)],
      })

      assert.equal(supply.reference, 'APP-000001')
      assert.equal(balanceOf(newProduct.id, 'SAC'), 20)
      // The reception is a real APPROVISIONNEMENT IN, never an initialization.
      const movements = listProductMovements(newProduct.id)

      assert.equal(movements.length, 1)
      assert.deepEqual(
        [movements[0].movementType, movements[0].direction, movements[0].quantity],
        ['APPROVISIONNEMENT', 'IN', 20],
      )
      assert.equal(
        movements.filter((movement) => movement.movementType === 'STOCK_INITIAL').length,
        0,
      )
    })

    it('approvisionne un produit transformable sans mouvement, forme par forme', () => {
      const product = seedTransformableProduct(category, 'CHOCOPAIN 2 KG')

      // No movement: both forms are logically at 0.
      assert.deepEqual(
        getProductStock(product.id).map((level) => [level.form, level.quantity]),
        [
          ['CARTON', 0],
          ['SEAU', 0],
        ],
      )

      createSupply({
        date: '2026-10-04',
        items: [line(product, 'CARTON', 5, 10_000)],
      })

      assert.equal(balanceOf(product.id, 'CARTON'), 5)
      assert.equal(balanceOf(product.id, 'SEAU'), 0)

      createSupply({
        date: '2026-10-05',
        items: [line(product, 'SEAU', 8, 2_500)],
      })

      // No automatic conversion between the two forms.
      assert.equal(balanceOf(product.id, 'CARTON'), 5)
      assert.equal(balanceOf(product.id, 'SEAU'), 8)
      assert.equal(
        listProductMovements(product.id).filter(
          (movement) => movement.movementType === 'STOCK_INITIAL',
        ).length,
        0,
      )
    })

    it('cumule plusieurs approvisionnements sur un produit sans mouvement', () => {
      const product = seedSimpleProduct(category, 'RIZ 25 KG')

      createSupply({
        date: '2026-10-04',
        items: [line(product, 'SAC', 20, 4_000)],
      })
      createSupply({
        date: '2026-10-05',
        items: [line(product, 'SAC', 15, 4_000)],
      })

      assert.equal(balanceOf(product.id, 'SAC'), 35)
      assert.equal(listProductMovements(product.id).length, 2)
    })

    it('cumule stock initial et approvisionnement', () => {
      const product = seedSimpleProduct(category, 'RIZ 25 KG')

      initializeStock(product.id, {
        productId: product.id,
        quantities: [{ form: 'SAC', quantity: 50 }],
      })
      createSupply({
        date: '2026-10-04',
        items: [line(product, 'SAC', 20, 4_000)],
      })

      assert.equal(balanceOf(product.id, 'SAC'), 70)
    })

    it('refuse une initialisation après un approvisionnement, sans toucher au stock', () => {
      const product = seedSimpleProduct(category, 'RIZ 25 KG')

      createSupply({
        date: '2026-10-04',
        items: [line(product, 'SAC', 20, 4_000)],
      })

      expectStockError('alreadyHasMovements', () =>
        initializeStock(product.id, {
          productId: product.id,
          quantities: [{ form: 'SAC', quantity: 50 }],
        }),
      )

      assert.equal(balanceOf(product.id, 'SAC'), 20)
      assert.equal(supplyCount(), 1)
    })

    it('refuse un approvisionnement sans ligne', () => {
      expectSupplyError('itemsRequired', () => createSupply({ date: '2026-10-04', items: [] }))
      expectSupplyError('itemsRequired', () =>
        createSupply({ date: '2026-10-04' } as never),
      )

      assert.equal(supplyCount(), 0)
    })
  })

  describe('quantités et prix', () => {
    it('refuse une quantité nulle ou négative', () => {
      expectSupplyError('quantityInvalid', () =>
        createSupply({ date: '2026-10-04', items: [line(simpleProduct, 'SAC', 0, 2_500)] }),
      )

      expectSupplyError('quantityInvalid', () =>
        createSupply({ date: '2026-10-04', items: [line(simpleProduct, 'SAC', -5, 2_500)] }),
      )

      assert.equal(supplyCount(), 0)
    })

    it('refuse une quantité non entière ou absente', () => {
      expectSupplyError('quantityInvalid', () =>
        createSupply({ date: '2026-10-04', items: [line(simpleProduct, 'SAC', 1.5, 2_500)] }),
      )

      expectSupplyError('quantityRequired', () =>
        createSupply({
          date: '2026-10-04',
          items: [
            {
              productId: simpleProduct.id,
              form: 'SAC',
              quantity: undefined as never,
              purchaseUnitPrice: 2_500,
            },
          ],
        }),
      )

      assert.equal(supplyCount(), 0)
    })

    it('refuse un prix négatif ou invalide et accepte 0', () => {
      expectSupplyError('unitPriceInvalid', () =>
        createSupply({ date: '2026-10-04', items: [line(simpleProduct, 'SAC', 5, -1)] }),
      )

      expectSupplyError('unitPriceInvalid', () =>
        createSupply({ date: '2026-10-04', items: [line(simpleProduct, 'SAC', 5, 1.5)] }),
      )

      expectSupplyError('unitPriceRequired', () =>
        createSupply({
          date: '2026-10-04',
          items: [
            {
              productId: simpleProduct.id,
              form: 'SAC',
              quantity: 5,
              purchaseUnitPrice: undefined as never,
            },
          ],
        }),
      )

      assert.equal(supplyCount(), 0)

      const supply = createSupply({
        date: '2026-10-04',
        items: [line(simpleProduct, 'SAC', 5, 0)],
      })

      assert.equal(supply.totalAmount, 0)
    })

    it('interdit une quantité nulle et un prix négatif au niveau SQL', () => {
      const supply = createSupply({
        date: '2026-10-04',
        items: [line(simpleProduct, 'SAC', 1, 100)],
      })

      assert.throws(() =>
        getDb()
          .insert(supplyItems)
          .values({
            supplyId: supply.id,
            productId: simpleProduct.id,
            form: 'SAC',
            quantity: 0,
            purchaseUnitPrice: 100,
            lineTotal: 0,
          })
          .run(),
      )

      assert.throws(() =>
        getDb()
          .insert(supplyItems)
          .values({
            supplyId: supply.id,
            productId: simpleProduct.id,
            form: 'SEAU',
            quantity: 1,
            purchaseUnitPrice: -100,
            lineTotal: -100,
          })
          .run(),
      )

      assert.throws(() =>
        getDb()
          .insert(supplies)
          .values({ reference: 'APP-999999', date: new Date(), totalAmount: -1 })
          .run(),
      )

      assert.equal(itemCount(), 1)
    })
  })

  describe('doublons', () => {
    it('refuse deux lignes du même produit dans la même forme', () => {
      expectSupplyError('duplicateLine', () =>
        createSupply({
          date: '2026-10-04',
          items: [
            line(simpleProduct, 'SAC', 10, 2_500),
            line(simpleProduct, 'SAC', 5, 2_500),
          ],
        }),
      )

      assert.equal(supplyCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 20)
    })

    it('accepte le même produit dans deux formes différentes', () => {
      const supply = createSupply({
        date: '2026-10-04',
        items: [
          line(transformableProduct, 'CARTON', 10, 10_000),
          line(transformableProduct, 'SEAU', 5, 2_500),
        ],
      })

      assert.equal(supply.items.length, 2)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 20)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 7)
    })

    it('interdit le doublon au niveau SQL même en contournant le service', () => {
      const supply = createSupply({
        date: '2026-10-04',
        items: [line(simpleProduct, 'SAC', 1, 100)],
      })

      assert.throws(() =>
        getDb()
          .insert(supplyItems)
          .values({
            supplyId: supply.id,
            productId: simpleProduct.id,
            form: 'SAC',
            quantity: 7,
            purchaseUnitPrice: 100,
            lineTotal: 700,
          })
          .run(),
      )

      assert.equal(itemCount(), 1)
    })
  })

  describe('impact sur le stock', () => {
    it('crée un mouvement APPROVISIONNEMENT IN par ligne', () => {
      createSupply({
        date: '2026-10-04',
        items: [
          line(transformableProduct, 'CARTON', 10, 10_000),
          line(transformableProduct, 'SEAU', 5, 2_500),
        ],
      })

      const movements = listProductMovements(transformableProduct.id).filter(
        (movement) => movement.movementType === 'APPROVISIONNEMENT',
      )

      assert.equal(movements.length, 2)

      for (const movement of movements) {
        assert.equal(movement.direction, 'IN')
        assert.equal(movement.reason, null)
        assert.ok(movement.quantity > 0)
      }

      assert.deepEqual(
        movements.map((movement) => [movement.form, movement.quantity, movement.signedQuantity]),
        // Both movements share the same created_at: the id breaks the tie and the
        // most recent insert comes first.
        [
          ['SEAU', 5, 5],
          ['CARTON', 10, 10],
        ],
      )
    })

    it('conserve le prix d\'achat réel de chaque document', () => {
      createSupply({
        date: '2026-10-04',
        items: [line(transformableProduct, 'CARTON', 10, 10_000)],
      })
      createSupply({
        date: '2026-10-05',
        items: [line(transformableProduct, 'CARTON', 5, 10_500)],
      })

      const [second, first] = listSupplies()

      assert.equal(second.totalAmount, 52_500)
      assert.equal(first.totalAmount, 100_000)

      const firstDetail = getSupplyById(first.id)

      assert.equal(firstDetail.items[0].purchaseUnitPrice, 10_000)
      assert.equal(firstDetail.items[0].lineTotal, 100_000)
    })

    it('cumule stock initial, approvisionnement et ajustement', () => {
      createSupply({
        date: '2026-10-04',
        items: [line(transformableProduct, 'CARTON', 5, 10_000)],
      })

      // 10 STOCK_INITIAL + 5 APPROVISIONNEMENT
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 15)

      adjustStock(transformableProduct.id, {
        productId: transformableProduct.id,
        form: 'CARTON',
        direction: 'OUT',
        quantity: 1,
        reason: 'Produit endommagé',
      })

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 14)
      assert.equal(movementCount(), 5)

      const history = listProductMovements(transformableProduct.id)

      assert.deepEqual(
        history.map((movement) => [movement.movementType, movement.signedQuantity]),
        [
          ['AJUSTEMENT', -1],
          ['APPROVISIONNEMENT', 5],
          ['STOCK_INITIAL', 2],
          ['STOCK_INITIAL', 10],
        ],
      )
    })

    it('garde un stock positif après un approvisionnement sans initialisation', () => {
      const product = seedSimpleProduct(category, 'RIZ 25 KG')

      createSupply({
        date: '2026-10-04',
        items: [line(product, 'SAC', 20, 4_000)],
      })

      // The reception is reversible by an adjustment, but never below zero.
      expectStockError('insufficientStock', () =>
        adjustStock(product.id, {
          productId: product.id,
          form: 'SAC',
          direction: 'OUT',
          quantity: 21,
          reason: 'Sortie excessive',
        }),
      )

      adjustStock(product.id, {
        productId: product.id,
        form: 'SAC',
        direction: 'OUT',
        quantity: 20,
        reason: 'Rupture de stock',
      })

      assert.equal(balanceOf(product.id, 'SAC'), 0)
      assert.deepEqual(
        listProductMovements(product.id).map((movement) => [
          movement.movementType,
          movement.direction,
          movement.signedQuantity,
        ]),
        [
          ['AJUSTEMENT', 'OUT', -20],
          ['APPROVISIONNEMENT', 'IN', 20],
        ],
      )
    })

    it('ne modifie jamais le prix d\'achat du produit', () => {      createSupply({
        date: '2026-10-04',
        items: [line(transformableProduct, 'CARTON', 10, 10_000)],
      })

      // The real price paid stays on the document, the product configuration
      // keeps its own price: the two never overwrite each other.
      assert.equal(getProductById(transformableProduct.id).purchasePrice, 12_000)
      assert.equal(getSupplyById(1).items[0].purchaseUnitPrice, 10_000)
    })

    it('refuse un mouvement APPROVISIONNEMENT sortant au niveau SQL', () => {
      assert.throws(() =>
        getDb()
          .insert(stockMovements)
          .values({
            productId: transformableProduct.id,
            form: 'CARTON',
            movementType: 'APPROVISIONNEMENT',
            direction: 'OUT',
            quantity: 1,
          })
          .run(),
      )

      assert.throws(() =>
        getDb()
          .insert(stockMovements)
          .values({
            productId: transformableProduct.id,
            form: 'CARTON',
            // A type of a module that does not exist yet: only the SQL CHECK can
            // refuse it, the TypeScript union already does.
            movementType: 'VENTE' as StockMovementType,
            direction: 'OUT',
            quantity: 1,
          })
          .run(),
      )

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
    })
  })

  describe('transaction', () => {
    it('annule tout si un mouvement de stock échoue', () => {
      // The two STOCK_INITIAL movements already exist: the trigger aborts the
      // second APPROVISIONNEMENT insert, like a real write failure would.
      execSql(`
        CREATE TRIGGER test_fail_second_supply_movement
        BEFORE INSERT ON stock_movements
        WHEN (SELECT count(*) FROM stock_movements) > 2
        BEGIN
          SELECT RAISE(ABORT, 'injected failure');
        END;
      `)

      try {
        assert.throws(() =>
          createSupply({
            date: '2026-10-04',
            items: [
              line(transformableProduct, 'CARTON', 5, 10_000),
              line(transformableProduct, 'SEAU', 5, 2_500),
            ],
          }),
        )
      } finally {
        execSql('DROP TRIGGER test_fail_second_supply_movement')
      }

      assert.equal(supplyCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(movementCount(), 3)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 2)

      // The failed document consumed neither its reference nor its movements.
      const supply = createSupply({
        date: '2026-10-04',
        items: [line(transformableProduct, 'CARTON', 5, 10_000)],
      })

      assert.equal(supply.reference, 'APP-000001')
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 15)
    })

    it('annule tout si une ligne échoue', () => {
      execSql(`
        CREATE TRIGGER test_fail_second_supply_item
        BEFORE INSERT ON supply_items
        WHEN (SELECT count(*) FROM supply_items) > 0
        BEGIN
          SELECT RAISE(ABORT, 'injected failure');
        END;
      `)

      try {
        assert.throws(() =>
          createSupply({
            date: '2026-10-04',
            items: [
              line(transformableProduct, 'CARTON', 5, 10_000),
              line(transformableProduct, 'SEAU', 5, 2_500),
            ],
          }),
        )
      } finally {
        execSql('DROP TRIGGER test_fail_second_supply_item')
      }

      assert.equal(supplyCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(movementCount(), 3)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
    })

    it('n\'écrit ni approvisionnement ni mouvement si un produit est inactif', () => {
      const other = seedSimpleProduct(category, 'SAVON')

      initializeStock(other.id, {
        productId: other.id,
        quantities: [{ form: 'SAC', quantity: 5 }],
      })

      setProductActive(other.id, false)

      expectSupplyError('productInactive', () =>
        createSupply({
          date: '2026-10-04',
          items: [
            line(simpleProduct, 'SAC', 5, 2_000),
            line(other, 'SAC', 5, 1_000),
          ],
        }),
      )

      assert.equal(supplyCount(), 0)
      assert.equal(itemCount(), 0)
      assert.equal(movementCount(), 4)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 20)
    })
  })

  describe('lecture', () => {
    it('liste les documents du plus récent au plus ancien', () => {
      createSupply({
        date: '2026-10-03',
        items: [line(simpleProduct, 'SAC', 2, 1_000)],
      })
      createSupply({
        date: '2026-10-04',
        items: [
          line(transformableProduct, 'CARTON', 10, 10_000),
          line(simpleProduct, 'SAC', 5, 2_000),
        ],
      })

      const list = listSupplies()

      assert.deepEqual(
        list.map((supply) => [supply.reference, supply.itemCount, supply.totalAmount]),
        [
          ['APP-000002', 2, 110_000],
          ['APP-000001', 1, 2_000],
        ],
      )
    })

    it('filtre la liste par référence et par fournisseur', () => {
      createSupply({
        date: '2026-10-03',
        supplierName: 'Grossiste Sokna',
        items: [line(simpleProduct, 'SAC', 2, 1_000)],
      })
      createSupply({
        date: '2026-10-04',
        supplierName: 'Dépôt Lat Dior',
        items: [line(transformableProduct, 'CARTON', 10, 10_000)],
      })

      assert.deepEqual(
        listSupplies({ search: 'app-000002' }).map((supply) => supply.reference),
        ['APP-000002'],
      )
      assert.deepEqual(
        listSupplies({ supplierSearch: 'sokna' }).map((supply) => supply.reference),
        ['APP-000001'],
      )
      assert.deepEqual(
        listSupplies({ supplierSearch: 'zzz' }),
        [],
      )
    })

    it('relit un document par identifiant et par référence', () => {
      const created = createSupply({
        date: '2026-10-04',
        items: [line(simpleProduct, 'SAC', 2, 1_000)],
      })

      assert.deepEqual(getSupplyById(created.id).items, created.items)
      assert.deepEqual(
        getSupplyByReference('app-000001').items,
        created.items,
      )

      expectSupplyError('notFound', () => getSupplyById(4242))
      expectSupplyError('notFound', () => getSupplyById(0))
      expectSupplyError('notFound', () => getSupplyByReference('APP-999999'))
    })

    it('affiche la date de réception choisie', () => {
      const supply = createSupply({
        date: '2026-10-04',
        items: [line(simpleProduct, 'SAC', 1, 100)],
      })

      const listed = listSupplies()[0]

      assert.equal(supply.date.getFullYear(), 2026)
      assert.equal(supply.date.getMonth(), 9)
      assert.equal(supply.date.getDate(), 4)
      assert.equal(listed.date.getTime(), supply.date.getTime())
    })
  })

  describe('persistance', () => {
    it('conserve le document, ses lignes et le stock après réouverture', () => {
      createSupply({
        date: '2026-10-04',
        supplierName: 'Grossiste Sokna',
        items: [
          line(transformableProduct, 'CARTON', 10, 10_000),
          line(simpleProduct, 'SAC', 4, 2_500),
        ],
      })

      reopenTestDatabase()

      const supply = getSupplyByReference('APP-000001')

      assert.equal(supply.reference, 'APP-000001')
      assert.equal(supply.supplierName, 'Grossiste Sokna')
      assert.equal(supply.items.length, 2)
      assert.equal(supply.totalAmount, 110_000)

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 20)
      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 24)

      const history = listProductMovements(transformableProduct.id)

      assert.equal(
        history.filter((movement) => movement.movementType === 'APPROVISIONNEMENT').length,
        1,
      )

      // The sequence continues after a restart.
      const next = createSupply({
        date: '2026-10-05',
        items: [line(simpleProduct, 'SAC', 1, 2_500)],
      })

      assert.equal(next.reference, 'APP-000002')
    })
  })
})

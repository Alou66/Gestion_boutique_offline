import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { getDb } from '../electron/database/client'
import { stockMovements, transformations } from '../electron/database/schema'
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
import { createSupply } from '../electron/services/supplyService'
import {
  createTransformation,
  getTransformationById,
  getTransformationByReference,
  listTransformableProducts,
  listTransformations,
  TransformationError,
} from '../electron/services/transformationService'
import type { TransformationErrorCode } from '../electron/services/transformationService'
import type {
  Category,
  Product,
  StockMovementType,
  TransformationCreateInput,
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

function expectTransformationError(
  code: TransformationErrorCode,
  run: () => unknown,
): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(
      error instanceof TransformationError,
      `expected TransformationError, received ${String(error)}`,
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

function transformationCount(): number {
  return getDb().select().from(transformations).all().length
}

function movementCount(): number {
  return getDb().select().from(stockMovements).all().length
}

function balanceOf(productId: number, form: string): number {
  return getProductFormStock(productId, form).quantity
}

function input(
  product: Product,
  sourceForm: string,
  sourceQuantity: number,
): TransformationCreateInput {
  return {
    productId: product.id,
    sourceForm,
    sourceQuantity,
    date: '2026-10-04',
  }
}

/**
 * The fixtures only hold 3 SEAUX: a reception is the realistic way to get more
 * before transforming the secondary form into the primary one. It is never an
 * automatic conversion.
 */
function receiveSeaux(product: Product, quantity: number): void {
  createSupply({
    date: '2026-10-04',
    items: [{ productId: product.id, form: 'SEAU', quantity, purchaseUnitPrice: 2_500 }],
  })
}

/** 1 CARTON = 4 SEAUX is the reference conversion of the fixtures. */
describe('module Transformation', () => {
  let category: Category
  let simpleProduct: Product
  let transformableProduct: Product

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

  describe('produits transformationnables', () => {
    it('ne propose que les produits actifs et transformables', () => {
      const inactive = seedTransformableProduct(category, 'CHOCOPAIN 2 KG')

      setProductActive(inactive.id, false)

      const available = listTransformableProducts()

      assert.deepEqual(
        available.map((product) => product.id),
        [transformableProduct.id],
      )
      assert.deepEqual(
        available.map((product) => [product.primaryForm, product.secondaryForm]),
        [['CARTON', 'SEAU']],
      )
    })

    it('ne propose jamais un produit simple', () => {
      assert.equal(
        listTransformableProducts().some((product) => product.id === simpleProduct.id),
        false,
      )
    })

    it('ignore un produit transformable sans conversion exploitable', () => {
      const broken = getDb()
        .select()
        .from(transformations)
        .all()

      assert.deepEqual(broken, [])

      execSql(`
        UPDATE products SET conversion_quantity = 0 WHERE id = ${transformableProduct.id}
      `)

      assert.deepEqual(listTransformableProducts(), [])

      // The service refuses it too, even when it is called directly.
      expectTransformationError('conversionRequired', () =>
        createTransformation(input(transformableProduct, 'CARTON', 2)),
      )

      assert.equal(transformationCount(), 0)
    })
  })

  describe('produits refusés', () => {
    it('refuse un produit inexistant', () => {
      expectTransformationError('productNotFound', () =>
        createTransformation({ productId: 4242, sourceForm: 'CARTON', sourceQuantity: 2 }),
      )

      assert.equal(transformationCount(), 0)
      assert.equal(movementCount(), 2)
    })

    it('refuse un produit inactif', () => {
      setProductActive(transformableProduct.id, false)

      expectTransformationError('productInactive', () =>
        createTransformation(input(transformableProduct, 'CARTON', 2)),
      )

      assert.equal(transformationCount(), 0)
      assert.equal(movementCount(), 2)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 3)
    })

    it('refuse un produit simple', () => {
      expectTransformationError('productNotTransformable', () =>
        createTransformation(input(simpleProduct, 'SAC', 5)),
      )

      assert.equal(transformationCount(), 0)
      assert.equal(movementCount(), 2)
    })

    it('refuse une forme qui n\'appartient pas au produit', () => {
      expectTransformationError('formInvalid', () =>
        createTransformation(input(transformableProduct, 'BIDON', 2)),
      )

      expectTransformationError('formInvalid', () =>
        createTransformation(input(transformableProduct, 'SAC', 2)),
      )

      assert.equal(transformationCount(), 0)
      assert.equal(movementCount(), 2)
    })

    it('refuse une forme absente', () => {
      expectTransformationError('formRequired', () =>
        createTransformation({ productId: transformableProduct.id, sourceForm: '', sourceQuantity: 2 }),
      )

      expectTransformationError('formRequired', () =>
        createTransformation({
          productId: transformableProduct.id,
          sourceForm: undefined as never,
          sourceQuantity: 2,
        }),
      )

      assert.equal(transformationCount(), 0)
    })
  })

  describe('forme principale vers forme secondaire', () => {
    it('transforme 2 CARTONS en 8 SEAUX avec les deux mouvements', () => {
      const created = createTransformation(
        input(transformableProduct, 'CARTON', 2),
      )

      assert.equal(created.reference, 'TRF-000001')
      assert.equal(created.productName, 'CHOCOPAIN 5 KG')
      assert.equal(created.sourceForm, 'CARTON')
      assert.equal(created.sourceQuantity, 2)
      assert.equal(created.destinationForm, 'SEAU')
      assert.equal(created.destinationQuantity, 8)

      const movements = listProductMovements(transformableProduct.id).filter(
        (movement) => movement.movementType === 'TRANSFORMATION',
      )

      assert.equal(movements.length, 2)
      assert.deepEqual(
        movements.map((movement) => [
          movement.form,
          movement.direction,
          movement.quantity,
          movement.reason,
        ]),
        [
          // Both movements share the same created_at: the id breaks the tie and
          // the most recent insert comes first.
          ['SEAU', 'IN', 8, null],
          ['CARTON', 'OUT', 2, null],
        ],
      )
    })

    it('déplace le stock sans jamais le créer', () => {
      createTransformation(input(transformableProduct, 'CARTON', 2))

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 8)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 11)

      // The final stock is exactly the sum of the movements, form by form.
      for (const level of getProductStock(transformableProduct.id)) {
        const expected = listProductMovements(transformableProduct.id)
        .filter(
          (movement) => movement.form === level.form && movement.movementType === 'TRANSFORMATION',
        )
        .reduce((sum, movement) => sum + movement.signedQuantity, 0)
        const initial = level.form === 'CARTON' ? 10 : 3

        assert.equal(level.quantity, initial + expected)
      }
    })

    it('accepte les exemples de la règle métier', () => {
      for (const quantity of [1, 2, 3]) {
        createTransformation(input(transformableProduct, 'CARTON', quantity))
      }

      // 1 + 2 + 3 = 6 CARTONS leave the stock and 4 + 8 + 12 = 24 SEAUX arrive.
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 4)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 27)
    })

    it('rend le stock disponible après la transformation', () => {
      createTransformation(input(transformableProduct, 'CARTON', 10))

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 0)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 43)

      // A form emptied to 0 is not an error: it is simply out of stock.
      expectTransformationError('insufficientStock', () =>
        createTransformation(input(transformableProduct, 'CARTON', 1)),
      )
    })
  })

  describe('forme secondaire vers forme principale', () => {
    it('transforme 4 SEAUX en 1 CARTON', () => {
      receiveSeaux(transformableProduct, 4)

      const created = createTransformation(input(transformableProduct, 'SEAU', 4))

      assert.equal(created.sourceForm, 'SEAU')
      assert.equal(created.destinationForm, 'CARTON')
      assert.equal(created.sourceQuantity, 4)
      assert.equal(created.destinationQuantity, 1)

      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 3)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 11)

      const movements = listProductMovements(transformableProduct.id).filter(
        (movement) => movement.movementType === 'TRANSFORMATION',
      )

      assert.deepEqual(
        movements.map((movement) => [movement.form, movement.direction, movement.quantity]),
        [
          ['CARTON', 'IN', 1],
          ['SEAU', 'OUT', 4],
        ],
      )
    })

    it('accepte les exemples de la règle métier', () => {
      receiveSeaux(transformableProduct, 8)

      createTransformation(input(transformableProduct, 'SEAU', 8))

      // 8 SEAUX = 2 CARTONS.
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 12)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 3)
    })
  })

  describe('stock insuffisant', () => {
    it('refuse une sortie supérieure au stock disponible', () => {
      expectTransformationError('insufficientStock', () =>
        createTransformation(input(transformableProduct, 'CARTON', 11)),
      )

      assert.equal(transformationCount(), 0)
      assert.equal(movementCount(), 2)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
    })

    it('refuse une transformation sur un produit sans aucun mouvement', () => {
      const fresh = seedTransformableProduct(category, 'CHOCOPAIN 2 KG')

      // A form without movement has a stock of 0: nothing can leave it.
      expectTransformationError('insufficientStock', () =>
        createTransformation(input(fresh, 'CARTON', 1)),
      )

      assert.equal(transformationCount(), 0)
    })

    it('laisse le stock intact après un refus', () => {
      receiveSeaux(transformableProduct, 4)
      createTransformation(input(transformableProduct, 'SEAU', 4))

      expectTransformationError('insufficientStock', () =>
        createTransformation(input(transformableProduct, 'SEAU', 8)),
      )

      assert.equal(transformationCount(), 1)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 3)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 11)
    })
  })

  describe('quantité source', () => {
    it('refuse une quantité nulle', () => {
      expectTransformationError('quantityInvalid', () =>
        createTransformation(input(transformableProduct, 'CARTON', 0)),
      )

      assert.equal(transformationCount(), 0)
      assert.equal(movementCount(), 2)
    })

    it('refuse une quantité négative', () => {
      expectTransformationError('quantityInvalid', () =>
        createTransformation(input(transformableProduct, 'CARTON', -2)),
      )

      expectTransformationError('quantityInvalid', () =>
        createTransformation(input(transformableProduct, 'SEAU', -8)),
      )

      assert.equal(transformationCount(), 0)
      assert.equal(movementCount(), 2)
    })

    it('refuse une quantité décimale', () => {
      expectTransformationError('quantityInvalid', () =>
        createTransformation(input(transformableProduct, 'CARTON', 1.5)),
      )

      expectTransformationError('quantityInvalid', () =>
        createTransformation(input(transformableProduct, 'SEAU', 3.7)),
      )

      assert.equal(transformationCount(), 0)
      assert.equal(movementCount(), 2)
    })

    it('refuse une quantité absente ou trop grande', () => {
      expectTransformationError('quantityRequired', () =>
        createTransformation({
          productId: transformableProduct.id,
          sourceForm: 'CARTON',
          sourceQuantity: undefined as never,
        }),
      )

      expectTransformationError('quantityTooHigh', () =>
        createTransformation(input(transformableProduct, 'CARTON', 1_000_001)),
      )

      assert.equal(transformationCount(), 0)
    })
  })

  describe('conversion exacte', () => {
    it('refuse une conversion impossible vers la forme secondaire', () => {
      // 1 SEAU = 0.25 CARTON: a fraction, so the transformation is refused.
      expectTransformationError('conversionInvalid', () =>
        createTransformation(input(transformableProduct, 'SEAU', 1)),
      )

      // 5 SEAUX = 1.25 CARTON: refused as well, no rounding and no loss.
      expectTransformationError('conversionInvalid', () =>
        createTransformation(input(transformableProduct, 'SEAU', 5)),
      )

      expectTransformationError('conversionInvalid', () =>
        createTransformation(input(transformableProduct, 'SEAU', 6)),
      )

      assert.equal(transformationCount(), 0)
      assert.equal(movementCount(), 2)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 3)
    })

    it('accepte une conversion exacte vers la forme principale', () => {
      receiveSeaux(transformableProduct, 12)

      const created = createTransformation(input(transformableProduct, 'SEAU', 12))

      assert.equal(created.destinationQuantity, 3)
    })

    it('refuse un résultat plus grand que la quantité maximale', () => {
      const small = seedTransformableProduct(category, 'CHOCOPAIN 10 KG', {
        conversionQuantity: 1_000_000,
      })

      initializeStock(small.id, {
        productId: small.id,
        quantities: [
          { form: 'CARTON', quantity: 3 },
          { form: 'SEAU', quantity: 0 },
        ],
      })

      expectTransformationError('quantityTooHigh', () =>
        createTransformation(input(small, 'CARTON', 2)),
      )

      assert.equal(transformationCount(), 0)
    })
  })

  describe('atomicité', () => {
    it('annule tout si le second mouvement échoue', () => {
      // The two STOCK_INITIAL movements already exist: the trigger aborts the
      // second TRANSFORMATION insert, like a real write failure would.
      execSql(`
        CREATE TRIGGER test_fail_second_transformation_movement
        BEFORE INSERT ON stock_movements
        WHEN (SELECT count(*) FROM stock_movements) > 2
        BEGIN
          SELECT RAISE(ABORT, 'injected failure');
        END;
      `)

      try {
        assert.throws(() =>
          createTransformation(input(transformableProduct, 'CARTON', 2)),
        )
      } finally {
        execSql('DROP TRIGGER test_fail_second_transformation_movement')
      }

      assert.equal(transformationCount(), 0)
      assert.equal(movementCount(), 2)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 3)

      // The failed document consumed neither its reference nor its movements.
      const created = createTransformation(input(transformableProduct, 'CARTON', 2))

      assert.equal(created.reference, 'TRF-000001')
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 8)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 11)
    })

    it('annule tout si l\'en-tête du document échoue', () => {
      execSql(`
        CREATE TRIGGER test_fail_transformation_header
        BEFORE INSERT ON transformations
        BEGIN
          SELECT RAISE(ABORT, 'injected failure');
        END;
      `)

      try {
        assert.throws(() =>
          createTransformation(input(transformableProduct, 'CARTON', 2)),
        )
      } finally {
        execSql('DROP TRIGGER test_fail_transformation_header')
      }

      assert.equal(transformationCount(), 0)
      assert.equal(movementCount(), 2)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
    })

    it('n\'écrit rien si le produit devient inactif pendant la transaction', () => {
      setProductActive(transformableProduct.id, false)

      expectTransformationError('productInactive', () =>
        createTransformation(input(transformableProduct, 'CARTON', 2)),
      )

      assert.equal(transformationCount(), 0)
      assert.equal(movementCount(), 2)
    })
  })

  describe('références', () => {
    it('génère la référence automatiquement et séquentiellement', () => {
      const first = createTransformation(input(transformableProduct, 'CARTON', 1))
      const second = createTransformation(input(transformableProduct, 'SEAU', 4))
      const third = createTransformation(input(transformableProduct, 'CARTON', 1))

      assert.deepEqual(
        [first.reference, second.reference, third.reference],
        ['TRF-000001', 'TRF-000002', 'TRF-000003'],
      )
      assert.equal(
        new Set(listTransformations().map((entry) => entry.reference)).size,
        3,
      )
    })

    it('interdit une référence en double au niveau SQL', () => {
      createTransformation(input(transformableProduct, 'CARTON', 1))

      assert.throws(() =>
        getDb()
          .insert(transformations)
          .values({
            reference: 'TRF-000001',
            productId: transformableProduct.id,
            sourceForm: 'CARTON',
            sourceQuantity: 1,
            destinationForm: 'SEAU',
            destinationQuantity: 4,
            date: new Date(2026, 9, 4),
          })
          .run(),
      )
    })

    it('interdit une quantité nulle ou négative au niveau SQL', () => {
      assert.throws(() =>
        getDb()
          .insert(transformations)
          .values({
            reference: 'TRF-999999',
            productId: transformableProduct.id,
            sourceForm: 'CARTON',
            sourceQuantity: 0,
            destinationForm: 'SEAU',
            destinationQuantity: 4,
            date: new Date(2026, 9, 4),
          })
          .run(),
      )

      assert.throws(() =>
        getDb()
          .insert(transformations)
          .values({
            reference: 'TRF-999998',
            productId: transformableProduct.id,
            sourceForm: 'CARTON',
            sourceQuantity: 1,
            destinationForm: 'SEAU',
            destinationQuantity: -4,
            date: new Date(2026, 9, 4),
          })
          .run(),
      )
    })

    it('interdit deux formes identiques au niveau SQL', () => {
      assert.throws(() =>
        getDb()
          .insert(transformations)
          .values({
            reference: 'TRF-999997',
            productId: transformableProduct.id,
            sourceForm: 'CARTON',
            sourceQuantity: 1,
            destinationForm: 'CARTON',
            destinationQuantity: 4,
            date: new Date(2026, 9, 4),
          })
          .run(),
      )
    })

    it('interdit un produit inexistant au niveau SQL', () => {
      assert.throws(() =>
        getDb()
          .insert(transformations)
          .values({
            reference: 'TRF-999996',
            productId: 4242,
            sourceForm: 'CARTON',
            sourceQuantity: 1,
            destinationForm: 'SEAU',
            destinationQuantity: 4,
            date: new Date(2026, 9, 4),
          })
          .run(),
      )
    })
  })

  describe('mouvements de stock', () => {
    it('accepte TRANSFORMATION dans les deux sens au niveau SQL', () => {
      assert.doesNotThrow(() =>
        getDb()
          .insert(stockMovements)
          .values({
            productId: transformableProduct.id,
            form: 'CARTON',
            movementType: 'TRANSFORMATION',
            direction: 'OUT',
            quantity: 2,
          })
          .run(),
      )

      assert.doesNotThrow(() =>
        getDb()
          .insert(stockMovements)
          .values({
            productId: transformableProduct.id,
            form: 'SEAU',
            movementType: 'TRANSFORMATION',
            direction: 'IN',
            quantity: 8,
          })
          .run(),
      )

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 8)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 11)
    })

    it('refuse un mouvement TRANSFORMATION avec un motif', () => {
      assert.throws(() =>
        getDb()
          .insert(stockMovements)
          .values({
            productId: transformableProduct.id,
            form: 'CARTON',
            movementType: 'TRANSFORMATION',
            direction: 'OUT',
            quantity: 2,
            reason: 'Conversion manuelle',
          })
          .run(),
      )
    })

    it('refuse toujours un type de mouvement inexistant', () => {
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
    })

    it('conserve le prix d\'achat du produit', () => {
      createTransformation(input(transformableProduct, 'CARTON', 2))

      assert.equal(getProductById(transformableProduct.id).purchasePrice, 12_000)
      assert.equal(getProductById(transformableProduct.id).salePrice, 15_000)
      assert.equal(
        getProductById(transformableProduct.id).conversionQuantity,
        4,
      )
    })

    it('cumule approvisionnement, ajustement et transformation', () => {
      createTransformation(input(transformableProduct, 'CARTON', 2))

      adjustStock(transformableProduct.id, {
        productId: transformableProduct.id,
        form: 'SEAU',
        direction: 'OUT',
        quantity: 1,
        reason: 'Seau cassé',
      })

      // 8 CARTONS transformed, 10 + 8 - 1 SEAUX.
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 8)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 10)

      assert.deepEqual(
        listProductMovements(transformableProduct.id).map((movement) => [
          movement.movementType,
          movement.signedQuantity,
        ]),
        [
          ['AJUSTEMENT', -1],
          ['TRANSFORMATION', 8],
          ['TRANSFORMATION', -2],
          ['STOCK_INITIAL', 3],
          ['STOCK_INITIAL', 10],
        ],
      )
    })

    it('permet une correction par transformation inverse', () => {
      createTransformation(input(transformableProduct, 'CARTON', 2))
      // 2 CARTONS -> 8 SEAUX, then 8 SEAUX -> 2 CARTONS.
      const inverse = createTransformation(input(transformableProduct, 'SEAU', 8))

      assert.equal(inverse.reference, 'TRF-000002')
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 3)
      assert.equal(transformationCount(), 2)
    })

    it('ne rend plus le stock initialisable après une transformation', () => {
      const fresh = seedTransformableProduct(category, 'CHOCOPAIN 2 KG')

      // A reception, not an initial stock: the transformation can only refuse a
      // product that was never declared.
      createSupply({
        date: '2026-10-04',
        items: [{ productId: fresh.id, form: 'CARTON', quantity: 1, purchaseUnitPrice: 10_000 }],
      })

      createTransformation(input(fresh, 'CARTON', 1))

      expectStockError('alreadyHasMovements', () =>
        initializeStock(fresh.id, {
          productId: fresh.id,
          quantities: [
            { form: 'CARTON', quantity: 5 },
            { form: 'SEAU', quantity: 0 },
          ],
        }),
      )

      assert.equal(balanceOf(fresh.id, 'CARTON'), 0)
      assert.equal(balanceOf(fresh.id, 'SEAU'), 4)
    })
  })

  describe('lecture', () => {
    it('liste les documents du plus récent au plus ancien', () => {
      createTransformation(input(transformableProduct, 'CARTON', 1))
      createTransformation(input(transformableProduct, 'CARTON', 2))

      assert.deepEqual(
        listTransformations().map((entry) => [
          entry.reference,
          entry.sourceQuantity,
          entry.destinationQuantity,
        ]),
        [
          ['TRF-000002', 2, 8],
          ['TRF-000001', 1, 4],
        ],
      )
    })

    it('filtre la liste par référence et par produit', () => {
      const other = seedTransformableProduct(category, 'CHOCOPAIN 2 KG')

      initializeStock(other.id, {
        productId: other.id,
        quantities: [
          { form: 'CARTON', quantity: 5 },
          { form: 'SEAU', quantity: 0 },
        ],
      })

      createTransformation(input(transformableProduct, 'CARTON', 1))
      createTransformation(input(other, 'CARTON', 2))

      assert.deepEqual(
        listTransformations({ search: 'trf-000002' }).map((entry) => entry.reference),
        ['TRF-000002'],
      )
      assert.deepEqual(
        listTransformations({ productSearch: 'chocopain 2' }).map((entry) => entry.reference),
        ['TRF-000002'],
      )
      assert.deepEqual(listTransformations({ productSearch: 'zzz' }), [])
    })

    it('relit un document par identifiant et par référence', () => {
      const created = createTransformation(input(transformableProduct, 'CARTON', 2))

      assert.equal(getTransformationById(created.id).reference, 'TRF-000001')
      assert.equal(
        getTransformationByReference('trf-000001').destinationQuantity,
        8,
      )

      expectTransformationError('notFound', () => getTransformationById(4242))
      expectTransformationError('notFound', () => getTransformationById(0))
      expectTransformationError('notFound', () =>
        getTransformationByReference('TRF-999999'),
      )
    })

    it('affiche la date choisie', () => {
      const created = createTransformation({
        productId: transformableProduct.id,
        sourceForm: 'CARTON',
        sourceQuantity: 1,
        date: '2026-02-28',
      })

      const listed = listTransformations()[0]

      assert.equal(created.date.getFullYear(), 2026)
      assert.equal(created.date.getMonth(), 1)
      assert.equal(created.date.getDate(), 28)
      assert.equal(listed.date.getTime(), created.date.getTime())
    })

    it('refuse une date invalide ou hors plage', () => {
      expectTransformationError('dateInvalid', () =>
        createTransformation({
          productId: transformableProduct.id,
          sourceForm: 'CARTON',
          sourceQuantity: 1,
          date: '04/10/2026',
        }),
      )

      expectTransformationError('dateInvalid', () =>
        createTransformation({
          productId: transformableProduct.id,
          sourceForm: 'CARTON',
          sourceQuantity: 1,
          date: '2026-02-31',
        }),
      )

      expectTransformationError('dateOutOfRange', () =>
        createTransformation({
          productId: transformableProduct.id,
          sourceForm: 'CARTON',
          sourceQuantity: 1,
          date: '1999-12-31',
        }),
      )

      assert.equal(transformationCount(), 0)
      assert.equal(movementCount(), 2)
    })

    it('lit le stock du détail depuis les mouvements', () => {
      const created = createTransformation(input(transformableProduct, 'CARTON', 2))

      assert.deepEqual(
        created.stockAfter.map((level) => [level.form, level.quantity]),
        [
          ['CARTON', 8],
          ['SEAU', 11],
        ],
      )
    })
  })

  describe('persistance', () => {
    it('conserve le document et ses mouvements après réouverture', () => {
      createTransformation(input(transformableProduct, 'CARTON', 2))

      reopenTestDatabase()

      const reloaded = getTransformationByReference('TRF-000001')

      assert.equal(reloaded.reference, 'TRF-000001')
      assert.equal(reloaded.productName, 'CHOCOPAIN 5 KG')
      assert.equal(reloaded.sourceForm, 'CARTON')
      assert.equal(reloaded.sourceQuantity, 2)
      assert.equal(reloaded.destinationForm, 'SEAU')
      assert.equal(reloaded.destinationQuantity, 8)

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 8)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 11)

      assert.equal(
        listProductMovements(transformableProduct.id).filter(
          (movement) => movement.movementType === 'TRANSFORMATION',
        ).length,
        2,
      )

      // The sequence continues after a restart.
      assert.equal(
        createTransformation(input(transformableProduct, 'CARTON', 1)).reference,
        'TRF-000002',
      )
    })
  })
})
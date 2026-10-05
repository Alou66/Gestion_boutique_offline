import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { getDb } from '../electron/database/client'
import { stockMovements } from '../electron/database/schema'
import {
  adjustStock,
  getProductFormStock,
  getProductStock,
  initializeStock,
  isStockInitialized,
  listProductMovements,
  listStocks,
  StockError,
} from '../electron/services/stockService'
import type { StockErrorCode } from '../electron/services/stockService'
import type { Category, Product } from '../electron/types'
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

function balanceOf(productId: number, form: string): number {
  return getProductFormStock(productId, form).quantity
}

describe('module Stock', () => {
  let category: Category
  let simpleProduct: Product
  let transformableProduct: Product

  beforeEach(() => {
    resetTestDatabase()
    category = seedCategory('BOISSONS')
    simpleProduct = seedSimpleProduct(category, 'SUCRE 1 KG')
    transformableProduct = seedTransformableProduct(category, 'CHOCOPAIN 5 KG')
  })

  after(() => {
    closeTestDatabase()
  })

  describe('initialisation du stock', () => {
    it('initialise un produit simple avec une seule forme logique', () => {
      const levels = initializeStock(simpleProduct.id, {
        productId: simpleProduct.id,
        quantities: [{ form: 'SAC', quantity: 20 }],
      })

      assert.equal(levels.length, 1)
      assert.deepEqual(
        levels.map((level) => [level.form, level.quantity, level.hasMovements]),
        [['SAC', 20, true]],
      )
      assert.equal(movementCount(), 1)
      assert.equal(isStockInitialized(simpleProduct.id), true)
      assert.equal(isStockInitialized(transformableProduct.id), false)
    })

    it('initialise les deux formes d’un produit transformable sans les convertir', () => {
      initializeStock(transformableProduct.id, {
        productId: transformableProduct.id,
        quantities: [
          { form: 'CARTON', quantity: 10 },
          { form: 'SEAU', quantity: 3 },
        ],
      })

      const levels = getProductStock(transformableProduct.id)

      assert.deepEqual(
        levels.map((level) => [level.form, level.quantity]),
        [
          ['CARTON', 10],
          ['SEAU', 3],
        ],
      )
      assert.equal(movementCount(), 2)
    })

    it('accepte une forme initialisée à zéro si une autre est positive', () => {
      initializeStock(transformableProduct.id, {
        productId: transformableProduct.id,
        quantities: [
          { form: 'CARTON', quantity: 10 },
          { form: 'SEAU', quantity: 0 },
        ],
      })

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 0)
      assert.equal(isStockInitialized(transformableProduct.id), true)
      // A form at 0 carries no movement: its balance is already 0.
      assert.equal(movementCount(), 1)
    })

    it('refuse une initialisation entièrement à zéro', () => {
      expectStockError('positiveQuantityRequired', () =>
        initializeStock(transformableProduct.id, {
          productId: transformableProduct.id,
          quantities: [
            { form: 'CARTON', quantity: 0 },
            { form: 'SEAU', quantity: 0 },
          ],
        }),
      )

      expectStockError('positiveQuantityRequired', () =>
        initializeStock(simpleProduct.id, {
          productId: simpleProduct.id,
          quantities: [{ form: 'SAC', quantity: 0 }],
        }),
      )

      assert.equal(movementCount(), 0)
      assert.equal(isStockInitialized(transformableProduct.id), false)
    })

    it('refuse une quantité négative ou non entière', () => {
      expectStockError('quantityInvalid', () =>
        initializeStock(simpleProduct.id, {
          productId: simpleProduct.id,
          quantities: [{ form: 'SAC', quantity: -5 }],
        }),
      )

      expectStockError('quantityInvalid', () =>
        initializeStock(simpleProduct.id, {
          productId: simpleProduct.id,
          quantities: [{ form: 'SAC', quantity: 1.5 }],
        }),
      )

      assert.equal(movementCount(), 0)
    })

    it('refuse une deuxième initialisation', () => {
      initializeStock(transformableProduct.id, {
        productId: transformableProduct.id,
        quantities: [
          { form: 'CARTON', quantity: 10 },
          { form: 'SEAU', quantity: 3 },
        ],
      })

      expectStockError('alreadyInitialized', () =>
        initializeStock(transformableProduct.id, {
          productId: transformableProduct.id,
          quantities: [
            { form: 'CARTON', quantity: 99 },
            { form: 'SEAU', quantity: 99 },
          ],
        }),
      )

      assert.equal(movementCount(), 2)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
    })

    it('refuse une initialisation dès que le produit a déjà des mouvements', () => {
      // A reception or an adjustment opens the history: the initial stock can no
      // longer be declared, the movements are not touched.
      adjustStock(transformableProduct.id, {
        productId: transformableProduct.id,
        form: 'CARTON',
        direction: 'IN',
        quantity: 5,
        reason: 'Entrée avant initialisation',
      })

      expectStockError('alreadyHasMovements', () =>
        initializeStock(transformableProduct.id, {
          productId: transformableProduct.id,
          quantities: [
            { form: 'CARTON', quantity: 50 },
            { form: 'SEAU', quantity: 50 },
          ],
        }),
      )

      assert.equal(movementCount(), 1)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 5)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 0)
      assert.equal(isStockInitialized(transformableProduct.id), false)
    })

    it('verrouille la quantité initiale : seul un ajustement peut la corriger', () => {
      initializeStock(simpleProduct.id, {
        productId: simpleProduct.id,
        quantities: [{ form: 'SAC', quantity: 10 }],
      })

      adjustStock(simpleProduct.id, {
        productId: simpleProduct.id,
        form: 'SAC',
        direction: 'OUT',
        quantity: 1,
        reason: 'Erreur inventaire initial',
      })

      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 9)

      const movements = listProductMovements(simpleProduct.id)

      assert.equal(movements.length, 2)
      assert.equal(movements[0].movementType, 'AJUSTEMENT')
      assert.equal(movements[1].movementType, 'STOCK_INITIAL')
      assert.equal(movements[1].quantity, 10)
      assert.equal(movements[1].signedQuantity, 10)
    })

    it('normalise la forme saisie avant de la stocker', () => {
      initializeStock(simpleProduct.id, {
        productId: simpleProduct.id,
        quantities: [{ form: '  sac ', quantity: 4 }],
      })

      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 4)
    })

    it('refuse des formes qui ne correspondent pas au produit', () => {
      // Missing secondary form.
      expectStockError('formsMismatch', () =>
        initializeStock(transformableProduct.id, {
          productId: transformableProduct.id,
          quantities: [{ form: 'CARTON', quantity: 4 }],
        }),
      )

      // A form the product does not have.
      expectStockError('formInvalid', () =>
        initializeStock(transformableProduct.id, {
          productId: transformableProduct.id,
          quantities: [
            { form: 'CARTON', quantity: 4 },
            { form: 'PAQUET', quantity: 2 },
          ],
        }),
      )

      // A transformable form submitted for a simple product.
      expectStockError('formInvalid', () =>
        initializeStock(simpleProduct.id, {
          productId: simpleProduct.id,
          quantities: [{ form: 'CARTON', quantity: 4 }],
        }),
      )

      assert.equal(movementCount(), 0)
    })
  })

  describe('calcul du stock', () => {
    it('additionne les mouvements de plusieurs formes indépendantes', () => {
      initializeStock(transformableProduct.id, {
        productId: transformableProduct.id,
        quantities: [
          { form: 'CARTON', quantity: 10 },
          { form: 'SEAU', quantity: 3 },
        ],
      })

      adjustStock(transformableProduct.id, {
        productId: transformableProduct.id,
        form: 'CARTON',
        direction: 'OUT',
        quantity: 2,
        reason: 'Produit endommagé',
      })
      adjustStock(transformableProduct.id, {
        productId: transformableProduct.id,
        form: 'CARTON',
        direction: 'IN',
        quantity: 5,
        reason: "Écart d'inventaire",
      })
      adjustStock(transformableProduct.id, {
        productId: transformableProduct.id,
        form: 'SEAU',
        direction: 'OUT',
        quantity: 1,
        reason: 'Seau perdu',
      })

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 13)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 2)
    })

    it('liste une ligne par produit et par forme', () => {
      initializeStock(transformableProduct.id, {
        productId: transformableProduct.id,
        quantities: [
          { form: 'CARTON', quantity: 10 },
          { form: 'SEAU', quantity: 3 },
        ],
      })
      initializeStock(simpleProduct.id, {
        productId: simpleProduct.id,
        quantities: [{ form: 'SAC', quantity: 20 }],
      })

      const lines = listStocks().map((line) => [
        line.productName,
        line.form,
        line.quantity,
      ])

      assert.deepEqual(lines, [
        ['CHOCOPAIN 5 KG', 'CARTON', 10],
        ['CHOCOPAIN 5 KG', 'SEAU', 3],
        ['SUCRE 1 KG', 'SAC', 20],
      ])
    })

    it('expose un produit sans mouvement avec un stock logique à zéro', () => {
      const lines = listStocks()

      assert.equal(lines.length, 3)
      // No artificial STOCK_INITIAL: a product without any movement is simply
      // displayed with a quantity of 0.
      assert.equal(
        lines.every((line) => line.quantity === 0 && !line.hasMovements),
        true,
      )
      assert.equal(movementCount(), 0)
      assert.equal(isStockInitialized(simpleProduct.id), false)
      assert.equal(isStockInitialized(transformableProduct.id), false)
      assert.deepEqual(
        getProductStock(transformableProduct.id).map((level) => [level.form, level.quantity]),
        [
          ['CARTON', 0],
          ['SEAU', 0],
        ],
      )
    })

    it('filtre la liste par produit et par catégorie', () => {
      const otherCategory = seedCategory('DROIT')
      seedSimpleProduct(otherCategory, 'SAVON')

      initializeStock(transformableProduct.id, {
        productId: transformableProduct.id,
        quantities: [
          { form: 'CARTON', quantity: 10 },
          { form: 'SEAU', quantity: 3 },
        ],
      })

      assert.deepEqual(
        listStocks({ search: 'choco' }).map((line) => line.productName),
        ['CHOCOPAIN 5 KG', 'CHOCOPAIN 5 KG'],
      )
      assert.deepEqual(
        listStocks({ categoryId: otherCategory.id }).map((line) => line.productName),
        ['SAVON'],
      )
      assert.equal(listStocks({ isActive: false }).length, 0)
    })

    it('rejette une forme inconnue pour un produit', () => {
      expectStockError('formInvalid', () => getProductFormStock(simpleProduct.id, 'BIDON'))
      expectStockError('productNotFound', () => getProductFormStock(9999, 'SAC'))
    })

    it('conserve le stock d’une forme renommée après initialisation', () => {
      initializeStock(transformableProduct.id, {
        productId: transformableProduct.id,
        quantities: [
          { form: 'CARTON', quantity: 10 },
          { form: 'SEAU', quantity: 3 },
        ],
      })

      getDb().$client.prepare('UPDATE products SET secondary_form = ? WHERE id = ?').run('BIDON', transformableProduct.id)

      const lines = getProductStock(transformableProduct.id)

      assert.deepEqual(
        lines.map((line) => [line.form, line.quantity, line.isLegacyForm]),
        [
          ['CARTON', 10, false],
          ['BIDON', 0, false],
          ['SEAU', 3, true],
        ],
      )
    })
  })

  describe('ajustement de stock', () => {
    beforeEach(() => {
      initializeStock(transformableProduct.id, {
        productId: transformableProduct.id,
        quantities: [
          { form: 'CARTON', quantity: 10 },
          { form: 'SEAU', quantity: 3 },
        ],
      })
    })

    it('enregistre une entrée avec son motif', () => {
      const result = adjustStock(transformableProduct.id, {
        productId: transformableProduct.id,
        form: 'CARTON',
        direction: 'IN',
        quantity: 2,
        reason: "Écart d'inventaire",
      })

      assert.equal(result.stock.quantity, 12)
      assert.equal(result.movement.movementType, 'AJUSTEMENT')
      assert.equal(result.movement.direction, 'IN')
      assert.equal(result.movement.signedQuantity, 2)
      assert.equal(result.movement.reason, "Écart d'inventaire")
    })

    it('enregistre une sortie avec son motif', () => {
      const result = adjustStock(transformableProduct.id, {
        productId: transformableProduct.id,
        form: 'CARTON',
        direction: 'OUT',
        quantity: 1,
        reason: 'Produit endommagé',
      })

      assert.equal(result.stock.quantity, 9)
      assert.equal(result.movement.signedQuantity, -1)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 3)
    })

    it('stocke toujours une quantité positive et le sens dans la direction', () => {
      adjustStock(transformableProduct.id, {
        productId: transformableProduct.id,
        form: 'CARTON',
        direction: 'OUT',
        quantity: 4,
        reason: 'Casse',
      })

      const movement = listProductMovements(transformableProduct.id)[0]

      assert.equal(movement.quantity, 4)
      assert.ok(movement.quantity > 0)
      assert.equal(movement.direction, 'OUT')
    })

    it('exige un motif', () => {
      expectStockError('reasonRequired', () =>
        adjustStock(transformableProduct.id, {
          productId: transformableProduct.id,
          form: 'CARTON',
          direction: 'IN',
          quantity: 1,
          reason: '   ',
        }),
      )

      assert.equal(movementCount(), 2)
    })

    it('exige une quantité strictement positive', () => {
      expectStockError('quantityInvalid', () =>
        adjustStock(transformableProduct.id, {
          productId: transformableProduct.id,
          form: 'CARTON',
          direction: 'IN',
          quantity: 0,
          reason: 'Test',
        }),
      )

      expectStockError('quantityInvalid', () =>
        adjustStock(transformableProduct.id, {
          productId: transformableProduct.id,
          form: 'CARTON',
          direction: 'IN',
          quantity: -3,
          reason: 'Test',
        }),
      )

      assert.equal(movementCount(), 2)
    })

    it('refuse une sortie supérieure au stock disponible', () => {
      expectStockError('insufficientStock', () =>
        adjustStock(transformableProduct.id, {
          productId: transformableProduct.id,
          form: 'SEAU',
          direction: 'OUT',
          quantity: 4,
          reason: 'Stock insuffisant',
        }),
      )

      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 3)
      assert.equal(movementCount(), 2)
    })

    it('ne laisse jamais le stock négatif même après plusieurs sorties', () => {
      adjustStock(transformableProduct.id, {
        productId: transformableProduct.id,
        form: 'SEAU',
        direction: 'OUT',
        quantity: 2,
        reason: 'Première sortie',
      })

      expectStockError('insufficientStock', () =>
        adjustStock(transformableProduct.id, {
          productId: transformableProduct.id,
          form: 'SEAU',
          direction: 'OUT',
          quantity: 2,
          reason: 'Sortie impossible',
        }),
      )

      adjustStock(transformableProduct.id, {
        productId: transformableProduct.id,
        form: 'SEAU',
        direction: 'OUT',
        quantity: 1,
        reason: 'Dernière sortie',
      })

      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 0)
      assert.ok(balanceOf(transformableProduct.id, 'SEAU') >= 0)
      assert.equal(movementCount(), 4)
    })

    it('ajuste un produit sans mouvement : son stock vaut zéro', () => {
      const result = adjustStock(simpleProduct.id, {
        productId: simpleProduct.id,
        form: 'SAC',
        direction: 'IN',
        quantity: 5,
        reason: 'Entrée tardive',
      })

      assert.equal(result.stock.quantity, 5)
      assert.equal(result.stock.hasMovements, true)
      assert.equal(movementCount(), 3)
      assert.equal(isStockInitialized(simpleProduct.id), false)
    })

    it('refuse une sortie sur un produit sans mouvement, jamais de stock négatif', () => {
      expectStockError('insufficientStock', () =>
        adjustStock(simpleProduct.id, {
          productId: simpleProduct.id,
          form: 'SAC',
          direction: 'OUT',
          quantity: 1,
          reason: 'Sortie impossible',
        }),
      )

      assert.equal(balanceOf(simpleProduct.id, 'SAC'), 0)
      assert.equal(movementCount(), 2)
    })
  })

  describe('sécurité métier', () => {
    it('refuse un produit inexistant', () => {
      expectStockError('productNotFound', () =>
        initializeStock(4242, { productId: 4242, quantities: [{ form: 'SAC', quantity: 3 }] }),
      )

      expectStockError('productNotFound', () =>
        adjustStock(4242, {
          productId: 4242,
          form: 'SAC',
          direction: 'IN',
          quantity: 1,
          reason: 'Test',
        }),
      )

      expectStockError('productNotFound', () => listProductMovements(4242))
    })

    it('refuse toute écriture sur un produit inactif', () => {
      setProductActive(simpleProduct.id, false)

      expectStockError('productInactive', () =>
        initializeStock(simpleProduct.id, {
          productId: simpleProduct.id,
          quantities: [{ form: 'SAC', quantity: 10 }],
        }),
      )

      initializeStock(transformableProduct.id, {
        productId: transformableProduct.id,
        quantities: [
          { form: 'CARTON', quantity: 10 },
          { form: 'SEAU', quantity: 3 },
        ],
      })
      setProductActive(transformableProduct.id, false)

      expectStockError('productInactive', () =>
        adjustStock(transformableProduct.id, {
          productId: transformableProduct.id,
          form: 'CARTON',
          direction: 'OUT',
          quantity: 1,
          reason: 'Test',
        }),
      )

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 10)
    })

    it('refuse une forme qui n’appartient pas au produit', () => {
      initializeStock(transformableProduct.id, {
        productId: transformableProduct.id,
        quantities: [
          { form: 'CARTON', quantity: 10 },
          { form: 'SEAU', quantity: 3 },
        ],
      })

      expectStockError('formInvalid', () =>
        adjustStock(transformableProduct.id, {
          productId: transformableProduct.id,
          form: 'BIDON',
          direction: 'OUT',
          quantity: 1,
          reason: 'Test',
        }),
      )

      assert.equal(movementCount(), 2)
    })

    it('annule toute l’initialisation si une écriture échoue (rollback)', () => {
      // Fails the second INSERT of the transaction, like a disk or constraint
      // failure would: the first movement must not survive.
      execSql(`
        CREATE TRIGGER test_fail_second_insert
        BEFORE INSERT ON stock_movements
        WHEN (SELECT count(*) FROM stock_movements) > 0
        BEGIN
          SELECT RAISE(ABORT, 'injected failure');
        END;
      `)

      try {
        assert.throws(() =>
          initializeStock(transformableProduct.id, {
            productId: transformableProduct.id,
            quantities: [
              { form: 'CARTON', quantity: 10 },
              { form: 'SEAU', quantity: 3 },
            ],
          }),
        )
      } finally {
        execSql('DROP TRIGGER test_fail_second_insert')
      }

      assert.equal(movementCount(), 0)
      assert.equal(isStockInitialized(transformableProduct.id), false)
      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 0)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 0)
    })

    it('empêche une double initialisation même en contournant le service', () => {
      initializeStock(simpleProduct.id, {
        productId: simpleProduct.id,
        quantities: [{ form: 'SAC', quantity: 10 }],
      })

      assert.throws(() =>
        getDb()
          .insert(stockMovements)
          .values({
            productId: simpleProduct.id,
            form: 'SAC',
            movementType: 'STOCK_INITIAL',
            direction: 'IN',
            quantity: 7,
          })
          .run(),
      )

      assert.equal(movementCount(), 1)
    })

    it('interdit une quantité nulle et un ajustement sans motif au niveau SQL', () => {
      assert.throws(() =>
        getDb()
          .insert(stockMovements)
          .values({
            productId: simpleProduct.id,
            form: 'SAC',
            movementType: 'STOCK_INITIAL',
            direction: 'IN',
            quantity: 0,
          })
          .run(),
      )

      assert.throws(() =>
        getDb()
          .insert(stockMovements)
          .values({
            productId: simpleProduct.id,
            form: 'SAC',
            movementType: 'AJUSTEMENT',
            direction: 'OUT',
            quantity: 1,
          })
          .run(),
      )

      assert.throws(() =>
        getDb()
          .insert(stockMovements)
          .values({
            productId: 9999,
            form: 'SAC',
            movementType: 'STOCK_INITIAL',
            direction: 'IN',
            quantity: 1,
          })
          .run(),
      )

      assert.equal(movementCount(), 0)
    })
  })

  describe('historique', () => {
    it('conserve tous les mouvements, du plus récent au plus ancien', () => {
      initializeStock(transformableProduct.id, {
        productId: transformableProduct.id,
        quantities: [
          { form: 'CARTON', quantity: 10 },
          { form: 'SEAU', quantity: 3 },
        ],
      })
      adjustStock(transformableProduct.id, {
        productId: transformableProduct.id,
        form: 'CARTON',
        direction: 'OUT',
        quantity: 1,
        reason: 'Produit endommagé',
      })

      const movements = listProductMovements(transformableProduct.id)

      assert.equal(movements.length, 3)
      // Both STOCK_INITIAL share the same created_at: the id breaks the tie, the
      // most recent insert comes first.
      assert.deepEqual(
        movements.map((movement) => [movement.movementType, movement.form, movement.signedQuantity]),
        [
          ['AJUSTEMENT', 'CARTON', -1],
          ['STOCK_INITIAL', 'SEAU', 3],
          ['STOCK_INITIAL', 'CARTON', 10],
        ],
      )
      assert.equal(movements[0].reason, 'Produit endommagé')
      assert.equal(movements[2].reason, null)
      assert.ok(movements[0].createdAt instanceof Date)
    })

    it('n’affiche que les types de mouvement existants à ce jour', () => {
      initializeStock(simpleProduct.id, {
        productId: simpleProduct.id,
        quantities: [{ form: 'SAC', quantity: 1 }],
      })

      const types = new Set(listProductMovements(simpleProduct.id).map((m) => m.movementType))

      assert.deepEqual([...types], ['STOCK_INITIAL'])
    })
  })

  describe('persistance', () => {
    it('conserve les mouvements après fermeture et réouverture de SQLite', () => {
      initializeStock(transformableProduct.id, {
        productId: transformableProduct.id,
        quantities: [
          { form: 'CARTON', quantity: 10 },
          { form: 'SEAU', quantity: 3 },
        ],
      })
      adjustStock(transformableProduct.id, {
        productId: transformableProduct.id,
        form: 'CARTON',
        direction: 'OUT',
        quantity: 1,
        reason: 'Produit endommagé',
      })

      reopenTestDatabase()

      assert.equal(balanceOf(transformableProduct.id, 'CARTON'), 9)
      assert.equal(balanceOf(transformableProduct.id, 'SEAU'), 3)
      assert.equal(listProductMovements(transformableProduct.id).length, 3)
      assert.equal(isStockInitialized(transformableProduct.id), true)

      expectStockError('alreadyInitialized', () =>
        initializeStock(transformableProduct.id, {
          productId: transformableProduct.id,
          quantities: [
            { form: 'CARTON', quantity: 5 },
            { form: 'SEAU', quantity: 5 },
          ],
        }),
      )
    })
  })
})
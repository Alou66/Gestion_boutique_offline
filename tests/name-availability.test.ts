import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { registerIpcHandlers } from '../electron/ipc'
import { CATEGORY_ERRORS } from '../electron/services/categoryService'
import { PRODUCT_ERRORS } from '../electron/services/productService'
import type { Category, CategoryResult, Product, ProductResult } from '../electron/types'
import { categoryService } from '../src/services/category.service'
import { productService } from '../src/services/product.service'
import {
  closeTestDatabase,
  resetTestDatabase,
  seedCategory,
  seedSimpleProduct,
} from './helpers/database'
import { invokeHandler, registeredChannels } from './stubs/electron'

/**
 * Unicité des noms de catégories et de produits.
 *
 * Le contrôle temps réel du formulaire est une aide à la saisie : l'autorité
 * reste le service principal, qui normalise puis refuse le doublon, à la
 * création comme à la modification. Les canaux `*:is-name-available` sont
 * interrogés avec le même nom et doivent donc répondre exactement comme
 * `create` / `update` décident.
 */
function invokeCategory<T>(channel: string, ...args: unknown[]): CategoryResult<T> {
  return invokeHandler(channel, ...args) as CategoryResult<T>
}

function invokeProduct<T>(channel: string, ...args: unknown[]): ProductResult<T> {
  return invokeHandler(channel, ...args) as ProductResult<T>
}

function expectCategoryFailure(channel: string, ...args: unknown[]): string {
  const result = invokeCategory<unknown>(channel, ...args)

  assert.equal(
    result.success,
    false,
    `${channel} must answer with an explicit business error, not a thrown error`,
  )

  return result.success ? '' : result.error
}

function expectProductFailure(channel: string, ...args: unknown[]): string {
  const result = invokeProduct<unknown>(channel, ...args)

  assert.equal(result.success, false, `${channel} must refuse the duplicate`)

  return result.success ? '' : result.error
}

/** Lit le booléen du canal, comme le formulaire le consomme. */
function categoryNameAvailable(name: string, excludeId?: number): boolean {
  const result = invokeCategory<boolean>('categories:is-name-available', name, excludeId)

  assert.equal(result.success, true)

  return result.success ? result.data : true
}

function productNameAvailable(name: string, excludeId?: number): boolean {
  const result = invokeProduct<boolean>('products:is-name-available', name, excludeId)

  assert.equal(result.success, true)

  return result.success ? result.data : true
}

describe('unicité du nom de catégorie', () => {
  let boissons: Category

  before(() => {
    registerIpcHandlers()
  })

  beforeEach(() => {
    resetTestDatabase()
    boissons = seedCategory('BOISSONS')
    seedCategory('ALIMENTATION')
  })

  after(() => {
    closeTestDatabase()
  })

  it('expose le canal attendu', () => {
    assert.ok(registeredChannels().includes('categories:is-name-available'))
  })

  it('détecte le doublon à la création, quelle que soit la casse', () => {
    assert.equal(categoryNameAvailable('BOISSONS'), false)
    assert.equal(categoryNameAvailable('boissons'), false)
    assert.equal(categoryNameAvailable('Boissons'), false)
  })

  it('ignore les espaces inutiles et les espaces multiples', () => {
    assert.equal(categoryNameAvailable('  BOISSONS  '), false)
    assert.equal(categoryNameAvailable('  boissons '), false)

    const jus = seedCategory('JUS FRUITS')

    assert.equal(jus.name, 'JUS FRUITS')
    assert.equal(categoryNameAvailable('jus    fruits'), false)
    assert.equal(categoryNameAvailable('\tJUS  FRUITS\n'), false)
  })

  it('valide un nom réellement disponible', () => {
    assert.equal(categoryNameAvailable(' snacks '), true)
    assert.equal(categoryNameAvailable('JUS  FRUITS'), true)
  })

  it('ne répond rien pour un nom vide ou trop court', () => {
    assert.equal(categoryNameAvailable(''), false)
    assert.equal(categoryNameAvailable('   '), false)
    assert.equal(categoryNameAvailable('B'), false)
  })

  it('refuse la création d\'un doublon', () => {
    assert.equal(
      expectCategoryFailure('categories:create', { name: 'boissons' }),
      CATEGORY_ERRORS.duplicate,
    )
    assert.equal(
      expectCategoryFailure('categories:create', { name: '  BOISSONS  ' }),
      CATEGORY_ERRORS.duplicate,
    )

    // Inner blanks are collapsed before the comparison, on write and on check.
    seedCategory('JUS FRUITS')

    assert.equal(
      expectCategoryFailure('categories:create', { name: 'JUS    FRUITS' }),
      CATEGORY_ERRORS.duplicate,
    )
  })

  it('conserve son propre nom en modification', () => {
    assert.equal(categoryNameAvailable('BOISSONS', boissons.id), true)
    assert.equal(categoryNameAvailable('  boissons ', boissons.id), true)

    const updated = invokeCategory<Category>('categories:update', boissons.id, {
      name: 'boissons',
    })

    assert.equal(updated.success, true)
    assert.equal(updated.success ? updated.data.name : '', 'BOISSONS')
  })

  it('refuse la modification vers le nom d\'une autre catégorie', () => {
    assert.equal(categoryNameAvailable('ALIMENTATION', boissons.id), false)

    assert.equal(
      expectCategoryFailure('categories:update', boissons.id, { name: 'alimentation' }),
      CATEGORY_ERRORS.duplicate,
    )

    const unchanged = invokeCategory<Category[]>('categories:list')

    assert.deepEqual(
      unchanged.success ? unchanged.data.map((row) => row.name) : [],
      ['ALIMENTATION', 'BOISSONS'],
    )
  })
})

describe('unicité du nom de produit', () => {
  let category: Category
  let riz: Product
  let sucre: Product

  before(() => {
    registerIpcHandlers()
  })

  beforeEach(() => {
    resetTestDatabase()
    category = seedCategory('ALIMENTATION')
    riz = seedSimpleProduct(category, 'RIZ PARFUMÉ')
    sucre = seedSimpleProduct(category, 'SUCRE 1 KG')
  })

  after(() => {
    closeTestDatabase()
  })

  it('expose le canal attendu', () => {
    assert.ok(registeredChannels().includes('products:is-name-available'))
  })

  it('détecte le doublon à la création, quelle que soit la casse', () => {
    assert.equal(productNameAvailable('RIZ PARFUMÉ'), false)
    assert.equal(productNameAvailable('riz parfumé'), false)
    assert.equal(productNameAvailable('Riz parfumé'), false)
  })

  it('ignore les espaces inutiles et les espaces multiples', () => {
    assert.equal(productNameAvailable('  RIZ PARFUMÉ  '), false)
    assert.equal(productNameAvailable(' riz parfumé'), false)
    assert.equal(productNameAvailable('RIZ  PARFUMÉ'), false)
    // SQLite compares the accented text: a name written without the accent is
    // another name, exactly like the unique index on lower(name) sees it.
    assert.equal(productNameAvailable('RIZ PARFUME'), true)
  })

  it('valide un nom réellement disponible', () => {
    assert.equal(productNameAvailable('HUILE 5 L'), true)
    assert.equal(productNameAvailable('sucre 1 kg'), false)
  })

  it('ne répond rien pour un nom vide ou trop court', () => {
    assert.equal(productNameAvailable(''), false)
    assert.equal(productNameAvailable('  '), false)
    assert.equal(productNameAvailable('R'), false)
  })

  it('refuse la création d\'un doublon', () => {
    assert.equal(
      expectProductFailure('products:create', {
        name: 'riz parfumé',
        categoryId: category.id,
        purchasePrice: 5_000,
        salePrice: 7_000,
        isTransformable: false,
        primaryForm: 'SAC',
      }),
      PRODUCT_ERRORS.duplicate,
    )

    assert.equal(
      expectProductFailure('products:create', {
        name: 'RIZ  PARFUMÉ',
        categoryId: category.id,
        purchasePrice: 5_000,
        salePrice: 7_000,
        isTransformable: false,
        primaryForm: 'SAC',
      }),
      PRODUCT_ERRORS.duplicate,
    )
  })

  it('conserve son propre nom en modification', () => {
    assert.equal(productNameAvailable('RIZ PARFUMÉ', riz.id), true)
    assert.equal(productNameAvailable('riz  parfumé', riz.id), true)

    const updated = invokeProduct<Product>('products:update', riz.id, {
      name: ' riz parfumé ',
      categoryId: category.id,
      purchasePrice: 5_000,
      salePrice: 8_000,
      isTransformable: false,
      primaryForm: 'SAC',
    })

    assert.equal(updated.success, true)
    assert.equal(updated.success ? updated.data.name : '', 'RIZ PARFUMÉ')
    assert.equal(updated.success ? updated.data.salePrice : -1, 8_000)
  })

  it('refuse la modification vers le nom d\'un autre produit', () => {
    assert.equal(productNameAvailable('SUCRE 1 KG', riz.id), false)

    assert.equal(
      expectProductFailure('products:update', riz.id, {
        name: 'sucre 1 kg',
        categoryId: category.id,
        purchasePrice: 5_000,
        salePrice: 7_000,
        isTransformable: false,
        primaryForm: 'SAC',
      }),
      PRODUCT_ERRORS.duplicate,
    )

    const listed = invokeProduct<Product[]>('products:list')

    assert.deepEqual(
      listed.success ? listed.data.map((row) => [row.id, row.name]) : [],
      [
        [riz.id, 'RIZ PARFUMÉ'],
        [sucre.id, 'SUCRE 1 KG'],
      ],
    )
  })
})

/**
 * Le canal renvoie `{ success, data }`. Le service renderer doit unwrap cet
 * objet et rendre un vrai booléen : sinon `data: false` serait toujours truthy
 * et le formulaire afficherait « disponible » pour un doublon.
 */
describe('service renderer et unwrap', () => {
  const originalWindow = (globalThis as { window?: unknown }).window

  after(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    })
  })

  function stubApi(overrides: Record<string, unknown>) {
    Object.defineProperty(globalThis, 'window', {
      value: { api: overrides },
      writable: true,
      configurable: true,
    })
  }

  it('renvoie un booléen et non l\'enveloppe IPC', async () => {
    stubApi({
      categories: {
        isNameAvailable: async () => ({ success: true, data: false }),
      },
      products: {
        isNameAvailable: async () => ({ success: true, data: true }),
      },
    })

    const taken = await categoryService.isNameAvailable('BOISSONS', 5)
    const free = await productService.isNameAvailable('RIZ PARFUMÉ', 5)

    assert.equal(typeof taken, 'boolean')
    assert.equal(taken, false)
    assert.equal(typeof free, 'boolean')
    assert.equal(free, true)
  })

  it('propage l\'erreur métier de l\'enveloppe', async () => {
    stubApi({
      categories: {
        isNameAvailable: async () => ({ success: false, error: CATEGORY_ERRORS.unexpected }),
      },
    })

    await assert.rejects(
      () => categoryService.isNameAvailable('BOISSONS'),
      new RegExp(CATEGORY_ERRORS.unexpected),
    )
  })
})

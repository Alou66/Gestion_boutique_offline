import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from '../electron/database/schema'
import {
  isRealDatabasePath,
  REAL_DB_PATH,
  generateCategories,
  generateClients,
  generateProducts,
  generateSuppliers,
  generateSupplies,
  generateInvoices,
  generateStockInitialData,
  parseArgs,
} from '../scripts/bulk-seed'

const migrationsFolder = path.join(process.cwd(), 'electron', 'database', 'migrations')

function createTempDb(): { dbPath: string; sqlite: Database.Database; db: ReturnType<typeof drizzle> } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gestion-boutique-seed-test-'))
  const dbPath = path.join(tmpDir, 'test-seed.db')
  const sqlite = new Database(dbPath)
  sqlite.pragma('foreign_keys = ON')
  sqlite.function('unaccent', { deterministic: true }, (value: string) => {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  })

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })

  return { dbPath, sqlite, db }
}

function cleanupDb(dbPath: string, sqlite: Database.Database): void {
  sqlite.close()
  const dir = path.dirname(dbPath)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function setTestEnv(dbPath: string): void {
  process.env.GESTION_BOUTIQUE_TEST_USER_DATA = path.dirname(dbPath)
}

describe('bulk-seed safety', () => {
  describe('isRealDatabasePath', () => {
    it('detects the real database path', () => {
      assert.equal(isRealDatabasePath(REAL_DB_PATH), true)
    })

    it('rejects paths that differ', () => {
      assert.equal(isRealDatabasePath('/tmp/some-other.db'), false)
      assert.equal(isRealDatabasePath(path.join(os.homedir(), '.config', 'gestion-boutique', 'other.sqlite')), false)
    })
  })
})

describe('bulk-seed data generators', () => {
  it('generates unique categories', () => {
    const categories = generateCategories(20)

    assert.equal(categories.length, 20)
    const names = categories.map((c) => c.name)
    const unique = new Set(names)
    assert.equal(unique.size, names.length, 'category names should be unique')
  })

  it('generates unique suppliers', () => {
    const suppliers = generateSuppliers(20)

    assert.equal(suppliers.length, 20)
    const phones = suppliers.map((s) => s.phone)
    const uniquePhones = new Set(phones)
    assert.equal(uniquePhones.size, phones.length, 'supplier phones should be unique')
  })

  it('generates unique clients', () => {
    const clients = generateClients(20)

    assert.equal(clients.length, 20)
    const phones = clients.map((c) => c.phone)
    const uniquePhones = new Set(phones)
    assert.equal(uniquePhones.size, phones.length, 'client phones should be unique')
  })

  it('generates products with valid structure', () => {
    const categories = generateCategories(5)
    const mockCategoryIds = categories.map((_, i) => i + 1)
    const products = generateProducts(mockCategoryIds, 10)

    assert.equal(products.length, 10)
    for (const product of products) {
      assert.ok(product.categoryId >= 1 && product.categoryId <= 5)
      assert.ok(product.purchasePrice >= 0)
      assert.ok(product.salePrice >= 0)
      assert.ok(product.salePrice >= product.purchasePrice || product.salePrice >= 0)

      if (product.isTransformable) {
        assert.ok(product.primaryForm !== null, 'transformable product must have primaryForm')
        assert.ok(product.secondaryForm !== null, 'transformable product must have secondaryForm')
        assert.ok(product.conversionQuantity !== null, 'transformable product must have conversionQuantity')
        assert.ok(product.secondarySalePrice !== null, 'transformable product must have secondarySalePrice')
      } else {
        assert.ok(product.primaryForm !== null, 'simple product must have primaryForm')
        assert.equal(product.secondaryForm, null)
        assert.equal(product.conversionQuantity, null)
        assert.equal(product.secondarySalePrice, null)
      }
    }
  })

  it('generates stock data for valid products', () => {
    const mockCategoryIds = [1, 2]
    const products = generateProducts(mockCategoryIds, 10)
    const transformableMap = new Map<number, { primaryForm: string; secondaryForm: string }>()

    let productId = 1
    for (const product of products) {
      if (product.isTransformable && product.primaryForm && product.secondaryForm) {
        transformableMap.set(productId, {
          primaryForm: product.primaryForm,
          secondaryForm: product.secondaryForm,
        })
      }
      productId++
    }

    const productIds = products.map((_, i) => i + 1)
    const stockData = generateStockInitialData(productIds, transformableMap, 5)

    assert.ok(stockData.length > 0)

    for (const stock of stockData) {
      assert.ok(stock.quantity > 0, 'stock quantity must be positive')
      assert.ok(productIds.includes(stock.productId))
    }
  })

  it('generates supplies for valid entities', () => {
    const mockCategoryIds = [1, 2, 3]
    const products = generateProducts(mockCategoryIds, 10)
    const supplierIds = [10, 11, 12, 13, 14]
    const productIds = products.map((_, i) => i + 1)
    const productFormMap = new Map<number, { primaryForm: string; secondaryForm: string | null }>()

    let productId = 1
    for (const product of products) {
      productFormMap.set(productId, {
        primaryForm: product.primaryForm ?? '',
        secondaryForm: product.secondaryForm,
      })
      productId++
    }

    const supplies = generateSupplies(supplierIds, productIds, productFormMap, 10)

    assert.equal(supplies.length, 10)

    for (const supply of supplies) {
      assert.ok(supplierIds.includes(supply.supplierId))
      assert.ok(supply.items.length > 0)

      for (const item of supply.items) {
        assert.ok(productIds.includes(item.productId))
        assert.ok(item.quantity > 0)
        assert.ok(item.purchaseUnitPrice >= 0)
      }
    }
  })

  it('generates invoices for valid entities', () => {
    const mockCategoryIds = [1, 2]
    const products = generateProducts(mockCategoryIds, 10)
    const productFormMap = new Map<number, { primaryForm: string; secondaryForm: string | null }>()

    let productId = 1
    for (const product of products) {
      productFormMap.set(productId, {
        primaryForm: product.primaryForm ?? '',
        secondaryForm: product.secondaryForm,
      })
      productId++
    }

    const clientIds = [1, 2, 3]
    const productIds = products.map((_, i) => i + 1)
    const invoices = generateInvoices(clientIds, productIds, productFormMap, 10)

    assert.equal(invoices.length, 10)

    for (const invoice of invoices) {
      assert.ok(clientIds.includes(invoice.clientId))
      assert.ok(invoice.items.length > 0)

      for (const item of invoice.items) {
        assert.ok(productIds.includes(item.productId))
        assert.ok(item.quantity > 0)
        assert.ok(item.unitPrice >= 0)
      }
    }
  })
})

describe('bulk-seed integration', () => {
  let tmpDb: { dbPath: string; sqlite: Database.Database; db: ReturnType<typeof drizzle> }

  before(() => {
    tmpDb = createTempDb()
    setTestEnv(tmpDb.dbPath)
  })

  after(() => {
    cleanupDb(tmpDb.dbPath, tmpDb.sqlite)
  })

  it('seeds categories into a temporary database', async () => {
    const { db } = tmpDb

    const categories = generateCategories(5)

    for (const cat of categories) {
      try {
        db.insert(schema.categories).values({
          name: cat.name,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).run()
      } catch {
        // ignore duplicates from previous runs
      }
    }

    const count = db.select({ count: sql`count(*)` }).from(schema.categories).get() as { count: number }
    assert.ok(count.count >= 5, `Expected at least 5 categories, got ${count.count}`)
  })

  it('seeds suppliers into a temporary database', async () => {
    const { db } = tmpDb

    const suppliers = generateSuppliers(5)

    for (const supplier of suppliers) {
      try {
        db.insert(schema.suppliers).values({
          name: supplier.name.toUpperCase(),
          phone: supplier.phone,
          address: supplier.address,
          isActive: true,
          isSystem: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).run()
      } catch {
        // ignore duplicates
      }
    }

    const count = db.select({ count: sql`count(*)` }).from(schema.suppliers).get() as { count: number }
    assert.ok(count.count >= 5, `Expected at least 5 suppliers, got ${count.count}`)
  })

  it('seeds clients into a temporary database', async () => {
    const { db } = tmpDb

    const clients = generateClients(5)

    for (const client of clients) {
      try {
        db.insert(schema.clients).values({
          name: client.name.toUpperCase(),
          phone: client.phone,
          address: client.address,
          isActive: true,
          isSystem: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).run()
      } catch {
        // ignore duplicates
      }
    }

    const count = db.select({ count: sql`count(*)` }).from(schema.clients).get() as { count: number }
    assert.ok(count.count >= 5, `Expected at least 5 clients, got ${count.count}`)
  })

  it('seeds products and stock into a temporary database', async () => {
    const { db } = tmpDb

    const categoryIds = db.select({ id: schema.categories.id }).from(schema.categories).all().map((r) => r.id)
    assert.ok(categoryIds.length > 0, 'Categories must exist before products')

    const products = generateProducts(categoryIds, 5)
    const transformableMap = new Map<number, { primaryForm: string; secondaryForm: string }>()

    for (const product of products) {
      try {
        const inserted = db.insert(schema.products).values({
          name: product.name.toUpperCase(),
          categoryId: product.categoryId,
          purchasePrice: product.purchasePrice,
          salePrice: product.salePrice,
          isTransformable: product.isTransformable,
          primaryForm: product.primaryForm,
          secondaryForm: product.secondaryForm,
          conversionQuantity: product.conversionQuantity,
          secondarySalePrice: product.secondarySalePrice,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning({ id: schema.products.id }).get()

        if (product.isTransformable && product.primaryForm && product.secondaryForm) {
          transformableMap.set(inserted.id, {
            primaryForm: product.primaryForm,
            secondaryForm: product.secondaryForm,
          })
        }
      } catch {
        // ignore duplicates
      }
    }

    const productIds = db.select({ id: schema.products.id }).from(schema.products).all().map((r) => r.id)
    assert.ok(productIds.length > 0, 'Products must exist')

    const stockData = generateStockInitialData(productIds, transformableMap, 5)
    const initializedProducts = new Set<number>()

    for (const stock of stockData) {
      if (initializedProducts.has(stock.productId)) continue

      const existing = db.select({ id: schema.stockMovements.id })
        .from(schema.stockMovements)
        .where(sql`${schema.stockMovements.productId} = ${stock.productId} AND ${schema.stockMovements.movementType} = 'STOCK_INITIAL'`)
        .get()

      if (existing) {
        initializedProducts.add(stock.productId)
        continue
      }

      const forms = transformableMap.has(stock.productId)
        ? [transformableMap.get(stock.productId)!.primaryForm, transformableMap.get(stock.productId)!.secondaryForm]
        : ['SAC']

      for (const form of forms) {
        db.insert(schema.stockMovements).values({
          productId: stock.productId,
          form,
          movementType: 'STOCK_INITIAL',
          direction: 'IN',
          quantity: randomInt(10, 200),
          reason: null,
          createdAt: new Date(),
        }).run()
      }

      initializedProducts.add(stock.productId)
    }

    const stockCountResult = db.select({ count: sql`count(*)` }).from(schema.stockMovements).get() as { count: number }
    assert.ok(stockCountResult.count > 0, 'Should have stock movements')

    const productsCount = db.select({ count: sql`count(*)` }).from(schema.products).get() as { count: number }
    assert.ok(productsCount.count >= 5, `Expected at least 5 products, got ${productsCount.count}`)
  })
})

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

describe('bulk-seed argument parsing', () => {
  it('parses default arguments', () => {
    const args = parseArgs(['node', 'bulk-seed.mjs'])
    assert.equal(args.count, 50)
    assert.equal(args.dryRun, false)
  })

  it('parses --count option', () => {
    const args = parseArgs(['node', 'bulk-seed.mjs', '--count', '100'])
    assert.equal(args.count, 100)
  })

  it('parses --dry-run option', () => {
    const args = parseArgs(['node', 'bulk-seed.mjs', '--dry-run'])
    assert.equal(args.dryRun, true)
  })

  it('parses --db option', () => {
    const args = parseArgs(['node', 'bulk-seed.mjs', '--db', '/tmp/test.db'])
    assert.equal(args.db, '/tmp/test.db')
  })
})

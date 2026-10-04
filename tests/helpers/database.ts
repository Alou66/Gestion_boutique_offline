import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { closeDatabase, getDb, initializeDatabase } from '../../electron/database/client'
import { createCategory } from '../../electron/services/categoryService'
import { createProduct, setProductActive } from '../../electron/services/productService'
import type { Category, Product, ProductInput } from '../../electron/types'

/**
 * The tests exercise the real main process services against a real SQLite file,
 * migrated with the real migrations folder: no service is mocked, only the
 * Electron `app.getPath('userData')` target is redirected to a temp folder.
 */
const migrationsFolder = path.join(process.cwd(), 'electron', 'database', 'migrations')

let userDataDir: string | null = null

export function openTestDatabase(): void {
  userDataDir = mkdtempSync(path.join(os.tmpdir(), 'gestion-boutique-test-'))
  process.env.GESTION_BOUTIQUE_TEST_USER_DATA = userDataDir

  migrate(initializeDatabase(), { migrationsFolder })
}

/** Fresh database for each test: no state leaks from one case to the next. */
export function resetTestDatabase(): void {
  closeDatabase()
  removeUserDataDir()
  openTestDatabase()
}

/** Closes and reopens the connection on the same file: persistence check. */
export function reopenTestDatabase(): void {
  closeDatabase()
  initializeDatabase()
}

export function closeTestDatabase(): void {
  closeDatabase()
  removeUserDataDir()
}

function removeUserDataDir(): void {
  if (userDataDir) {
    rmSync(userDataDir, { recursive: true, force: true })
    userDataDir = null
  }
}

/** Raw SQL escape hatch, used to inject a failure inside a transaction. */
export function execSql(statement: string): void {
  getDb().$client.exec(statement)
}

export function seedCategory(name = 'BOISSONS'): Category {
  return createCategory({ name })
}

export function seedSimpleProduct(
  category: Category,
  name = 'SUCRE 1 KG',
  overrides: Partial<ProductInput> = {},
): Product {
  return createProduct({
    name,
    categoryId: category.id,
    purchasePrice: 5_000,
    salePrice: 7_000,
    isTransformable: false,
    primaryForm: 'SAC',
    ...overrides,
  })
}

export function seedTransformableProduct(
  category: Category,
  name = 'CHOCOPAIN 5 KG',
  overrides: Partial<ProductInput> = {},
): Product {
  return createProduct({
    name,
    categoryId: category.id,
    purchasePrice: 12_000,
    salePrice: 15_000,
    isTransformable: true,
    primaryForm: 'CARTON',
    secondaryForm: 'SEAU',
    conversionQuantity: 4,
    secondarySalePrice: 4_000,
    ...overrides,
  })
}

export { setProductActive }
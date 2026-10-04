import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

/**
 * Upgrade path check: the 0003 migration must be applied on a database that
 * already contains categories and products (including simple products stored
 * before a single logical form was required), without recreating or dropping any
 * existing table.
 */
const sourceMigrations = path.join(process.cwd(), 'electron', 'database', 'migrations')

type Journal = {
  entries: { idx: number; tag: string }[]
}

describe('migration 0003', () => {
  let workDir: string
  let databasePath: string
  let oldMigrationsFolder: string

  before(() => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'gestion-boutique-migration-'))
    databasePath = path.join(workDir, 'database.sqlite')
    oldMigrationsFolder = path.join(workDir, 'migrations-old')

    // Snapshot of the project before the stock migration.
    cpSync(sourceMigrations, oldMigrationsFolder, { recursive: true })
    const journalPath = path.join(oldMigrationsFolder, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal
    journal.entries = journal.entries.filter((entry) => entry.idx < 3)
    writeFileSync(journalPath, JSON.stringify(journal, null, 2))
  })

  after(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('applique un ajout non destructif sur une base existante', () => {
    const sqlite = new Database(databasePath)
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite)

    migrate(db, { migrationsFolder: oldMigrationsFolder })

    sqlite
      .prepare(
        "insert into categories (name, created_at, updated_at) values ('BOISSONS', 0, 0)",
      )
      .run()
    sqlite
      .prepare(
        `insert into products (name, category_id, purchase_price, sale_price, is_transformable, primary_form, is_active, created_at, updated_at)
         values ('SUCRE 1 KG', 1, 5000, 7000, 0, null, 1, 0, 0)`,
      )
      .run()
    sqlite
      .prepare(
        `insert into products (name, category_id, purchase_price, sale_price, is_transformable, primary_form, secondary_form, conversion_quantity, secondary_sale_price, is_active, created_at, updated_at)
         values ('CHOCOPAIN 5 KG', 1, 12000, 15000, 1, 'CARTON', 'SEAU', 4, 4000, 1, 0, 0)`,
      )
      .run()

    // Upgrading to the stock migration.
    migrate(db, { migrationsFolder: sourceMigrations })

    const tables = sqlite
      .prepare("select name from sqlite_master where type='table' order by name")
      .all() as { name: string }[]
    const tableNames = tables.map((row) => row.name)

    assert.ok(tableNames.includes('categories'))
    assert.ok(tableNames.includes('products'))
    assert.ok(tableNames.includes('stock_movements'))

    // No data lost, no table rebuilt.
    assert.equal(
      (sqlite.prepare('select count(*) as count from categories').get() as { count: number })
        .count,
      1,
    )
    assert.equal(
      (sqlite.prepare('select count(*) as count from products').get() as { count: number })
        .count,
      2,
    )

    // The simple product of the legacy data gets a neutral form instead of an
    // invalid NULL one, and the transformable product is untouched.
    const products = sqlite
      .prepare('select name, primary_form, secondary_form from products order by id')
      .all() as { name: string; primary_form: string | null; secondary_form: string | null }[]

    assert.deepEqual(products, [
      { name: 'SUCRE 1 KG', primary_form: 'UNITE', secondary_form: null },
      { name: 'CHOCOPAIN 5 KG', primary_form: 'CARTON', secondary_form: 'SEAU' },
    ])

    // The migration is idempotent: running it again changes nothing.
    migrate(db, { migrationsFolder: sourceMigrations })
    assert.equal(
      (sqlite.prepare('select count(*) as count from stock_movements').get() as {
        count: number
      }).count,
      0,
    )

    sqlite.close()
  })
})
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

/**
 * Snapshots the migration folder and keeps only the entries below `lastIdx`, so
 * a database can be built with an older schema and then upgraded.
 */
function snapshotUpTo(workDir: string, lastIdx: number): string {
  const folder = path.join(workDir, `migrations-0${lastIdx}`)
  const journalPath = path.join(folder, 'meta', '_journal.json')

  cpSync(sourceMigrations, folder, { recursive: true })

  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal

  journal.entries = journal.entries.filter((entry) => entry.idx < lastIdx)
  writeFileSync(journalPath, JSON.stringify(journal, null, 2))

  return folder
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
/**
 * Upgrade path check: the 0004 migration must be applied on a database that
 * already carries a stock history, keeping every movement and every constraint,
 * and opening movement_type to APPROVISIONNEMENT.
 */
describe('migration 0004', () => {
  let workDir: string
  let databasePath: string
  let stockMigrationsFolder: string

  before(() => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'gestion-boutique-migration-'))
    databasePath = path.join(workDir, 'database.sqlite')
    // Everything up to (and including) the stock migration, nothing after.
    stockMigrationsFolder = snapshotUpTo(workDir, 4)
  })

  after(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('ajoute les approvisionnements sans perdre l\'historique du stock', () => {
    const sqlite = new Database(databasePath)
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite)

    migrate(db, { migrationsFolder: stockMigrationsFolder })

    sqlite
      .prepare(
        "insert into categories (name, created_at, updated_at) values ('BOISSONS', 0, 0)",
      )
      .run()
    sqlite
      .prepare(
        `insert into products (name, category_id, purchase_price, sale_price, is_transformable, primary_form, secondary_form, conversion_quantity, secondary_sale_price, is_active, created_at, updated_at)
         values ('CHOCOPAIN 5 KG', 1, 12000, 15000, 1, 'CARTON', 'SEAU', 4, 4000, 1, 0, 0)`,
      )
      .run()
    sqlite
      .prepare(
        `insert into stock_movements (id, product_id, form, movement_type, direction, quantity, reason, created_at)
         values (1, 1, 'CARTON', 'STOCK_INITIAL', 'IN', 10, null, 0)`,
      )
      .run()
    sqlite
      .prepare(
        `insert into stock_movements (id, product_id, form, movement_type, direction, quantity, reason, created_at)
         values (2, 1, 'CARTON', 'AJUSTEMENT', 'OUT', 1, 'Produit endommagé', 0)`,
      )
      .run()

    // Upgrading to the supply migration.
    migrate(db, { migrationsFolder: sourceMigrations })

    const tables = sqlite
      .prepare("select name from sqlite_master where type='table' order by name")
      .all() as { name: string }[]
    const tableNames = tables.map((row) => row.name)

    assert.ok(tableNames.includes('stock_movements'))
    assert.ok(tableNames.includes('supplies'))
    assert.ok(tableNames.includes('supply_items'))

    // The stock history is copied as it was, ids included.
    const movements = sqlite
      .prepare(
        'select id, product_id, form, movement_type, direction, quantity, reason from stock_movements order by id',
      )
      .all()

    assert.deepEqual(movements, [
      {
        id: 1,
        product_id: 1,
        form: 'CARTON',
        movement_type: 'STOCK_INITIAL',
        direction: 'IN',
        quantity: 10,
        reason: null,
      },
      {
        id: 2,
        product_id: 1,
        form: 'CARTON',
        movement_type: 'AJUSTEMENT',
        direction: 'OUT',
        quantity: 1,
        reason: 'Produit endommagé',
      },
    ])

    // APPROVISIONNEMENT is now accepted, always as an entry.
    sqlite
      .prepare(
        `insert into stock_movements (product_id, form, movement_type, direction, quantity, created_at)
         values (1, 'CARTON', 'APPROVISIONNEMENT', 'IN', 5, 0)`,
      )
      .run()

    assert.throws(() =>
      sqlite
        .prepare(
          `insert into stock_movements (product_id, form, movement_type, direction, quantity, created_at)
           values (1, 'CARTON', 'APPROVISIONNEMENT', 'OUT', 5, 0)`,
        )
        .run(),
    )

    // A type that does not exist yet is still refused, and the single
    // initialization per form is still enforced.
    assert.throws(() =>
      sqlite
        .prepare(
          `insert into stock_movements (product_id, form, movement_type, direction, quantity, created_at)
           values (1, 'CARTON', 'VENTE', 'OUT', 1, 0)`,
        )
        .run(),
    )

    assert.throws(() =>
      sqlite
        .prepare(
          `insert into stock_movements (product_id, form, movement_type, direction, quantity, created_at)
           values (1, 'CARTON', 'STOCK_INITIAL', 'IN', 7, 0)`,
        )
        .run(),
    )

    // The new tables carry their own constraints.
    sqlite
      .prepare(
        `insert into supplies (reference, supplier_name, date, total_amount, created_at)
         values ('APP-000001', 'Grossiste Sokna', 0, 0, 0)`,
      )
      .run()

    assert.throws(() =>
      sqlite
        .prepare(
          `insert into supplies (reference, supplier_name, date, total_amount, created_at)
           values ('APP-000001', null, 0, 0, 0)`,
        )
        .run(),
    )

    sqlite
      .prepare(
        `insert into supply_items (supply_id, product_id, form, quantity, purchase_unit_price, line_total)
         values (1, 1, 'CARTON', 10, 10000, 100000)`,
      )
      .run()

    assert.throws(() =>
      sqlite
        .prepare(
          `insert into supply_items (supply_id, product_id, form, quantity, purchase_unit_price, line_total)
           values (1, 1, 'CARTON', 5, 10000, 50000)`,
        )
        .run(),
    )

    assert.throws(() =>
      sqlite
        .prepare(
          `insert into supply_items (supply_id, product_id, form, quantity, purchase_unit_price, line_total)
           values (1, 1, 'SEAU', 0, 10000, 0)`,
        )
        .run(),
    )

    assert.throws(() =>
      sqlite
        .prepare(
          `insert into supply_items (supply_id, product_id, form, quantity, purchase_unit_price, line_total)
           values (1, 1, 'SEAU', 5, -1, -5)`,
        )
        .run(),
    )

    // The migration is idempotent: running it again changes nothing.
    migrate(db, { migrationsFolder: sourceMigrations })

    assert.equal(
      (sqlite.prepare('select count(*) as count from stock_movements').get() as {
        count: number
      }).count,
      3,
    )
    assert.equal(
      (sqlite.prepare('select count(*) as count from supply_items').get() as {
        count: number
      }).count,
      1,
    )

    sqlite.close()
  })
})
/**
 * Upgrade path check: the 0005 migration must be applied on a database that
 * already carries supplies and a stock history, keeping every movement, opening
 * movement_type to TRANSFORMATION and creating the transformations table.
 */
describe('migration 0005', () => {
  let workDir: string
  let databasePath: string
  let supplyMigrationsFolder: string

  before(() => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'gestion-boutique-migration-'))
    databasePath = path.join(workDir, 'database.sqlite')
    // Everything up to (and including) the supply migration, nothing after.
    supplyMigrationsFolder = snapshotUpTo(workDir, 5)
  })

  after(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('ajoute les transformations sans perdre l\'historique du stock', () => {
    const sqlite = new Database(databasePath)
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite)

    migrate(db, { migrationsFolder: supplyMigrationsFolder })

    sqlite
      .prepare(
        "insert into categories (name, created_at, updated_at) values ('BOISSONS', 0, 0)",
      )
      .run()
    sqlite
      .prepare(
        `insert into products (name, category_id, purchase_price, sale_price, is_transformable, primary_form, secondary_form, conversion_quantity, secondary_sale_price, is_active, created_at, updated_at)
         values ('CHOCOPAIN 5 KG', 1, 12000, 15000, 1, 'CARTON', 'SEAU', 4, 4000, 1, 0, 0)`,
      )
      .run()
    sqlite
      .prepare(
        `insert into stock_movements (id, product_id, form, movement_type, direction, quantity, reason, created_at)
         values (1, 1, 'CARTON', 'STOCK_INITIAL', 'IN', 10, null, 0)`,
      )
      .run()
    sqlite
      .prepare(
        `insert into stock_movements (id, product_id, form, movement_type, direction, quantity, reason, created_at)
         values (2, 1, 'SEAU', 'APPROVISIONNEMENT', 'IN', 3, null, 0)`,
      )
      .run()
    sqlite
      .prepare(
        `insert into supplies (reference, supplier_name, date, total_amount, created_at)
         values ('APP-000001', 'Grossiste Sokna', 0, 25000, 0)`,
      )
      .run()

    // Upgrading to the transformation migration.
    migrate(db, { migrationsFolder: sourceMigrations })

    const tables = sqlite
      .prepare("select name from sqlite_master where type='table' order by name")
      .all() as { name: string }[]
    const tableNames = tables.map((row) => row.name)

    assert.ok(tableNames.includes('stock_movements'))
    assert.ok(tableNames.includes('supplies'))
    assert.ok(tableNames.includes('transformations'))

    // The stock and supply history is copied as it was, ids included.
    assert.deepEqual(
      sqlite
        .prepare(
          'select id, product_id, form, movement_type, direction, quantity, reason from stock_movements order by id',
        )
        .all(),
      [
        {
          id: 1,
          product_id: 1,
          form: 'CARTON',
          movement_type: 'STOCK_INITIAL',
          direction: 'IN',
          quantity: 10,
          reason: null,
        },
        {
          id: 2,
          product_id: 1,
          form: 'SEAU',
          movement_type: 'APPROVISIONNEMENT',
          direction: 'IN',
          quantity: 3,
          reason: null,
        },
      ],
    )

    assert.equal(
      (sqlite.prepare('select count(*) as count from supplies').get() as { count: number })
        .count,
      1,
    )

    // TRANSFORMATION is now accepted in both directions.
    sqlite
      .prepare(
        `insert into stock_movements (product_id, form, movement_type, direction, quantity, created_at)
         values (1, 'CARTON', 'TRANSFORMATION', 'OUT', 2, 0)`,
      )
      .run()
    sqlite
      .prepare(
        `insert into stock_movements (product_id, form, movement_type, direction, quantity, created_at)
         values (1, 'SEAU', 'TRANSFORMATION', 'IN', 8, 0)`,
      )
      .run()

    // A transformation never carries a reason.
    assert.throws(() =>
      sqlite
        .prepare(
          `insert into stock_movements (product_id, form, movement_type, direction, quantity, reason, created_at)
           values (1, 'CARTON', 'TRANSFORMATION', 'OUT', 1, 'Conversion manuelle', 0)`,
        )
        .run(),
    )

    // A type that does not exist yet is still refused, and the previous
    // constraints still hold.
    assert.throws(() =>
      sqlite
        .prepare(
          `insert into stock_movements (product_id, form, movement_type, direction, quantity, created_at)
           values (1, 'CARTON', 'VENTE', 'OUT', 1, 0)`,
        )
        .run(),
    )

    assert.throws(() =>
      sqlite
        .prepare(
          `insert into stock_movements (product_id, form, movement_type, direction, quantity, created_at)
           values (1, 'CARTON', 'APPROVISIONNEMENT', 'OUT', 1, 0)`,
        )
        .run(),
    )

    assert.throws(() =>
      sqlite
        .prepare(
          `insert into stock_movements (product_id, form, movement_type, direction, quantity, created_at)
           values (1, 'CARTON', 'STOCK_INITIAL', 'IN', 7, 0)`,
        )
        .run(),
    )

    assert.throws(() =>
      sqlite
        .prepare(
          `insert into stock_movements (product_id, form, movement_type, direction, quantity, created_at)
           values (1, 'CARTON', 'TRANSFORMATION', 'OUT', 0, 0)`,
        )
        .run(),
    )

    // The transformations table carries its own constraints.
    sqlite
      .prepare(
        `insert into transformations (reference, product_id, source_form, source_quantity, destination_form, destination_quantity, date, created_at)
         values ('TRF-000001', 1, 'CARTON', 2, 'SEAU', 8, 0, 0)`,
      )
      .run()

    assert.throws(() =>
      sqlite
        .prepare(
          `insert into transformations (reference, product_id, source_form, source_quantity, destination_form, destination_quantity, date, created_at)
           values ('TRF-000001', 1, 'CARTON', 3, 'SEAU', 12, 0, 0)`,
        )
        .run(),
    )

    assert.throws(() =>
      sqlite
        .prepare(
          `insert into transformations (reference, product_id, source_form, source_quantity, destination_form, destination_quantity, date, created_at)
           values ('TRF-000002', 1, 'CARTON', 0, 'SEAU', 0, 0, 0)`,
        )
        .run(),
    )

    assert.throws(() =>
      sqlite
        .prepare(
          `insert into transformations (reference, product_id, source_form, source_quantity, destination_form, destination_quantity, date, created_at)
           values ('TRF-000003', 1, 'CARTON', 1, 'CARTON', 1, 0, 0)`,
        )
        .run(),
    )

    assert.throws(() =>
      sqlite
        .prepare(
          `insert into transformations (reference, product_id, source_form, source_quantity, destination_form, destination_quantity, date, created_at)
           values ('TRF-000004', 4242, 'CARTON', 1, 'SEAU', 4, 0, 0)`,
        )
        .run(),
    )

    // The migration is idempotent: running it again changes nothing.
    migrate(db, { migrationsFolder: sourceMigrations })

    assert.equal(
      (sqlite.prepare('select count(*) as count from stock_movements').get() as {
        count: number
      }).count,
      4,
    )
    assert.equal(
      (sqlite.prepare('select count(*) as count from transformations').get() as {
        count: number
      }).count,
      1,
    )

    sqlite.close()
  })
})

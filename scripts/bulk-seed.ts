#!/usr/bin/env node
import { argv, exit, cwd } from 'node:process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sql, desc } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from '../electron/database/schema'

const REAL_DB_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || os.homedir(),
  '.config',
  'gestion-boutique',
  'database.sqlite',
)

function isRealDatabasePath(dbPath: string): boolean {
  const resolved = path.resolve(dbPath)
  const realResolved = path.resolve(REAL_DB_PATH)
  return resolved === realResolved
}

interface ParsedArgs {
  count: number
  dryRun: boolean
  db?: string
  help?: boolean
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    count: 50,
    dryRun: false,
  }

  for (let i = 2; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--dry-run' || arg === '-d') {
      result.dryRun = true
    } else if (arg === '--db') {
      result.db = args[i + 1] ?? ''
      i++
    } else if (arg === '--count' || arg === '-n') {
      result.count = Number(args[i + 1]) ?? 50
      i++
    } else if (arg === '--help' || arg === '-h') {
      result.help = true
    }
  }

  return result
}

function printHelp(): void {
  console.log(`
Gestion Boutique - Générateur de données de charge

Usage: node scripts/bulk-seed.mjs [options]

Options:
  --db <path>       Path to SQLite database file (required for real generation)
  --count <number>  Number of synthetic records to generate per entity (default: 50)
  --dry-run, -d     Validate configuration and show what would be done without writing
  --help, -h        Show this help message

Security:
  - The script will NEVER write to: ${REAL_DB_PATH}
  - The --db option is mandatory unless --dry-run is used
  - All generated data goes to the specified database path only

Examples:
  node scripts/bulk-seed.mjs --dry-run
  node scripts/bulk-seed.mjs --db /tmp/test-seed.db --count 100
`)
}

const CATEGORIES = [
  'BOISSONS',
  'EPICERIE',
  'NETTOYAGE',
  'PARFUMERIE',
  'BOULETTERIE',
  'BACERIE',
  'LEGUMES',
  'FRUITS',
  'CEREALES',
  'CONDIMENTS',
]

const FIRST_NAMES = [
  'AMADOU', 'BASSIRATOU', 'CHEIKH', 'DAVID', 'ELIF', 'FATOU', 'GUILLAUME',
  'HAFSA', 'IBRAHIMA', 'JACQUES', 'KADDOUM', 'LAMINE', 'MARIAM', 'NAVDEEP',
  'OMAR', 'PASCAL', 'RASOOL', 'SALMA', 'TOBIAS', 'UBERTO', 'VANDA', 'WILLY',
  'YASMINE', 'ZARA',
]

const LAST_NAMES = [
  'DIOP', 'SEYE', 'NDIAYE', 'DIAWARA', 'BARRY', 'CAMARA', 'DANSOKO',
  'MARTIN', 'DUPONT', 'BERNARD', 'THOMAS', 'RICHARD', 'PETIT', 'ROBERT',
  'MOREAU', 'LEFEBVRE', 'NGUYEN', 'GARCIA', 'KOVALCHUK', 'SILVA', 'SANTOS',
]

const PRODUCT_NAMES = [
  'RIZ GRAS 5 KG',
  'SUCRE 1 KG',
  'HUILE PALMIER 1L',
  'CHOCOPAIN 5 KG',
  'PAIN DE MIE 500G',
  'CAFÉ EN GRAINS 250G',
  'THÉ GLACÉ 20 BAGS',
  'LIQUIDE LAIT CONDENSÉ 395G',
  'EAU MINÉRALE 1.5L',
  'BIÈRE LOCALE 33CL',
  'VIN ROUGE 75CL',
  'WHISKY 75CL',
  'VINAIGRE 50CL',
  'SEL FIN 1KG',
  'POIVRE NOIR MOULU 50G',
  'PÂTE À TATINER 350G',
  'MARMELADE 300G',
  'CONFITURE 350G',
  'FROMAGE 500G',
  'BEURRE 250G',
  'HUILE D ARACHIDE 1L',
  'FARINE DE MAÏS 1KG',
  'SPAGHETTI 500G',
  'RIZ BASMATI 2KG',
  'COUSDUS 1KG',
]

const STREET_NAMES = [
  'RUE DE LA PAIX',
  'AVENUE DES ALGORITHMES',
  'BOULEVARD NUMÉRIQUE',
  'RUE DU CODE',
  'AVENUE DE LA BOUTIQUE',
  'RUE DES DEVELOPEURS',
  'BOULEVARD TECHNOLOGIQUE',
  'RUE DE LINNOVATION',
]

const CITIES = [
  'DAKAR',
  'SAINT-LOUIS',
  'THIES',
  'PIKINE',
  'GUEIDIAYA',
  'RUFISQUE',
  'SALY',
  'DIEGOU',
]

const TRANSFORMABLE_PRODUCTS = [
  { name: 'CHOCOPAIN 5 KG', primaryForm: 'CARTON', secondaryForm: 'SEAU', conversionQuantity: 4, secondarySalePrice: 4000 },
  { name: 'CABLE 100M', primaryForm: 'ROULEAU', secondaryForm: 'METRE', conversionQuantity: 100, secondarySalePrice: 300 },
  { name: 'TABLE 2M', primaryForm: 'UNITE', secondaryForm: 'PIED', conversionQuantity: 4, secondarySalePrice: 150000 },
  { name: 'PAIN DE MIE 500G', primaryForm: 'PAQUET', secondaryForm: 'TRANCHE', conversionQuantity: 10, secondarySalePrice: 300 },
]

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomDate(start: Date, end: Date): Date {
  const startTime = start.getTime()
  const endTime = end.getTime()
  return new Date(startTime + Math.random() * (endTime - startTime))
}

function formatPhone(): string {
  const prefix = randomElement(['+221', ''])
  const num = `${randomInt(20, 99)}${randomInt(0, 9)}${randomInt(0, 9)}${randomInt(0, 9)}${randomInt(0, 9)}${randomInt(0, 9)}${randomInt(0, 9)}`
  return prefix + num
}

function formatAddress(): string {
  return `${randomInt(1, 999)} ${randomElement(STREET_NAMES)}, ${randomElement(CITIES)}`
}

function formatName(): string {
  return `${randomElement(FIRST_NAMES)} ${randomElement(LAST_NAMES)}`
}

function formatProductName(): string {
  return randomElement(PRODUCT_NAMES)
}

const migrationsFolder = path.join(cwd(), 'electron', 'database', 'migrations')

function validateMigrationsFolder(): void {
  if (!fs.existsSync(migrationsFolder)) {
    console.error(`[ERROR] Migrations folder not found: ${migrationsFolder}`)
    exit(1)
  }

  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json')
  if (!fs.existsSync(journalPath)) {
    console.error(`[ERROR] Migration journal not found: ${journalPath}`)
    exit(1)
  }
}

interface CategoryData {
  name: string
}

interface SupplierData {
  name: string
  phone: string
  address: string | null
}

interface ClientData {
  name: string
  phone: string
  address: string | null
}

interface ProductData {
  name: string
  categoryId: number
  purchasePrice: number
  salePrice: number
  isTransformable: boolean
  primaryForm: string | null
  secondaryForm: string | null
  conversionQuantity: number | null
  secondarySalePrice: number | null
}

interface StockInitialData {
  productId: number
  form: string
  quantity: number
}

interface SupplyData {
  supplierId: number
  date: string
  items: Array<{ productId: number; form: string; quantity: number; purchaseUnitPrice: number }>
}

interface InvoiceData {
  clientId: number
  date: string
  items: Array<{ productId: number; form: string; quantity: number; unitPrice: number }>
}

function generateCategories(count: number): CategoryData[] {
  const categories: CategoryData[] = []
  const baseCategories = CATEGORIES.slice(0, Math.min(count, CATEGORIES.length))

  for (const name of baseCategories) {
    categories.push({ name })
  }

  for (let i = baseCategories.length; i < count; i++) {
    categories.push({ name: `CATEGORIE ${String(i + 1).padStart(4, '0')}` })
  }

  return categories
}

function generateSuppliers(count: number): SupplierData[] {
  const suppliers: SupplierData[] = []
  const usedNames = new Set<string>()

  for (let i = 0; i < count; i++) {
    let name = formatName()
    if (i > 0) {
      name = `${name} ${i + 1}`
    }

    while (usedNames.has(name.toUpperCase())) {
      name = `${formatName()} ${i + 1}${randomInt(100, 999)}`
    }

    usedNames.add(name.toUpperCase())
    suppliers.push({
      name,
      phone: formatPhone(),
      address: formatAddress(),
    })
  }

  return suppliers
}

function generateClients(count: number): ClientData[] {
  const clients: ClientData[] = []
  const usedNames = new Set<string>()
  const usedPhones = new Set<string>()

  for (let i = 0; i < count; i++) {
    let name = formatName()
    if (i > 0) {
      name = `${name} ${i + 1}`
    }

    while (usedNames.has(name.toUpperCase())) {
      name = `${formatName()} ${i + 1}${randomInt(100, 999)}`
    }

    let phone: string
    do {
      phone = formatPhone()
    } while (usedPhones.has(phone))

    usedNames.add(name.toUpperCase())
    usedPhones.add(phone)
    clients.push({
      name,
      phone,
      address: i % 3 === 0 ? null : formatAddress(),
    })
  }

  return clients
}

function generateProducts(categoryIds: number[], count: number): ProductData[] {
  const products: ProductData[] = []
  const transformableCount = Math.floor(count * 0.3)
  const simpleCount = count - transformableCount
  const forms = ['SAC', 'BOUTEILLE', 'PAQUET', 'UNITE', 'BAGUE']

  for (let i = 0; i < simpleCount; i++) {
    const purchasePrice = randomInt(500, 10000)
    const salePrice = purchasePrice + randomInt(200, 5000)
    products.push({
      name: `${formatProductName()} ${i + 1}`,
      categoryId: randomElement(categoryIds),
      purchasePrice,
      salePrice,
      isTransformable: false,
      primaryForm: randomElement(forms),
      secondaryForm: null,
      conversionQuantity: null,
      secondarySalePrice: null,
    })
  }

  for (let i = 0; i < transformableCount; i++) {
    const tpl = TRANSFORMABLE_PRODUCTS[i % TRANSFORMABLE_PRODUCTS.length]
    const purchasePrice = randomInt(500, 10000)
    const salePrice = purchasePrice + randomInt(500, 10000)
    products.push({
      name: `${tpl.name} ${i + 1}`,
      categoryId: randomElement(categoryIds),
      purchasePrice,
      salePrice,
      isTransformable: true,
      primaryForm: tpl.primaryForm,
      secondaryForm: tpl.secondaryForm,
      conversionQuantity: tpl.conversionQuantity,
      secondarySalePrice: tpl.secondarySalePrice,
    })
  }

  return products
}

function generateStockInitialData(
  productIds: number[],
  transformableProductMap: Map<number, { primaryForm: string; secondaryForm: string }>,
  count: number,
): StockInitialData[] {
  const stockData: StockInitialData[] = []

  for (let i = 0; i < count; i++) {
    const productId = randomElement(productIds)

    if (transformableProductMap.has(productId)) {
      const forms = transformableProductMap.get(productId)!
      stockData.push({ productId, form: forms.primaryForm, quantity: randomInt(5, 100) })
      stockData.push({ productId, form: forms.secondaryForm, quantity: randomInt(1, 50) })
    } else {
      stockData.push({ productId, form: 'SAC', quantity: randomInt(10, 200) })
    }
  }

  return stockData
}

function generateSupplies(
  supplierIds: number[],
  productIds: number[],
  productFormMap: Map<number, { primaryForm: string; secondaryForm: string | null }>,
  count: number,
  sequenceOffset = 0,
): SupplyData[] {
  const supplies: SupplyData[] = []
  const startDate = new Date(2024, 0, 1)
  const endDate = new Date()

  for (let i = 0; i < count; i++) {
    const itemCount = randomInt(1, 5)
    const items: SupplyData['items'] = []
    const usedPairs = new Set<string>()

    while (items.length < itemCount) {
      const productId = randomElement(productIds)
      const forms = productFormMap.get(productId)
      let form: string

      if (forms && forms.secondaryForm) {
        form = randomElement([forms.primaryForm, forms.secondaryForm])
      } else {
        form = forms?.primaryForm ?? randomElement(['SAC', 'CARTON', 'SEAU', 'BOUTEILLE', 'PAQUET'])
      }

      const key = `${productId}-${form}`
      if (usedPairs.has(key)) {
        continue
      }

      usedPairs.add(key)
      items.push({
        productId,
        form,
        quantity: randomInt(1, 50),
        purchaseUnitPrice: randomInt(100, 10000),
      })
    }

    supplies.push({
      supplierId: randomElement(supplierIds),
      date: randomDate(startDate, endDate).toISOString().split('T')[0],
      items,
    })
  }

  void sequenceOffset
  return supplies
}

function generateInvoices(
  clientIds: number[],
  productIds: number[],
  productFormMap: Map<number, { primaryForm: string; secondaryForm: string | null }>,
  count: number,
  sequenceOffset = 0,
): InvoiceData[] {
  const invoices: InvoiceData[] = []
  const startDate = new Date(2024, 0, 1)
  const endDate = new Date()

  for (let i = 0; i < count; i++) {
    const itemCount = randomInt(1, 5)
    const items: InvoiceData['items'] = []
    const usedPairs = new Set<string>()

    while (items.length < itemCount) {
      const productId = randomElement(productIds)
      const forms = productFormMap.get(productId)
      let form: string

      if (forms && forms.secondaryForm) {
        form = randomElement([forms.primaryForm, forms.secondaryForm])
      } else {
        form = forms?.primaryForm ?? 'SAC'
      }

      const key = `${productId}-${form}`
      if (usedPairs.has(key)) {
        continue
      }

      usedPairs.add(key)
      items.push({
        productId,
        form,
        quantity: randomInt(1, 20),
        unitPrice: randomInt(100, 15000),
      })
    }

    invoices.push({
      clientId: randomElement(clientIds),
      date: randomDate(startDate, endDate).toISOString().split('T')[0],
      items,
    })
  }

  void sequenceOffset
  return invoices
}

function setupDatabase(dbPath: string): { sqlite: Database.Database; db: ReturnType<typeof drizzle> } {
  const sqlite = new Database(dbPath)
  sqlite.pragma('foreign_keys = ON')
  sqlite.function('unaccent', { deterministic: true }, (value: string) => {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  })

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })

  return { sqlite, db }
}

interface SeedResult {
  categories: number
  suppliers: number
  clients: number
  products: number
  stockMovements: number
  supplies: number
  invoices: number
  payments: number
}

async function bulkSeed(
  dbPath: string,
  count: number,
  dryRun: boolean,
): Promise<SeedResult> {
  validateMigrationsFolder()

  if (isRealDatabasePath(dbPath)) {
    console.error(`[SECURITY ERROR] Refusing to write to the real database: ${dbPath}`)
    console.error('[SECURITY ERROR] Use --db with a different path.')
    exit(1)
  }

  if (dryRun) {
    console.log('[DRY RUN] No database will be written.')
    console.log(`[DRY RUN] Configuration: count=${count}, db=${dbPath}`)
    console.log('[DRY RUN] Would set up migrations and generate synthetic data.')
    console.log('[DRY RUN] Data plan:')
    console.log(`  - ${count} categories`)
    console.log(`  - ${count} suppliers`)
    console.log(`  - ${count} clients`)
    console.log(`  - ${count} products`)
    console.log(`  - ${Math.max(count * 10, 100)} stock initializations`)
    console.log(`  - ${Math.max(count * 5, 50)} supplies`)
    console.log(`  - ${Math.max(count * 5, 50)} invoices`)
    console.log('[DRY RUN] Complete. No data was written.')
    return { categories: 0, suppliers: 0, clients: 0, products: 0, stockMovements: 0, supplies: 0, invoices: 0, payments: 0 }
  }

  if (!dbPath) {
    console.error('[ERROR] A database path is required. Use --db <path> or --dry-run.')
    exit(1)
  }

  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  console.log(`[INFO] Setting up database at: ${dbPath}`)
  const { sqlite, db } = setupDatabase(dbPath)

  console.log('[INFO] Running migrations...')

  const result: SeedResult = {
    categories: 0,
    suppliers: 0,
    clients: 0,
    products: 0,
    stockMovements: 0,
    supplies: 0,
    invoices: 0,
    payments: 0,
  }

  try {
    console.log('[INFO] Generating categories...')
    const categoriesData = generateCategories(count)

    for (const cat of categoriesData) {
      try {
        db.insert(schema.categories).values({
          name: cat.name,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).run()
        result.categories++
      } catch (error) {
        console.warn(`[WARN] Skipped duplicate category "${cat.name}": ${(error as Error).message}`)
      }
    }
    console.log(`[INFO] Created ${result.categories} categories.`)

    console.log('[INFO] Generating suppliers...')
    const suppliersData = generateSuppliers(count)

    try {
      db.insert(schema.suppliers).values({
        name: 'FOURNISSEUR COMPTANT',
        phone: '000-000-0000',
        address: null,
        isActive: true,
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).run()
      result.suppliers++
    } catch {
      console.warn('[WARN] System supplier already exists, skipping.')
    }

    for (const supplier of suppliersData) {
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
        result.suppliers++
      } catch (error) {
        console.warn(`[WARN] Skipped duplicate supplier: ${(error as Error).message}`)
      }
    }
    console.log(`[INFO] Created ${result.suppliers} suppliers (including system).`)

    console.log('[INFO] Generating clients...')
    const clientsData = generateClients(count)

    try {
      db.insert(schema.clients).values({
        name: 'CLIENT COMPTANT',
        phone: '000-000-0000',
        address: null,
        isActive: true,
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).run()
      result.clients++
    } catch {
      console.warn('[WARN] System client already exists, skipping.')
    }

    for (const client of clientsData) {
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
        result.clients++
      } catch (error) {
        console.warn(`[WARN] Skipped duplicate client: ${(error as Error).message}`)
      }
    }
    console.log(`[INFO] Created ${result.clients} clients (including system).`)

    console.log('[INFO] Generating products...')
    const categoryIds = db.select({ id: schema.categories.id }).from(schema.categories).all().map((r) => r.id)
    const productsData = generateProducts(categoryIds, count)
    const transformableProductMap = new Map<number, { primaryForm: string; secondaryForm: string }>()
    const productFormMap = new Map<number, { primaryForm: string; secondaryForm: string | null }>()

    for (let i = 0; i < productsData.length; i++) {
      const product = productsData[i]
      try {
        const inserted = db.insert(schema.products).values({
          name: product.name.toUpperCase(),
          categoryId: product.categoryId,
          purchasePrice: product.purchasePrice,
          salePrice: product.salePrice,
          isTransformable: product.isTransformable,
          primaryForm: product.primaryForm ?? null,
          secondaryForm: product.secondaryForm,
          conversionQuantity: product.conversionQuantity,
          secondarySalePrice: product.secondarySalePrice,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning({ id: schema.products.id }).get()

        result.products++

        productFormMap.set(inserted.id, {
          primaryForm: product.primaryForm ?? '',
          secondaryForm: product.secondaryForm,
        })

        if (product.isTransformable && product.primaryForm && product.secondaryForm) {
          transformableProductMap.set(inserted.id, {
            primaryForm: product.primaryForm ?? '',
            secondaryForm: product.secondaryForm,
          })
        }

        if ((i + 1) % 10 === 0) {
          console.log(`[INFO] Created ${i + 1}/${productsData.length} products.`)
        }
      } catch (error) {
        console.warn(`[WARN] Skipped duplicate product "${product.name}": ${(error as Error).message}`)
      }
    }
    console.log(`[INFO] Created ${result.products} products.`)

    const productIds = db.select({ id: schema.products.id }).from(schema.products).all().map((r) => r.id)

    console.log('[INFO] Generating stock initializations...')
    const stockCount = Math.max(count * 10, 100)
    const stockData = generateStockInitialData(
      productIds,
      transformableProductMap,
      stockCount,
    )

    const initializedProducts = new Set<number>()

    for (const stock of stockData) {
      if (initializedProducts.has(stock.productId)) {
        continue
      }

      const existing = db.select({ id: schema.stockMovements.id })
        .from(schema.stockMovements)
        .where(sql`${schema.stockMovements.productId} = ${stock.productId} AND ${schema.stockMovements.movementType} = 'STOCK_INITIAL'`)
        .get()

      if (existing) {
        initializedProducts.add(stock.productId)
        continue
      }

      const now = new Date()
      const forms = transformableProductMap.has(stock.productId)
        ? [transformableProductMap.get(stock.productId)!.primaryForm, transformableProductMap.get(stock.productId)!.secondaryForm]
        : ['SAC']

      for (const form of forms) {
        const qty = randomInt(10, 200)
        if (qty > 0) {
          db.insert(schema.stockMovements).values({
            productId: stock.productId,
            form,
            movementType: 'STOCK_INITIAL',
            direction: 'IN',
            quantity: qty,
            reason: null,
            createdAt: now,
          }).run()
          result.stockMovements++
        }
      }

      initializedProducts.add(stock.productId)
    }
    console.log(`[INFO] Created ${result.stockMovements} stock movements.`)

    console.log('[INFO] Generating supplies...')
    const supplyCount = Math.max(count * 5, 50)
    const realSupplierIds = db.select({ id: schema.suppliers.id })
      .from(schema.suppliers)
      .where(sql`${schema.suppliers.isSystem} = 0`)
      .all()
      .map((r) => r.id)

    if (realSupplierIds.length === 0) {
      console.warn('[WARN] No non-system suppliers found, skipping supplies.')
    } else {
      const lastSupplyRef = db.select({ id: schema.supplies.id })
        .from(schema.supplies)
        .orderBy(desc(schema.supplies.id))
        .limit(1)
        .get()

      const supplySequence = (lastSupplyRef ? lastSupplyRef.id : 0) + 1
      let currentSupplySeq = supplySequence

      const suppliesData = generateSupplies(
        realSupplierIds,
        productIds,
        productFormMap,
        supplyCount,
        supplySequence,
      )

      for (const supply of suppliesData) {
        try {
          db.transaction((tx) => {
            const now = new Date()
            const date = new Date(supply.date)
            const reference = `APP-${String(currentSupplySeq).padStart(6, '0')}`
            let totalAmount = 0

            const inserted = tx.insert(schema.supplies).values({
              reference,
              supplierId: supply.supplierId,
              supplierName: null,
              date,
              totalAmount: 0,
              createdAt: now,
            }).returning({ id: schema.supplies.id }).get()

            for (const item of supply.items) {
              const lineTotal = item.quantity * item.purchaseUnitPrice
              totalAmount += lineTotal

              tx.insert(schema.supplyItems).values({
                supplyId: inserted.id,
                productId: item.productId,
                form: item.form,
                quantity: item.quantity,
                purchaseUnitPrice: item.purchaseUnitPrice,
                lineTotal,
              }).run()

              tx.insert(schema.stockMovements).values({
                productId: item.productId,
                form: item.form,
                movementType: 'APPROVISIONNEMENT',
                direction: 'IN',
                quantity: item.quantity,
                reason: null,
                createdAt: now,
              }).run()
            }

            tx.update(schema.supplies)
              .set({ totalAmount })
              .where(sql`${schema.supplies.id} = ${inserted.id}`)
              .run()

            result.supplies++
          })
          currentSupplySeq++
        } catch (error) {
          console.warn(`[WARN] Skipped supply: ${(error as Error).message}`)
        }
      }
    }
    console.log(`[INFO] Created ${result.supplies} supplies.`)

    console.log('[INFO] Generating invoices...')
    const invoiceCount = Math.max(count * 5, 50)
    const realClientIds = db.select({ id: schema.clients.id })
      .from(schema.clients)
      .where(sql`${schema.clients.isSystem} = 0`)
      .all()
      .map((r) => r.id)

    if (realClientIds.length === 0) {
      console.warn('[WARN] No non-system clients found, skipping invoices.')
    } else {
      const lastSaleRef = db.select({ id: schema.sales.id })
        .from(schema.sales)
        .orderBy(desc(schema.sales.id))
        .limit(1)
        .get()

      const saleSequence = (lastSaleRef ? lastSaleRef.id : 0) + 1
      let currentSaleSeq = saleSequence

      const invoicesData = generateInvoices(
        realClientIds,
        productIds,
        productFormMap,
        invoiceCount,
        saleSequence,
      )

      for (const invoice of invoicesData) {
        try {
          db.transaction((tx) => {
            const now = new Date()
            const date = new Date(invoice.date)
            const reference = `VTE-${String(currentSaleSeq).padStart(6, '0')}`
            let totalAmount = 0

            const inserted = tx.insert(schema.sales).values({
              reference,
              clientId: invoice.clientId,
              saleDate: date,
              status: 'VALIDEE',
              totalAmount: 0,
              createdAt: now,
              updatedAt: now,
            }).returning({ id: schema.sales.id }).get()

            for (const item of invoice.items) {
              const lineTotal = item.quantity * item.unitPrice
              totalAmount += lineTotal

              tx.insert(schema.saleItems).values({
                saleId: inserted.id,
                productId: item.productId,
                form: item.form,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineTotal,
              }).run()

              tx.insert(schema.stockMovements).values({
                productId: item.productId,
                form: item.form,
                movementType: 'SALE',
                direction: 'OUT',
                quantity: item.quantity,
                reason: `Facture ${reference}`,
                createdAt: now,
              }).run()

              result.stockMovements++
            }

            tx.update(schema.sales)
              .set({ totalAmount })
              .where(sql`${schema.sales.id} = ${inserted.id}`)
              .run()

            result.invoices++
          })
          currentSaleSeq++
        } catch (error) {
          console.warn(`[WARN] Skipped invoice: ${(error as Error).message}`)
        }
      }
    }
    console.log(`[INFO] Created ${result.invoices} invoices.`)

    console.log('[INFO] Generating payments...')
    const allInvoices = db.select({ id: schema.sales.id, totalAmount: schema.sales.totalAmount })
      .from(schema.sales)
      .where(sql`${schema.sales.totalAmount} > 0`)
      .all()

    for (let i = 0; i < allInvoices.length; i++) {
      const invoice = allInvoices[i]
      const paymentAmount = randomInt(1, Math.max(1, Math.floor(invoice.totalAmount / 2)))

      db.insert(schema.payments).values({
        saleId: invoice.id,
        amount: paymentAmount,
        paymentDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }).run()
      result.payments++
    }
    console.log(`[INFO] Created ${result.payments} payments.`)

  } finally {
    sqlite.close()
  }

  console.log('[INFO] Seeding complete!')
  console.log(`[INFO] Database location: ${dbPath}`)
  console.log(`[INFO] Summary:`)
  console.log(`  - Categories: ${result.categories}`)
  console.log(`  - Suppliers: ${result.suppliers}`)
  console.log(`  - Clients: ${result.clients}`)
  console.log(`  - Products: ${result.products}`)
  console.log(`  - Stock movements: ${result.stockMovements}`)
  console.log(`  - Supplies: ${result.supplies}`)
  console.log(`  - Invoices: ${result.invoices}`)
  console.log(`  - Payments: ${result.payments}`)

  return result
}

async function main(): Promise<void> {
  const args = parseArgs(argv)

  if (args.help) {
    printHelp()
    exit(0)
    return
  }

  const count = args.count
  const dryRun = args.dryRun
  const dbPath = typeof args.db === 'string' ? args.db : dryRun ? '/tmp/dry-run-seed.db' : ''

  if (!dryRun && !dbPath) {
    console.error('[ERROR] The --db option is required unless --dry-run is used.')
    printHelp()
    exit(1)
    return
  }

  await bulkSeed(dbPath, count, dryRun)
}

function isMainModule(): boolean {
  const entryFile = path.resolve(process.argv[1] ?? '')
  const thisFile = path.resolve(import.meta.url?.replace('file://', '') ?? __filename)
  return entryFile === thisFile || process.argv[1]?.endsWith('bulk-seed.ts')
}

if (isMainModule()) {
  main().catch((error) => {
    console.error('[FATAL]', error)
    exit(1)
  })
}

export {
  generateCategories,
  generateClients,
  generateProducts,
  generateSuppliers,
  generateSupplies,
  generateInvoices,
  generateStockInitialData,
  parseArgs,
  printHelp,
  isRealDatabasePath,
  REAL_DB_PATH,
  bulkSeed,
}

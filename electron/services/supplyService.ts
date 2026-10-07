import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { z } from 'zod'
import { products, stockMovements, supplyItems, supplies } from '../database/schema'
import { getDb, removeDiacritics } from '../database/client'
import type { AppDatabase } from '../database/client'
import {
  PRODUCT_FORM_MAX_LENGTH,
  ProductError,
  getProductById,
  normalizeFormName,
} from './productService'
import {
  ensureSystemSupplier,
  getSupplierById,
} from './supplierService'
import type {
  Product,
  Supply,
  SupplyCreateInput,
  SupplyDetail,
  SupplyFilters,
  SupplyItem,
  SupplyItemInput,
} from '../types'

export const SUPPLY_ERRORS = {
  dateRequired: "La date de l'approvisionnement est obligatoire.",
  dateInvalid: 'La date doit être au format AAAA-MM-JJ.',
  dateOutOfRange: 'La date doit être comprise entre le 01/01/2000 et le 31/12/2099.',
  supplierTooLong: 'Le fournisseur ne peut pas dépasser 120 caractères.',
  itemsRequired: 'Un approvisionnement doit contenir au moins un produit.',
  tooManyItems: 'Un approvisionnement ne peut pas dépasser 100 lignes.',
  productNotFound: 'Produit introuvable.',
  productInactive:
    "Produit inactif. Veuillez réactiver le produit avant de l'approvisionner.",
  formRequired: 'La forme est obligatoire.',
  formTooLong: `La forme ne peut pas dépasser ${PRODUCT_FORM_MAX_LENGTH} caractères.`,
  formInvalid: 'Forme invalide pour ce produit.',
  quantityRequired: 'La quantité est obligatoire.',
  quantityInvalid: 'La quantité doit être un entier supérieur à 0.',
  quantityTooHigh: 'La quantité ne peut pas dépasser 1 000 000.',
  unitPriceRequired: "Le prix d'achat unitaire est obligatoire.",
  unitPriceInvalid: "Le prix d'achat unitaire doit être un entier supérieur ou égal à 0.",
  unitPriceTooHigh: "Le prix d'achat unitaire ne peut pas dépasser 1 000 000 000 FCFA.",
  duplicateLine:
    'Un même produit ne peut pas apparaître deux fois avec la même forme. Regroupez les quantités sur une seule ligne.',
  notFound: 'Approvisionnement introuvable.',
  supplierNotFound: 'Ce fournisseur n’existe pas.',
  supplierInactive: 'Fournisseur inactif : choisissez un fournisseur actif.',
  referenceConflict: "La référence de l'approvisionnement est déjà utilisée.",
  totalInvalid: "Le total de l'approvisionnement est invalide.",
  unexpected: 'Une erreur inattendue est survenue.',
} as const

export type SupplyErrorCode = keyof typeof SUPPLY_ERRORS

export class SupplyError extends Error {
  readonly code: SupplyErrorCode

  constructor(code: SupplyErrorCode) {
    super(SUPPLY_ERRORS[code])
    this.name = 'SupplyError'
    this.code = code
  }
}

export const SUPPLY_REFERENCE_PREFIX = 'APP'
export const SUPPLY_REFERENCE_PADDING = 6
export const SUPPLY_QUANTITY_MAX = 1_000_000
export const SUPPLY_UNIT_PRICE_MAX = 1_000_000_000
export const SUPPLY_SUPPLIER_MAX_LENGTH = 120
export const SUPPLY_ITEMS_MAX = 100

const SUPPLY_ERROR_CODES = Object.keys(SUPPLY_ERRORS) as SupplyErrorCode[]

type SupplyDatabase = Pick<AppDatabase, 'select' | 'insert' | 'update'>

/** APP-000001, APP-000002, ... */
export function formatSupplyReference(sequence: number): string {
  return `${SUPPLY_REFERENCE_PREFIX}-${String(sequence).padStart(SUPPLY_REFERENCE_PADDING, '0')}`
}

/** The supplier is free text in this version: trimmed, inner blanks collapsed. */
export function normalizeSupplierName(rawName: string): string {
  return rawName.trim().replace(/\s+/g, ' ')
}

/**
 * `YYYY-MM-DD` -> local midnight Date. The reception day is stored as the
 * timestamp of its start, so a document always displays the same day whatever
 * the time it was created at.
 */
export function parseSupplyDate(rawDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(rawDate ?? '').trim())

  if (!match) {
    throw new SupplyError('dateInvalid')
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)

  // Rejects 2026-02-31 and friends, which JavaScript would silently roll over.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new SupplyError('dateInvalid')
  }

  if (year < 2000 || year > 2099) {
    throw new SupplyError('dateOutOfRange')
  }

  return date
}

/** Today at local date, the default date of a new document. */
export function todayAsSupplyDate(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const supplierNameSchema = z
  .string({ error: SUPPLY_ERRORS.supplierTooLong })
  .transform(normalizeSupplierName)
  .pipe(z.string().max(SUPPLY_SUPPLIER_MAX_LENGTH, SUPPLY_ERRORS.supplierTooLong))

const productIdSchema = z
  .number({ error: SUPPLY_ERRORS.productNotFound })
  .int(SUPPLY_ERRORS.productNotFound)
  .positive(SUPPLY_ERRORS.productNotFound)

const formSchema = z
  .string({ error: SUPPLY_ERRORS.formRequired })
  .transform(normalizeFormName)
  .pipe(
    z
      .string()
      .min(1, SUPPLY_ERRORS.formRequired)
      .max(PRODUCT_FORM_MAX_LENGTH, SUPPLY_ERRORS.formTooLong),
  )

const quantitySchema = z
  .number({ error: SUPPLY_ERRORS.quantityRequired })
  .int(SUPPLY_ERRORS.quantityInvalid)
  .positive(SUPPLY_ERRORS.quantityInvalid)
  .max(SUPPLY_QUANTITY_MAX, SUPPLY_ERRORS.quantityTooHigh)

const unitPriceSchema = z
  .number({ error: SUPPLY_ERRORS.unitPriceRequired })
  .int(SUPPLY_ERRORS.unitPriceInvalid)
  .min(0, SUPPLY_ERRORS.unitPriceInvalid)
  .max(SUPPLY_UNIT_PRICE_MAX, SUPPLY_ERRORS.unitPriceTooHigh)

export const supplyItemInputSchema = z.object({
  productId: productIdSchema,
  form: formSchema,
  quantity: quantitySchema,
  purchaseUnitPrice: unitPriceSchema,
})

export const supplyCreateSchema = z.object({
  items: z
    .array(supplyItemInputSchema)
    .min(1, SUPPLY_ERRORS.itemsRequired)
    .max(SUPPLY_ITEMS_MAX, SUPPLY_ERRORS.tooManyItems),
})

function toErrorCode(error: z.ZodError, fallback: SupplyErrorCode): SupplyErrorCode {
  const message = error.issues[0]?.message

  return SUPPLY_ERROR_CODES.find((code) => SUPPLY_ERRORS[code] === message) ?? fallback
}

/** The forms a product can hold: one for a simple product, two otherwise. */
export function getProductForms(product: Product): string[] {
  return [product.primaryForm, product.secondaryForm].filter(
    (form): form is string => Boolean(form),
  )
}

/**
 * The form really belongs to the product: SAC for a simple product, CARTON or
 * SEAU for a transformable one. Anything else is a business error, never a SQL
 * error.
 */
function assertFormBelongsToProduct(product: Product, form: string): void {
  if (!getProductForms(product).includes(form)) {
    throw new SupplyError('formInvalid')
  }
}

/**
 * The products module owns the product lookup: its "produit inexistant" error is
 * translated here so the renderer always receives an explicit message.
 */
function findProduct(productId: number): Product {
  try {
    return getProductById(productId)
  } catch (error) {
    if (error instanceof ProductError && error.code === 'notFound') {
      throw new SupplyError('productNotFound')
    }

    throw error
  }
}

/**
 * The ledger is only read here: the balance of a form stays the sum of its
 * movements, exactly like the stock module, so a second source of truth is
 * never introduced by a supply.
 */
const signedQuantityExpression: SQL<number> = sql<number>`coalesce(sum(case when ${stockMovements.direction} = 'IN' then ${stockMovements.quantity} else -${stockMovements.quantity} end), 0)`

function computeFormQuantity(db: SupplyDatabase, productId: number, form: string): number {
  const row = db
    .select({ quantity: signedQuantityExpression })
    .from(stockMovements)
    .where(and(eq(stockMovements.productId, productId), eq(stockMovements.form, form)))
    .get()

  return row?.quantity ?? 0
}

/**
 * Next free sequence number, read from the last document inside the transaction
 * so the reference and the document are written together.
 */
function nextReferenceSequence(db: SupplyDatabase): number {
  const last = db.select({ id: supplies.id }).from(supplies).orderBy(desc(supplies.id)).limit(1).get()

  return (last?.id ?? 0) + 1
}

/** Same product, same form, twice on one document: the lines must be merged. */
function assertNoDuplicateLines(lines: SupplyItemInput[]): void {
  const seen = new Set<string>()

  for (const line of lines) {
    const key = `${line.productId}|${line.form}`

    if (seen.has(key)) {
      throw new SupplyError('duplicateLine')
    }

    seen.add(key)
  }
}

const supplyColumns = {
  id: supplies.id,
  reference: supplies.reference,
  supplierId: supplies.supplierId,
  supplierName: supplies.supplierName,
  date: supplies.date,
  totalAmount: supplies.totalAmount,
  createdAt: supplies.createdAt,
}

type SupplyRow = {
  id: number
  reference: string
  supplierId: number | null
  supplierName: string | null
  date: Date
  totalAmount: number
  createdAt: Date
}

function toSupply(row: SupplyRow, itemCount: number): Supply {
  return {
    id: row.id,
    reference: row.reference,
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    date: row.date,
    totalAmount: row.totalAmount,
    itemCount,
    createdAt: row.createdAt,
  }
}

/** One grouped query instead of one sub query per document. */
function countItemsBySupply(
  db: Pick<SupplyDatabase, 'select'>,
): Map<number, number> {
  const rows = db
    .select({ supplyId: supplyItems.supplyId, count: sql<number>`count(*)` })
    .from(supplyItems)
    .groupBy(supplyItems.supplyId)
    .all()

  return new Map(rows.map((row) => [row.supplyId, row.count]))
}

function countItemsOf(db: Pick<SupplyDatabase, 'select'>, supplyId: number): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(supplyItems)
    .where(eq(supplyItems.supplyId, supplyId))
    .get()

  return row?.count ?? 0
}

/** Accent and case insensitive LIKE pattern, like the products module. */
function buildContainsPattern(rawSearch: string): string {
  const search = removeDiacritics(rawSearch.trim()).toLowerCase().replace(/\s+/g, ' ')

  return `%${search.replace(/[\\%_]/g, '\\$&')}%`
}

export function listSupplies(filters: SupplyFilters = {}): Supply[] {
  const conditions = []

  if (typeof filters?.search === 'string' && filters.search.trim()) {
    conditions.push(
      sql`unaccent(lower(${supplies.reference})) like ${
        buildContainsPattern(filters.search)
      } escape '\\'`,
    )
  }

  if (typeof filters?.supplierSearch === 'string' && filters.supplierSearch.trim()) {
    conditions.push(
      sql`unaccent(lower(coalesce(${supplies.supplierName}, ''))) like ${
        buildContainsPattern(filters.supplierSearch)
      } escape '\\'`,
    )
  }

  const db = getDb()
  const rows = db
    .select(supplyColumns)
    .from(supplies)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(supplies.id))
    .all()
  const itemCounts = countItemsBySupply(db)

  return rows.map((row) => toSupply(row, itemCounts.get(row.id) ?? 0))
}

function selectItems(db: Pick<SupplyDatabase, 'select'>, supplyId: number): SupplyItem[] {
  return db
    .select({
      id: supplyItems.id,
      supplyId: supplyItems.supplyId,
      productId: supplyItems.productId,
      productName: products.name,
      form: supplyItems.form,
      quantity: supplyItems.quantity,
      purchaseUnitPrice: supplyItems.purchaseUnitPrice,
      lineTotal: supplyItems.lineTotal,
    })
    .from(supplyItems)
    .innerJoin(products, eq(supplyItems.productId, products.id))
    .where(eq(supplyItems.supplyId, supplyId))
    .orderBy(asc(supplyItems.id))
    .all()
}

function buildDetail(db: Pick<SupplyDatabase, 'select'>, supply: Supply): SupplyDetail {
  return { ...supply, items: selectItems(db, supply.id) }
}

function findSupplyRow(db: Pick<SupplyDatabase, 'select'>, id: number): SupplyRow | null {
  return db.select(supplyColumns).from(supplies).where(eq(supplies.id, id)).get() ?? null
}

export function getSupplyById(id: number): SupplyDetail {
  const supplyId = Number(id)

  if (!Number.isInteger(supplyId) || supplyId <= 0) {
    throw new SupplyError('notFound')
  }

  const db = getDb()
  const row = findSupplyRow(db, supplyId)

  if (!row) {
    throw new SupplyError('notFound')
  }

  return buildDetail(db, toSupply(row, countItemsOf(db, row.id)))
}

/** Detail by reference (APP-000001), used by the detail view. */
export function getSupplyByReference(reference: string): SupplyDetail {
  const normalized = String(reference ?? '')
    .trim()
    .toUpperCase()
  const db = getDb()
  const row = db.select(supplyColumns).from(supplies).where(eq(supplies.reference, normalized)).get()

  if (!row) {
    throw new SupplyError('notFound')
  }

  return buildDetail(db, toSupply(row, countItemsOf(db, row.id)))
}

/**
 * SQLite constraint violations never reach the shopkeeper: they are translated
 * into business errors, anything else keeps bubbling up to be logged by the IPC
 * layer as an unexpected error.
 */
function toDatabaseError(error: unknown): SupplyError | null {
  if (!(error instanceof Error)) {
    return null
  }

  const message = error.message

  if (message.includes('supplies_reference_unique')) {
    return new SupplyError('referenceConflict')
  }

  if (message.includes('supply_items_supply_product_form_unique')) {
    return new SupplyError('duplicateLine')
  }

  if (message.includes('supply_items_quantity_check')) {
    return new SupplyError('quantityInvalid')
  }

  if (message.includes('supply_items_purchase_unit_price_check')) {
    return new SupplyError('unitPriceInvalid')
  }

  if (message.includes('supply_items_line_total_check')) {
    return new SupplyError('totalInvalid')
  }

  if (message.includes('supplies_total_amount_check')) {
    return new SupplyError('totalInvalid')
  }

  if (message.includes('stock_movements_supply_direction_check')) {
    return new SupplyError('unexpected')
  }

  if (message.includes('stock_movements_type_check')) {
    return new SupplyError('unexpected')
  }

  if (message.includes('FOREIGN KEY')) {
    return new SupplyError('productNotFound')
  }

  return null
}

function withMappedErrors<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof SupplyError) {
      throw error
    }

    const mapped = toDatabaseError(error)

    if (mapped) {
      throw mapped
    }

    throw error
  }
}

/** Structural validation of the payload: no database access yet. */
function parsePayload(input: SupplyCreateInput): {
  lines: SupplyItemInput[]
  supplierId: number | null
  supplierName: string | null
  date: Date
} {
  const rawInput = input ?? ({} as SupplyCreateInput)
  const parsed = supplyCreateSchema.safeParse({ items: rawInput.items })

  if (!parsed.success) {
    throw new SupplyError(toErrorCode(parsed.error, 'itemsRequired'))
  }

  const date = parseSupplyDate(
    typeof rawInput.date === 'string' && rawInput.date.trim()
      ? rawInput.date
      : todayAsSupplyDate(),
  )

  assertNoDuplicateLines(parsed.data.items)

  // Resolve the supplier: by id when a real supplier is chosen, or by the
  // deprecated free-text name, or the system "FOURNISSEUR COMPTANT" last resort.
  let supplierId: number | null = null
  let supplierName: string | null = null

  if (rawInput.supplierId !== undefined && rawInput.supplierId !== null) {
    const supplier = getSupplierById(rawInput.supplierId)

    if (!supplier) {
      throw new SupplyError('supplierNotFound')
    }

    if (!supplier.isActive) {
      throw new SupplyError('supplierInactive')
    }

    supplierId = supplier.id
    supplierName = normalizeSupplierName(supplier.name)
  } else if (typeof rawInput.supplierName === 'string' && rawInput.supplierName.trim()) {
    const parsedSupplier = supplierNameSchema.safeParse(rawInput.supplierName)

    if (!parsedSupplier.success) {
      throw new SupplyError('supplierTooLong')
    }

    supplierName = parsedSupplier.data
    supplierId = null
  } else {
    const systemSupplier = ensureSystemSupplier()
    supplierId = systemSupplier.id
    supplierName = normalizeSupplierName(systemSupplier.name)
  }

  return {
    lines: parsed.data.items,
    supplierId,
    supplierName,
    date,
  }
}

/**
 * Creates and validates a supply in one single SQLite transaction:
 *
 * 1. generation of the reference
 * 2. creation of the supply header
 * 3. creation of the lines (line_total recomputed, never trusted from the UI)
 * 4. computation of the total from those lines
 * 5. creation of the APPROVISIONNEMENT movements (one IN per line)
 * 6. coherence checks on the persisted totals and on the resulting stock
 *
 * Any failure rolls everything back: a supply without its stock movements (or
 * the opposite) is impossible. A validated supply is then immutable: there is
 * no update and no delete on the document nor on its lines.
 *
 * A supply is a reception, never an initialization: it is written as an
 * APPROVISIONNEMENT IN movement and is accepted on a product whose stock has no
 * movement at all (a logical stock of 0).
 */
export function createSupply(input: SupplyCreateInput): SupplyDetail {
  const { lines, supplierId, supplierName, date } = parsePayload(input)
  const db = getDb()

  return withMappedErrors(() =>
    db.transaction((tx) => {
      // Products are re-read inside the transaction: a product deactivated
      // between the validation and the write can never be received. A product
      // without any movement simply has a stock of 0, so the reception is
      // authorized directly: no initialization is required beforehand.
      for (const line of lines) {
        const product = findProduct(line.productId)

        if (!product.isActive) {
          throw new SupplyError('productInactive')
        }

        assertFormBelongsToProduct(product, line.form)
      }

      const now = new Date()
      const reference = formatSupplyReference(nextReferenceSequence(tx))

      const inserted = tx
        .insert(supplies)
        .values({
          reference,
          supplierId,
          supplierName,
          date,
          // Placeholder: the real total is the sum of the persisted lines,
          // computed below and written back before the commit.
          totalAmount: 0,
          createdAt: now,
        })
        .returning({ id: supplies.id })
        .get()

      if (!inserted) {
        throw new SupplyError('unexpected')
      }

      const supplyId = inserted.id
      let totalAmount = 0

      for (const line of lines) {
        const lineTotal = line.quantity * line.purchaseUnitPrice

        tx.insert(supplyItems)
          .values({
            supplyId,
            productId: line.productId,
            form: line.form,
            quantity: line.quantity,
            purchaseUnitPrice: line.purchaseUnitPrice,
            lineTotal,
          })
          .run()

        totalAmount += lineTotal

        // Coherence check around the movement: the balance must grow by exactly
        // the received quantity, in the received form, with no conversion.
        const before = computeFormQuantity(tx, line.productId, line.form)

        tx.insert(stockMovements)
          .values({
            productId: line.productId,
            form: line.form,
            movementType: 'APPROVISIONNEMENT',
            direction: 'IN',
            quantity: line.quantity,
            reason: null,
            createdAt: now,
          })
          .run()

        const after = computeFormQuantity(tx, line.productId, line.form)

        if (after !== before + line.quantity || after < 0) {
          throw new SupplyError('unexpected')
        }
      }

      tx.update(supplies).set({ totalAmount }).where(eq(supplies.id, supplyId)).run()

      const stored = tx
        .select({ total: sql<number>`coalesce(sum(${supplyItems.lineTotal}), 0)` })
        .from(supplyItems)
        .where(eq(supplyItems.supplyId, supplyId))
        .get()

      // The header total must be the exact sum of its own persisted lines.
      if ((stored?.total ?? -1) !== totalAmount || totalAmount < 0) {
        throw new SupplyError('totalInvalid')
      }

      const row = findSupplyRow(tx, supplyId)

      if (!row) {
        throw new SupplyError('unexpected')
      }

      return buildDetail(tx, toSupply(row, lines.length))
    }),
  )
}

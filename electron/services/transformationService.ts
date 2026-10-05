import { and, desc, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { z } from 'zod'
import { products, stockMovements, transformations } from '../database/schema'
import { getDb, removeDiacritics } from '../database/client'
import type { AppDatabase } from '../database/client'
import {
  PRODUCT_FORM_MAX_LENGTH,
  ProductError,
  getProductById,
  listProducts,
  normalizeFormName,
} from './productService'
import type {
  Product,
  StockFormLevel,
  Transformation,
  TransformationCreateInput,
  TransformationDetail,
  TransformationFilters,
} from '../types'

export const TRANSFORMATION_ERRORS = {
  productRequired: 'Le produit est obligatoire.',
  productNotFound: 'Produit introuvable.',
  productInactive:
    "Produit inactif. Veuillez réactiver le produit avant de le transformer.",
  productNotTransformable:
    "Ce produit est simple : il ne possède pas de forme secondaire et ne peut pas être transformé.",
  conversionRequired: 'Ce produit transformable ne possède pas de conversion exploitable.',
  formRequired: 'La forme de départ est obligatoire.',
  formTooLong: `La forme ne peut pas dépasser ${PRODUCT_FORM_MAX_LENGTH} caractères.`,
  formInvalid: 'Forme invalide pour ce produit.',
  sameForm: "La forme de départ et la forme d'arrivée doivent être différentes.",
  quantityRequired: 'La quantité est obligatoire.',
  quantityInvalid: 'La quantité doit être un entier supérieur à 0.',
  quantityTooHigh: 'La quantité ne peut pas dépasser 1 000 000.',
  conversionInvalid:
    "Cette quantité ne peut pas être convertie exactement : aucune quantité fractionnaire n'est acceptée.",
  insufficientStock: 'Stock insuffisant pour cette transformation.',
  dateRequired: 'La date de la transformation est obligatoire.',
  dateInvalid: 'La date doit être au format AAAA-MM-JJ.',
  dateOutOfRange: 'La date doit être comprise entre le 01/01/2000 et le 31/12/2099.',
  notFound: 'Transformation introuvable.',
  referenceConflict: "La référence de la transformation est déjà utilisée.",
  unexpected: 'Une erreur inattendue est survenue.',
} as const

export type TransformationErrorCode = keyof typeof TRANSFORMATION_ERRORS

export class TransformationError extends Error {
  readonly code: TransformationErrorCode

  constructor(code: TransformationErrorCode) {
    super(TRANSFORMATION_ERRORS[code])
    this.name = 'TransformationError'
    this.code = code
  }
}

export const TRANSFORMATION_REFERENCE_PREFIX = 'TRF'
export const TRANSFORMATION_REFERENCE_PADDING = 6
export const TRANSFORMATION_QUANTITY_MAX = 1_000_000

const TRANSFORMATION_ERROR_CODES = Object.keys(
  TRANSFORMATION_ERRORS,
) as TransformationErrorCode[]

/**
 * The ledger is only read here: the balance of a form stays the sum of its
 * movements, exactly like the stock and supply modules, so a transformation never
 * introduces a second source of truth.
 */
type TransformationDatabase = Pick<AppDatabase, 'select' | 'insert'>

const signedQuantityExpression: SQL<number> = sql<number>`coalesce(sum(case when ${stockMovements.direction} = 'IN' then ${stockMovements.quantity} else -${stockMovements.quantity} end), 0)`

/** TRF-000001, TRF-000002, ... */
export function formatTransformationReference(sequence: number): string {
  return `${TRANSFORMATION_REFERENCE_PREFIX}-${String(sequence).padStart(
    TRANSFORMATION_REFERENCE_PADDING,
    '0',
  )}`
}

/**
 * `YYYY-MM-DD` -> local midnight Date, the exact same parsing as the supply
 * module: a document always displays the same day whatever the creation time.
 */
export function parseTransformationDate(rawDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(rawDate ?? '').trim())

  if (!match) {
    throw new TransformationError('dateInvalid')
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new TransformationError('dateInvalid')
  }

  if (year < 2000 || year > 2099) {
    throw new TransformationError('dateOutOfRange')
  }

  return date
}

/** Today as `YYYY-MM-DD`, the default date of a new document. */
export function todayAsTransformationDate(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const productIdSchema = z
  .number({ error: TRANSFORMATION_ERRORS.productRequired })
  .int(TRANSFORMATION_ERRORS.productNotFound)
  .positive(TRANSFORMATION_ERRORS.productNotFound)

const formSchema = z
  .string({ error: TRANSFORMATION_ERRORS.formRequired })
  .transform(normalizeFormName)
  .pipe(
    z
      .string()
      .min(1, TRANSFORMATION_ERRORS.formRequired)
      .max(PRODUCT_FORM_MAX_LENGTH, TRANSFORMATION_ERRORS.formTooLong),
  )

/** The quantity is always a strictly positive whole number, never fractional. */
const quantitySchema = z
  .number({ error: TRANSFORMATION_ERRORS.quantityRequired })
  .int(TRANSFORMATION_ERRORS.quantityInvalid)
  .positive(TRANSFORMATION_ERRORS.quantityInvalid)
  .max(TRANSFORMATION_QUANTITY_MAX, TRANSFORMATION_ERRORS.quantityTooHigh)

export const transformationCreateSchema = z.object({
  productId: productIdSchema,
  sourceForm: formSchema,
  sourceQuantity: quantitySchema,
})

function toErrorCode(
  error: z.ZodError,
  fallback: TransformationErrorCode,
): TransformationErrorCode {
  const message = error.issues[0]?.message

  return (
    TRANSFORMATION_ERROR_CODES.find((code) => TRANSFORMATION_ERRORS[code] === message) ??
    fallback
  )
}

/** The two forms of a transformable product, primary form first. */
export function getProductForms(product: Product): string[] {
  return [product.primaryForm, product.secondaryForm].filter(
    (form): form is string => Boolean(form),
  )
}

/**
 * Only an active transformable product holding exactly two forms and a usable
 * conversion can be transformed: every other product is a business error, never
 * a SQL error.
 */
function assertTransformable(product: Product): {
  primaryForm: string
  secondaryForm: string
  conversionQuantity: number
} {
  if (!product.isTransformable) {
    throw new TransformationError('productNotTransformable')
  }

  const [primaryForm, secondaryForm] = getProductForms(product)

  if (!primaryForm || !secondaryForm || primaryForm === secondaryForm) {
    throw new TransformationError('conversionRequired')
  }

  const conversionQuantity = product.conversionQuantity

  if (conversionQuantity === null || !Number.isInteger(conversionQuantity) || conversionQuantity <= 0) {
    throw new TransformationError('conversionRequired')
  }

  return { primaryForm, secondaryForm, conversionQuantity }
}

/** The other form of the product: the destination is never typed. */
function resolveDestinationForm(
  product: Product,
  sourceForm: string,
): { sourceForm: string; destinationForm: string } {
  const { primaryForm, secondaryForm } = assertTransformable(product)

  if (![primaryForm, secondaryForm].includes(sourceForm)) {
    throw new TransformationError('formInvalid')
  }

  return {
    sourceForm,
    destinationForm: sourceForm === primaryForm ? secondaryForm : primaryForm,
  }
}

/**
 * Exact conversion, no rounding and no loss: 1 CARTON = 4 SEAUX gives
 * 2 -> 8 and 4 -> 1, but 1 SEAU -> 0.25 CARTON is refused.
 */
export function computeDestinationQuantity(
  product: Product,
  sourceForm: string,
  sourceQuantity: number,
): number {
  const { primaryForm, conversionQuantity } = assertTransformable(product)
  const destinationQuantity =
    sourceForm === primaryForm
      ? sourceQuantity * conversionQuantity
      : sourceQuantity / conversionQuantity

  if (!Number.isInteger(destinationQuantity) || destinationQuantity <= 0) {
    throw new TransformationError('conversionInvalid')
  }

  if (destinationQuantity > TRANSFORMATION_QUANTITY_MAX) {
    throw new TransformationError('quantityTooHigh')
  }

  return destinationQuantity
}

function findProduct(productId: number): Product {
  try {
    return getProductById(productId)
  } catch (error) {
    if (error instanceof ProductError && error.code === 'notFound') {
      throw new TransformationError('productNotFound')
    }

    throw error
  }
}

function computeFormQuantity(
  db: TransformationDatabase,
  productId: number,
  form: string,
): number {
  const row = db
    .select({ quantity: signedQuantityExpression })
    .from(stockMovements)
    .where(and(eq(stockMovements.productId, productId), eq(stockMovements.form, form)))
    .get()

  return row?.quantity ?? 0
}

/**
 * Balance of every form of the product, recomputed from `stock_movements`: the
 * detail view never displays a stored quantity.
 */
function buildStockLevels(db: TransformationDatabase, product: Product): StockFormLevel[] {
  const hasMovements = Boolean(
    db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.productId, product.id))
      .limit(1)
      .get(),
  )

  return getProductForms(product).map((form) => ({
    productId: product.id,
    productName: product.name,
    categoryId: product.categoryId,
    categoryName: product.categoryName,
    form,
    quantity: computeFormQuantity(db, product.id, form),
    hasMovements,
    isProductActive: product.isActive,
    isLegacyForm: false,
  }))
}

/**
 * Next free sequence number, read from the last document inside the transaction
 * so the reference and the document are written together.
 */
function nextReferenceSequence(db: TransformationDatabase): number {
  const last = db
    .select({ id: transformations.id })
    .from(transformations)
    .orderBy(desc(transformations.id))
    .limit(1)
    .get()

  return (last?.id ?? 0) + 1
}

const transformationColumns = {
  id: transformations.id,
  reference: transformations.reference,
  productId: transformations.productId,
  productName: products.name,
  sourceForm: transformations.sourceForm,
  sourceQuantity: transformations.sourceQuantity,
  destinationForm: transformations.destinationForm,
  destinationQuantity: transformations.destinationQuantity,
  date: transformations.date,
  createdAt: transformations.createdAt,
}

type TransformationRow = {
  id: number
  reference: string
  productId: number
  productName: string
  sourceForm: string
  sourceQuantity: number
  destinationForm: string
  destinationQuantity: number
  date: Date
  createdAt: Date
}

function toTransformation(row: TransformationRow): Transformation {
  return { ...row }
}

function selectTransformationRows(db: TransformationDatabase): TransformationRow[] {
  return db
    .select(transformationColumns)
    .from(transformations)
    .innerJoin(products, eq(transformations.productId, products.id))
    .all()
}

/** Accent and case insensitive LIKE pattern, like the products module. */
function buildContainsPattern(rawSearch: string): string {
  const search = removeDiacritics(rawSearch.trim()).toLowerCase().replace(/\s+/g, ' ')

  return `%${search.replace(/[\\%_]/g, '\\$&')}%`
}

/**
 * The products a transformation form can offer: active transformable products
 * only, with their two forms and their conversion already configured. A simple
 * or an inactive product is never listed.
 */
export function listTransformableProducts(): Product[] {
  return listProducts({ isActive: true }).filter((product) => {
    try {
      assertTransformable(product)
      return true
    } catch {
      return false
    }
  })
}

/** History of the validated transformations, most recent first. */
export function listTransformations(filters: TransformationFilters = {}): Transformation[] {
  const conditions = []

  if (typeof filters?.search === 'string' && filters.search.trim()) {
    conditions.push(
      sql`unaccent(lower(${transformations.reference})) like ${
        buildContainsPattern(filters.search)
      } escape '\\'`,
    )
  }

  if (typeof filters?.productSearch === 'string' && filters.productSearch.trim()) {
    conditions.push(
      sql`unaccent(lower(${products.name})) like ${
        buildContainsPattern(filters.productSearch)
      } escape '\\'`,
    )
  }

  const rows =
    conditions.length > 0
      ? getDb()
          .select(transformationColumns)
          .from(transformations)
          .innerJoin(products, eq(transformations.productId, products.id))
          .where(and(...conditions))
          .orderBy(desc(transformations.id))
          .all()
      : selectTransformationRows(getDb())
          .sort((left, right) => right.id - left.id)

  return rows.map(toTransformation)
}

function findTransformationRow(
  db: TransformationDatabase,
  id: number,
): TransformationRow | null {
  return (
    db
      .select(transformationColumns)
      .from(transformations)
      .innerJoin(products, eq(transformations.productId, products.id))
      .where(eq(transformations.id, id))
      .get() ?? null
  )
}

function buildDetail(db: TransformationDatabase, row: TransformationRow): TransformationDetail {
  const product = findProduct(row.productId)

  return {
    ...toTransformation(row),
    stockAfter: buildStockLevels(db, product),
  }
}

/** A validated transformation is read only: it is never modified nor deleted. */
export function getTransformationById(id: number): TransformationDetail {
  const transformationId = Number(id)

  if (!Number.isInteger(transformationId) || transformationId <= 0) {
    throw new TransformationError('notFound')
  }

  const db = getDb()
  const row = findTransformationRow(db, transformationId)

  if (!row) {
    throw new TransformationError('notFound')
  }

  return buildDetail(db, row)
}

/** Detail by reference (TRF-000001), used by the detail view. */
export function getTransformationByReference(reference: string): TransformationDetail {
  const normalized = String(reference ?? '')
    .trim()
    .toUpperCase()
  const db = getDb()
  const row = db
    .select(transformationColumns)
    .from(transformations)
    .innerJoin(products, eq(transformations.productId, products.id))
    .where(eq(transformations.reference, normalized))
    .get()

  if (!row) {
    throw new TransformationError('notFound')
  }

  return buildDetail(db, row)
}

/**
 * SQLite constraint violations never reach the shopkeeper: they are translated
 * into business errors, anything else keeps bubbling up to be logged by the IPC
 * layer as an unexpected error.
 */
function toDatabaseError(error: unknown): TransformationError | null {
  if (!(error instanceof Error)) {
    return null
  }

  const message = error.message

  if (message.includes('transformations_reference_unique')) {
    return new TransformationError('referenceConflict')
  }

  if (
    message.includes('transformations_source_quantity_check') ||
    message.includes('transformations_destination_quantity_check') ||
    message.includes('stock_movements_quantity_check')
  ) {
    return new TransformationError('quantityInvalid')
  }

  if (message.includes('transformations_forms_check')) {
    return new TransformationError('sameForm')
  }

  if (message.includes('FOREIGN KEY')) {
    return new TransformationError('productNotFound')
  }

  return null
}

function withMappedErrors<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof TransformationError) {
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
function parsePayload(input: TransformationCreateInput): {
  productId: number
  sourceForm: string
  sourceQuantity: number
  date: Date
} {
  const rawInput = input ?? ({} as TransformationCreateInput)
  const parsed = transformationCreateSchema.safeParse({
    productId: rawInput.productId,
    sourceForm: rawInput.sourceForm,
    sourceQuantity: rawInput.sourceQuantity,
  })

  if (!parsed.success) {
    throw new TransformationError(toErrorCode(parsed.error, 'quantityInvalid'))
  }

  const date = parseTransformationDate(
    typeof rawInput.date === 'string' && rawInput.date.trim()
      ? rawInput.date
      : todayAsTransformationDate(),
  )

  return {
    productId: parsed.data.productId,
    sourceForm: parsed.data.sourceForm,
    sourceQuantity: parsed.data.sourceQuantity,
    date,
  }
}

/**
 * Creates and validates a transformation in one single SQLite transaction:
 *
 * 1. the product is re-read inside the transaction: a product deactivated
 *    between the validation and the write can never be transformed
 * 2. the product must be transformable and hold exactly two forms
 * 3. the source form must be one of those two forms, and never the destination
 * 4. the destination form is the other form, never typed by the shopkeeper
 * 5. the destination quantity is computed exactly from the conversion: no
 *    fraction, no rounding, no loss in V1
 * 6. the available stock of the source form is recomputed from `stock_movements`
 *    and must cover the requested quantity
 * 7. the reference TRF-XXXXXX is generated inside the same transaction
 * 8. the document is inserted
 * 9. the two movements are inserted: OUT on the source form and IN on the
 *    destination form
 * 10. both balances are recomputed and compared with what was requested
 *
 * Any failure rolls everything back: a transformation without its two movements
 * (or the opposite) is impossible. A validated transformation is then immutable:
 * there is no update and no delete on the document nor on its movements, and a
 * correction is made by an inverse transformation or by a stock adjustment.
 */
export function createTransformation(
  input: TransformationCreateInput,
): TransformationDetail {
  const { productId, sourceForm, sourceQuantity, date } = parsePayload(input)
  const db = getDb()

  return withMappedErrors(() =>
    db.transaction((tx) => {
      const product = findProduct(productId)

      if (!product.isActive) {
        throw new TransformationError('productInactive')
      }

      const { sourceForm: resolvedSource, destinationForm } =
        resolveDestinationForm(product, sourceForm)

      const destinationQuantity = computeDestinationQuantity(
        product,
        resolvedSource,
        sourceQuantity,
      )

      const sourceBefore = computeFormQuantity(tx, productId, resolvedSource)
      const destinationBefore = computeFormQuantity(tx, productId, destinationForm)

      if (sourceBefore - sourceQuantity < 0) {
        throw new TransformationError('insufficientStock')
      }

      const now = new Date()
      const reference = formatTransformationReference(nextReferenceSequence(tx))

      const inserted = tx
        .insert(transformations)
        .values({
          reference,
          productId,
          sourceForm: resolvedSource,
          sourceQuantity,
          destinationForm,
          destinationQuantity,
          date,
          createdAt: now,
        })
        .returning({ id: transformations.id })
        .get()

      if (!inserted) {
        throw new TransformationError('unexpected')
      }

      tx.insert(stockMovements)
        .values({
          productId,
          form: resolvedSource,
          movementType: 'TRANSFORMATION',
          direction: 'OUT',
          quantity: sourceQuantity,
          reason: null,
          createdAt: now,
        })
        .run()

      tx.insert(stockMovements)
        .values({
          productId,
          form: destinationForm,
          movementType: 'TRANSFORMATION',
          direction: 'IN',
          quantity: destinationQuantity,
          reason: null,
          createdAt: now,
        })
        .run()

      const sourceAfter = computeFormQuantity(tx, productId, resolvedSource)
      const destinationAfter = computeFormQuantity(tx, productId, destinationForm)

      // A transformation never creates stock and never loses any: the OUT half and
      // the IN half must match the requested quantities exactly.
      if (
        sourceAfter !== sourceBefore - sourceQuantity ||
        destinationAfter !== destinationBefore + destinationQuantity ||
        sourceAfter < 0 ||
        destinationAfter < 0
      ) {
        throw new TransformationError('unexpected')
      }

      const row = findTransformationRow(tx, inserted.id)

      if (!row) {
        throw new TransformationError('unexpected')
      }

      return buildDetail(tx, row)
    }),
  )
}
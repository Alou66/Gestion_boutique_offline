import { and, desc, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { z } from 'zod'
import { stockMovements } from '../database/schema'
import { getDb } from '../database/client'
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
  StockAdjustInput,
  StockAdjustResult,
  StockDirection,
  StockFilters,
  StockFormInput,
  StockFormLevel,
  StockInitializeInput,
  StockMovement,
} from '../types'

export const STOCK_ERRORS = {
  productNotFound: 'Produit introuvable.',
  productInactive: "Produit inactif : l'opération de stock est refusée.",
  formRequired: 'La forme est obligatoire.',
  formTooLong: `La forme ne peut pas dépasser ${PRODUCT_FORM_MAX_LENGTH} caractères.`,
  formInvalid: 'Forme invalide pour ce produit.',
  formsRequired: 'La quantité de la forme principale est obligatoire.',
  formsMismatch: "Les formes saisies ne correspondent pas aux formes du produit.",
  quantityRequired: 'La quantité est obligatoire.',
  quantityInvalid: 'La quantité doit être un entier supérieur ou égal à 0.',
  quantityTooHigh: 'La quantité ne peut pas dépasser 1 000 000.',
  positiveQuantityRequired:
    'Au moins une forme doit être initialisée avec une quantité supérieure à 0.',
  alreadyInitialized: 'Le stock de ce produit est déjà initialisé.',
  notInitialized:
    "Le stock de ce produit doit être initialisé avant de pouvoir être ajusté.",
  directionRequired: "Le sens de l'ajustement est obligatoire (entrée ou sortie).",
  directionInvalid: "Le sens de l'ajustement doit être 'IN' ou 'OUT'.",
  reasonRequired: 'Le motif est obligatoire pour un ajustement.',
  reasonTooLong: 'Le motif ne peut pas dépasser 200 caractères.',
  insufficientStock: 'Stock insuffisant pour cette opération.',
  unexpected: 'Une erreur inattendue est survenue.',
} as const

export type StockErrorCode = keyof typeof STOCK_ERRORS

export class StockError extends Error {
  readonly code: StockErrorCode

  constructor(code: StockErrorCode) {
    super(STOCK_ERRORS[code])
    this.name = 'StockError'
    this.code = code
  }
}

export const STOCK_QUANTITY_MAX = 1_000_000
export const STOCK_REASON_MAX_LENGTH = 200

const STOCK_ERROR_CODES = Object.keys(STOCK_ERRORS) as StockErrorCode[]

/**
 * The ledger is only read and written through the two queries used by the
 * services: the balance is always recomputed from `stock_movements`, there is no
 * denormalized quantity anywhere.
 */
type StockDatabase = Pick<AppDatabase, 'select' | 'insert'>

/**
 * One balance for one form: a movement is a positive quantity plus a direction,
 * so IN adds and OUT subtracts. `coalesce` keeps a form without movement at 0
 * instead of NULL.
 */
const signedQuantityExpression: SQL<number> = sql<number>`coalesce(sum(case when ${stockMovements.direction} = 'IN' then ${stockMovements.quantity} else -${stockMovements.quantity} end), 0)`

interface StockTotals {
  quantityByProductAndForm: Map<number, Map<string, number>>
  initializedProductIds: Set<number>
}

/** Reasons are free text: trimmed, inner blanks collapsed, stored as typed. */
export function normalizeStockReason(rawReason: string): string {
  return rawReason.trim().replace(/\s+/g, ' ')
}

const productIdSchema = z
  .number({ error: STOCK_ERRORS.productNotFound })
  .int(STOCK_ERRORS.productNotFound)
  .positive(STOCK_ERRORS.productNotFound)

const formSchema = z
  .string({ error: STOCK_ERRORS.formRequired })
  .transform(normalizeFormName)
  .pipe(
    z
      .string()
      .min(1, STOCK_ERRORS.formRequired)
      .max(PRODUCT_FORM_MAX_LENGTH, STOCK_ERRORS.formTooLong),
  )

/** An initialization accepts 0 on a form, but never on every form. */
const initialQuantitySchema = z
  .number({ error: STOCK_ERRORS.quantityRequired })
  .int(STOCK_ERRORS.quantityInvalid)
  .min(0, STOCK_ERRORS.quantityInvalid)
  .max(STOCK_QUANTITY_MAX, STOCK_ERRORS.quantityTooHigh)

/** A movement quantity is always strictly positive, the direction carries OUT. */
const movementQuantitySchema = z
  .number({ error: STOCK_ERRORS.quantityRequired })
  .int(STOCK_ERRORS.quantityInvalid)
  .positive(STOCK_ERRORS.quantityInvalid)
  .max(STOCK_QUANTITY_MAX, STOCK_ERRORS.quantityTooHigh)

const directionSchema = z.enum(['IN', 'OUT'], {
  error: STOCK_ERRORS.directionRequired,
})

const reasonSchema = z
  .string({ error: STOCK_ERRORS.reasonRequired })
  .transform(normalizeStockReason)
  .pipe(
    z
      .string()
      .min(1, STOCK_ERRORS.reasonRequired)
      .max(STOCK_REASON_MAX_LENGTH, STOCK_ERRORS.reasonTooLong),
  )

export const stockInitializeSchema = z.object({
  productId: productIdSchema,
  quantities: z
    .array(
      z.object({
        form: formSchema,
        quantity: initialQuantitySchema,
      }),
    )
    .min(1, STOCK_ERRORS.formsRequired),
})

export const stockAdjustSchema = z.object({
  productId: productIdSchema,
  form: formSchema,
  direction: directionSchema,
  quantity: movementQuantitySchema,
  reason: reasonSchema,
})

function toErrorCode(error: z.ZodError, fallback: StockErrorCode): StockErrorCode {
  const message = error.issues[0]?.message

  return STOCK_ERROR_CODES.find((code) => STOCK_ERRORS[code] === message) ?? fallback
}

function parseProductId(value: unknown): number {
  const parsed = productIdSchema.safeParse(value)

  if (!parsed.success) {
    throw new StockError('productNotFound')
  }

  return parsed.data
}

/** The forms a product can hold: one for a simple product, two otherwise. */
function getProductForms(product: Product): string[] {
  return [product.primaryForm, product.secondaryForm].filter(
    (form): form is string => Boolean(form),
  )
}

function assertFormBelongsToProduct(product: Product, form: string): void {
  if (!getProductForms(product).includes(form)) {
    throw new StockError('formInvalid')
  }
}

function loadStockTotals(db: StockDatabase): StockTotals {
  const balanceRows = db
    .select({
      productId: stockMovements.productId,
      form: stockMovements.form,
      quantity: signedQuantityExpression,
    })
    .from(stockMovements)
    .groupBy(stockMovements.productId, stockMovements.form)
    .all()

  const quantityByProductAndForm = new Map<number, Map<string, number>>()

  for (const row of balanceRows) {
    const forms = quantityByProductAndForm.get(row.productId) ?? new Map<string, number>()

    forms.set(row.form, row.quantity)
    quantityByProductAndForm.set(row.productId, forms)
  }

  // A product is initialized as soon as one STOCK_INITIAL exists: an
  // initialization is a single operation, whatever the number of forms.
  const initializedRows = db
    .select({ productId: stockMovements.productId })
    .from(stockMovements)
    .where(eq(stockMovements.movementType, 'STOCK_INITIAL'))
    .all()

  return {
    quantityByProductAndForm,
    initializedProductIds: new Set(initializedRows.map((row) => row.productId)),
  }
}

function toSignedQuantity(direction: StockDirection, quantity: number): number {
  return direction === 'IN' ? quantity : -quantity
}

function toMovement(row: typeof stockMovements.$inferSelect): StockMovement {
  return {
    id: row.id,
    productId: row.productId,
    form: row.form,
    movementType: row.movementType,
    direction: row.direction,
    quantity: row.quantity,
    signedQuantity: toSignedQuantity(row.direction, row.quantity),
    reason: row.reason,
    createdAt: row.createdAt,
  }
}

/**
 * One line per form of the product: the two configured forms first, then the
 * forms that only exist in the history (a form renamed after the initialization
 * keeps its movements and stays visible instead of silently disappearing).
 */
function buildStockLines(product: Product, totals: StockTotals): StockFormLevel[] {
  const isInitialized = totals.initializedProductIds.has(product.id)
  const productForms = getProductForms(product)
  const balances = totals.quantityByProductAndForm.get(product.id)
  const legacyForms = balances
    ? [...balances.keys()]
        .filter((form) => !productForms.includes(form))
        .sort()
    : []

  return [
    ...productForms.map((form) => ({ form, isLegacyForm: false })),
    ...legacyForms.map((form) => ({ form, isLegacyForm: true })),
  ].map(({ form, isLegacyForm }) => ({
    productId: product.id,
    productName: product.name,
    categoryId: product.categoryId,
    categoryName: product.categoryName,
    form,
    quantity: balances?.get(form) ?? 0,
    isInitialized,
    isProductActive: product.isActive,
    isLegacyForm,
  }))
}

/**
 * Stock of every product, one line per form. The rows are derived from the
 * movements (`loadStockTotals`), never from a stored quantity. The product
 * listing (search, category, active filter) is the one already used by the
 * products page, so both pages always agree on which products exist.
 */
export function listStocks(filters: StockFilters = {}): StockFormLevel[] {
  const productList = listProducts(filters)
  const totals = loadStockTotals(getDb())

  return productList.flatMap((product) => buildStockLines(product, totals))
}

export function getProductStock(productId: number): StockFormLevel[] {
  const product = findProduct(parseProductId(productId))

  return buildStockLines(product, loadStockTotals(getDb()))
}

export function getProductFormStock(productId: number, form: string): StockFormLevel {
  const product = findProduct(parseProductId(productId))
  const normalizedForm = normalizeFormName(form ?? '')

  assertFormBelongsToProduct(product, normalizedForm)

  const level = buildStockLines(product, loadStockTotals(getDb())).find(
    (candidate) => candidate.form === normalizedForm,
  )

  if (!level) {
    throw new StockError('formInvalid')
  }

  return level
}

/** True when the product already has its initial stock: the lock of section 10. */
export function isStockInitialized(productId: number): boolean {
  const product = parseProductId(productId)
  const initial = getDb()
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.productId, product),
        eq(stockMovements.movementType, 'STOCK_INITIAL'),
      ),
    )
    .get()

  return Boolean(initial)
}

/**
 * Validates the submitted quantities against the product configuration: every
 * form of the product must be present exactly once, no other form is accepted,
 * and at least one quantity must be strictly positive.
 */
function parseInitialQuantities(
  input: StockInitializeInput,
  product: Product,
): StockFormInput[] {
  const parsed = stockInitializeSchema.safeParse(input)

  if (!parsed.success) {
    throw new StockError(toErrorCode(parsed.error, 'formRequired'))
  }

  const productForms = getProductForms(product)
  const submitted = parsed.data.quantities

  // An unknown form is reported on its own, then a missing form.
  for (const entry of submitted) {
    assertFormBelongsToProduct(product, entry.form)
  }

  if (submitted.length !== productForms.length) {
    throw new StockError('formsMismatch')
  }

  const quantities: StockFormInput[] = []

  for (const form of productForms) {
    const submittedForm = submitted.find((entry) => entry.form === form)

    if (!submittedForm) {
      throw new StockError('formsMismatch')
    }

    quantities.push({ form, quantity: submittedForm.quantity })
  }

  if (quantities.every((entry) => entry.quantity <= 0)) {
    throw new StockError('positiveQuantityRequired')
  }

  return quantities
}

function parseAdjustInput(
  input: StockAdjustInput,
  productId: number,
): Omit<StockAdjustInput, 'productId'> {
  const parsed = stockAdjustSchema.safeParse({ ...input, productId })

  if (!parsed.success) {
    throw new StockError(toErrorCode(parsed.error, 'quantityInvalid'))
  }

  return {
    form: parsed.data.form,
    direction: parsed.data.direction,
    quantity: parsed.data.quantity,
    reason: parsed.data.reason,
  }
}

/**
 * The products module owns the product lookup: its "produit introuvable" error is
 * translated here so the renderer always receives an explicit stock message
 * instead of a generic failure.
 */
function findProduct(productId: number): Product {
  try {
    return getProductById(productId)
  } catch (error) {
    if (error instanceof ProductError && error.code === 'notFound') {
      throw new StockError('productNotFound')
    }

    throw error
  }
}

/**
 * Reads a product for a stock write: a missing product, an inactive product or
 * an unknown form are business errors, never SQL errors.
 */
function readProductForWrite(productId: number): Product {
  const product = findProduct(productId)

  if (!product.isActive) {
    throw new StockError('productInactive')
  }

  return product
}

function computeFormQuantity(db: StockDatabase, productId: number, form: string): number {
  const row = db
    .select({ quantity: signedQuantityExpression })
    .from(stockMovements)
    .where(and(eq(stockMovements.productId, productId), eq(stockMovements.form, form)))
    .get()

  return row?.quantity ?? 0
}

function isInitializedIn(db: StockDatabase, productId: number): boolean {
  const initial = db
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.productId, productId),
        eq(stockMovements.movementType, 'STOCK_INITIAL'),
      ),
    )
    .get()

  return Boolean(initial)
}

/**
 * A translation constraint violation (unique partial index or CHECK) can only be
 * a concurrency or programming issue: it is reported as a business error, and
 * the surrounding transaction is rolled back by better-sqlite3.
 */
function toDatabaseError(error: unknown): StockError | null {
  if (!(error instanceof Error)) {
    return null
  }

  const message = error.message

  if (message.includes('FOREIGN KEY')) {
    return new StockError('productNotFound')
  }

  if (message.includes('stock_movements_initial_unique')) {
    return new StockError('alreadyInitialized')
  }

  if (message.includes('stock_movements_reason_check')) {
    return new StockError('reasonRequired')
  }

  if (message.includes('stock_movements_quantity_check')) {
    return new StockError('quantityInvalid')
  }

  return null
}

function withMappedErrors<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof StockError) {
      throw error
    }

    const mapped = toDatabaseError(error)

    if (mapped) {
      throw mapped
    }

    throw error
  }
}

/**
 * Single, irreversible initialization of a product stock.
 *
 * Everything happens in one SQLite transaction: the STOCK_INITIAL movements are
 * written, the stock is recomputed from those movements and compared with the
 * submitted quantities. Any failure rolls the whole initialization back, so a
 * partial initialization (for instance only the primary form) is impossible.
 */
export function initializeStock(
  productId: number,
  input: StockInitializeInput,
): StockFormLevel[] {
  const parsedId = parseProductId(productId)
  const db = getDb()

  return withMappedErrors(() =>
    db.transaction((tx) => {
      const product = readProductForWrite(parsedId)
      const quantities = parseInitialQuantities(input, product)

      if (isInitializedIn(tx, parsedId)) {
        throw new StockError('alreadyInitialized')
      }

      const now = new Date()

      for (const { form, quantity } of quantities) {
        // A form initialized to 0 carries no movement: 0 is already the balance
        // of a form without any movement.
        if (quantity <= 0) {
          continue
        }

        tx.insert(stockMovements)
          .values({
            productId: parsedId,
            form,
            movementType: 'STOCK_INITIAL',
            direction: 'IN',
            quantity,
            reason: null,
            createdAt: now,
          })
          .run()
      }

      // Coherence check inside the transaction: the recomputed stock must be the
      // requested one, otherwise the transaction is rolled back.
      for (const { form, quantity } of quantities) {
        if (computeFormQuantity(tx, parsedId, form) !== quantity) {
          throw new StockError('unexpected')
        }
      }

      // The new stock is always read back from the movements, never returned
      // from the submitted quantities.
      return buildStockLines(product, loadStockTotals(tx))
    }),
  )
}

/**
 * Manual correction of an existing stock: entrée (IN) or sortie (OUT) on a
 * single form, always with a reason. The stock can never become negative and the
 * movement is kept in the history.
 */
export function adjustStock(
  productId: number,
  input: StockAdjustInput,
): StockAdjustResult {
  const parsedId = parseProductId(productId)
  const parsedInput = parseAdjustInput(input, parsedId)
  const db = getDb()

  return withMappedErrors(() =>
    db.transaction((tx) => {
      const product = readProductForWrite(parsedId)

      assertFormBelongsToProduct(product, parsedInput.form)

      if (!isInitializedIn(tx, parsedId)) {
        throw new StockError('notInitialized')
      }

      const currentQuantity = computeFormQuantity(tx, parsedId, parsedInput.form)
      // Signed delta: positive for an entrée, negative for a sortie.
      const signedDelta = toSignedQuantity(parsedInput.direction, parsedInput.quantity)

      if (currentQuantity + signedDelta < 0) {
        throw new StockError('insufficientStock')
      }

      const inserted = tx
        .insert(stockMovements)
        .values({
          productId: parsedId,
          form: parsedInput.form,
          movementType: 'AJUSTEMENT',
          direction: parsedInput.direction,
          quantity: parsedInput.quantity,
          reason: parsedInput.reason,
          createdAt: new Date(),
        })
        .returning()
        .get()

      if (!inserted) {
        throw new StockError('unexpected')
      }

      const balance = computeFormQuantity(tx, parsedId, parsedInput.form)

      if (balance !== currentQuantity + signedDelta || balance < 0) {
        throw new StockError('unexpected')
      }

      return {
        movement: toMovement(inserted),
        stock: {
          productId: product.id,
          productName: product.name,
          categoryId: product.categoryId,
          categoryName: product.categoryName,
          form: parsedInput.form,
          quantity: balance,
          isInitialized: true,
          isProductActive: product.isActive,
          isLegacyForm: false,
        },
      }
    }),
  )
}

/** History of a product, most recent first. Movements are never modified. */
export function listProductMovements(productId: number): StockMovement[] {
  const product = parseProductId(productId)

  findProduct(product)

  const rows = getDb()
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.productId, product))
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .all()

  return rows.map(toMovement)
}

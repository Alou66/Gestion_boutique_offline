import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { z } from 'zod'
import { clients, payments, products, saleItems, sales, stockMovements } from '../database/schema'
import { getDb, removeDiacritics } from '../database/client'
import type { AppDatabase } from '../database/client'
import { SYSTEM_CLIENT_NAME, SYSTEM_CLIENT_PHONE } from './clientService'
import {
  PRODUCT_FORM_MAX_LENGTH,
  ProductError,
  getProductById,
  normalizeFormName,
} from './productService'
import type {
  Payment,
  PaymentStatus,
  Product,
  Sale,
  SaleCreateInput,
  SaleDetail,
  SaleFilters,
  SaleItem,
  SaleItemInput,
  SalePaymentSummary,
  SaleStatus,
  SaleUpdateInput,
} from '../types'

export const INVOICE_ERRORS = {
  dateRequired: 'La date de la facture est obligatoire.',
  dateInvalid: 'La date doit être au format AAAA-MM-JJ.',
  dateOutOfRange: 'La date doit être comprise entre le 01/01/2000 et le 31/12/2099.',
  itemsRequired: 'Une facture doit contenir au moins un produit.',
  tooManyItems: 'Une facture ne peut pas dépasser 100 lignes.',
  duplicateLine:
    'Un même produit ne peut pas apparaître deux fois avec la même forme. Regroupez les quantités sur une seule ligne.',
  clientNotFound: "Ce client n'existe pas.",
  clientInactive: 'Client inactif : choisissez un client actif ou le client comptant.',
  productNotFound: 'Produit introuvable.',
  productInactive:
    "Produit inactif. Veuillez réactiver le produit avant de le facturer.",
  formRequired: 'La forme est obligatoire.',
  formTooLong: `La forme ne peut pas dépasser ${PRODUCT_FORM_MAX_LENGTH} caractères.`,
  formInvalid: 'Forme invalide pour ce produit.',
  quantityRequired: 'La quantité est obligatoire.',
  quantityInvalid: 'La quantité doit être un entier supérieur à 0.',
  quantityTooHigh: 'La quantité ne peut pas dépasser 1 000 000.',
  unitPriceRequired: "Le prix de vente unitaire est obligatoire.",
  unitPriceInvalid: "Le prix de vente unitaire doit être un entier supérieur ou égal à 0.",
  unitPriceTooHigh: "Le prix de vente unitaire ne peut pas dépasser 1 000 000 000 FCFA.",
  unitPriceNotConfigured:
    "Le prix de vente de ce produit n'est pas configuré pour cette forme : saisissez le prix facturé.",
  insufficientStock: 'Stock insuffisant pour cette facture.',
  paymentRequired: 'Le montant du paiement est obligatoire.',
  paymentInvalid: 'Le montant du paiement doit être un entier supérieur à 0.',
  paymentTooHigh: 'Le montant payé ne peut pas dépasser le total de la facture.',
  paymentNotFound: 'Paiement introuvable.',
  paymentOnCancelledSale: 'Une facture annulée ne peut plus recevoir de paiement.',
  locked:
    'Cette facture a déjà reçu un paiement : son contenu ne peut plus être modifié.',
  alreadyCancelled: 'Cette facture est déjà annulée.',
  cancelNotAllowed: 'Une facture ayant reçu un paiement ne peut pas être annulée.',
  deleteNotAllowed: 'Seule une facture annulée et non payée peut être supprimée.',
  notFound: 'Facture introuvable.',
  referenceConflict: "La référence de la facture est déjà utilisée.",
  totalInvalid: "Le total de la facture est invalide.",
  unexpected: 'Une erreur inattendue est survenue.',
} as const

export type InvoiceErrorCode = keyof typeof INVOICE_ERRORS

export class InvoiceError extends Error {
  readonly code: InvoiceErrorCode

  constructor(code: InvoiceErrorCode) {
    super(INVOICE_ERRORS[code])
    this.name = 'InvoiceError'
    this.code = code
  }
}

export const INVOICE_REFERENCE_PREFIX = 'VTE'
export const INVOICE_REFERENCE_PADDING = 6
export const INVOICE_QUANTITY_MAX = 1_000_000
export const INVOICE_UNIT_PRICE_MAX = 1_000_000_000
export const INVOICE_ITEMS_MAX = 100

const INVOICE_ERROR_CODES = Object.keys(INVOICE_ERRORS) as InvoiceErrorCode[]

/**
 * The ledger is only read here: the balance of a form stays the sum of its
 * movements, exactly like the stock, supply and transformation modules, so the
 * facturation module never introduces a second source of truth for the stock.
 */
type InvoiceDatabase = Pick<AppDatabase, 'select' | 'insert' | 'update' | 'delete'>

/** VTE-000001, VTE-000002, ... */
export function formatInvoiceReference(sequence: number): string {
  return `${INVOICE_REFERENCE_PREFIX}-${String(sequence).padStart(
    INVOICE_REFERENCE_PADDING,
    '0',
  )}`
}

/** The origin of a SALE movement is always the facture that wrote it. */
export function invoiceMovementReason(reference: string): string {
  return `Facture ${reference}`
}

/** The compensating IN movements of an unpaid facture always name it too. */
export function invoiceAdjustmentReason(reference: string, action: string): string {
  return `${action} facture ${reference}`
}

/**
 * `YYYY-MM-DD` -> local midnight Date, the exact same parsing as the supply and
 * transformation modules: a document always displays the same day whatever the
 * time it was created at.
 */
export function parseInvoiceDate(rawDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(rawDate ?? '').trim())

  if (!match) {
    throw new InvoiceError('dateInvalid')
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
    throw new InvoiceError('dateInvalid')
  }

  if (year < 2000 || year > 2099) {
    throw new InvoiceError('dateOutOfRange')
  }

  return date
}

/** Today as `YYYY-MM-DD`, the default date of a new document. */
export function todayAsInvoiceDate(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const clientIdSchema = z
  .number({ error: INVOICE_ERRORS.clientNotFound })
  .int(INVOICE_ERRORS.clientNotFound)
  .positive(INVOICE_ERRORS.clientNotFound)

const productIdSchema = z
  .number({ error: INVOICE_ERRORS.productNotFound })
  .int(INVOICE_ERRORS.productNotFound)
  .positive(INVOICE_ERRORS.productNotFound)

const formSchema = z
  .string({ error: INVOICE_ERRORS.formRequired })
  .transform(normalizeFormName)
  .pipe(
    z
      .string()
      .min(1, INVOICE_ERRORS.formRequired)
      .max(PRODUCT_FORM_MAX_LENGTH, INVOICE_ERRORS.formTooLong),
  )

const quantitySchema = z
  .number({ error: INVOICE_ERRORS.quantityRequired })
  .int(INVOICE_ERRORS.quantityInvalid)
  .positive(INVOICE_ERRORS.quantityInvalid)
  .max(INVOICE_QUANTITY_MAX, INVOICE_ERRORS.quantityTooHigh)

const unitPriceSchema = z
  .number({ error: INVOICE_ERRORS.unitPriceRequired })
  .int(INVOICE_ERRORS.unitPriceInvalid)
  .min(0, INVOICE_ERRORS.unitPriceInvalid)
  .max(INVOICE_UNIT_PRICE_MAX, INVOICE_ERRORS.unitPriceTooHigh)

/** Absent or null: the price configured on the product is copied instead. */
const optionalUnitPriceSchema = unitPriceSchema.nullable().optional()

const itemsSchema = z
  .array(
    z.object({
      productId: productIdSchema,
      form: formSchema,
      quantity: quantitySchema,
      unitPrice: optionalUnitPriceSchema,
    }),
  )
  .min(1, INVOICE_ERRORS.itemsRequired)
  .max(INVOICE_ITEMS_MAX, INVOICE_ERRORS.tooManyItems)

/** The payment amount has its own messages: it is not a sale price. */
const paymentAmountSchema = z
  .number({ error: INVOICE_ERRORS.paymentRequired })
  .int(INVOICE_ERRORS.paymentInvalid)
  .positive(INVOICE_ERRORS.paymentInvalid)
  .max(INVOICE_UNIT_PRICE_MAX, INVOICE_ERRORS.paymentTooHigh)

export const saleItemInputSchema = itemsSchema.element

export const invoiceCreateSchema = z.object({
  clientId: clientIdSchema.nullish(),
  date: z.string().nullish(),
  items: itemsSchema,
})

export const invoiceUpdateSchema = invoiceCreateSchema.partial({ items: true })

export const invoicePaymentSchema = z.object({
  amount: paymentAmountSchema,
  date: z.string().nullish(),
})

function toErrorCode(error: z.ZodError, fallback: InvoiceErrorCode): InvoiceErrorCode {
  const message = error.issues[0]?.message

  return INVOICE_ERROR_CODES.find((code) => INVOICE_ERRORS[code] === message) ?? fallback
}

/** The forms a product can hold: one for a simple product, two otherwise. */
export function getProductForms(product: Product): string[] {
  return [product.primaryForm, product.secondaryForm].filter(
    (form): form is string => Boolean(form),
  )
}

/**
 * The form really belongs to the product: SAC for a simple product, CARTON or
 * SEAU for a transformable one. A form that is not configured is a business
 * error, never a SQL error, and no conversion is ever applied.
 */
function assertFormBelongsToProduct(product: Product, form: string): void {
  if (!getProductForms(product).includes(form)) {
    throw new InvoiceError('formInvalid')
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
      throw new InvoiceError('productNotFound')
    }

    throw error
  }
}

/**
 * The configured sale price of the form really sold: `secondary_sale_price` for
 * the secondary form of a transformable product, `sale_price` otherwise. It is
 * only a default: any price typed by the shopkeeper wins, and the price of the
 * product never changes an existing facture.
 */
export function getProductSalePrice(product: Product, form: string): number | null {
  const isSecondary = Boolean(
    product.secondaryForm && product.secondaryForm === form,
  )
  const price = isSecondary ? product.secondarySalePrice : product.salePrice

  return typeof price === 'number' && Number.isInteger(price) && price >= 0 ? price : null
}

/** A line of a facture: the price is a snapshot taken when the line is written. */
interface ResolvedLine {
  productId: number
  form: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

const signedQuantityExpression: SQL<number> = sql<number>`coalesce(sum(case when ${stockMovements.direction} = 'IN' then ${stockMovements.quantity} else -${stockMovements.quantity} end), 0)`

function computeFormQuantity(
  db: InvoiceDatabase,
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

function lineKey(productId: number, form: string): string {
  return `${productId}|${form}`
}

/**
 * Products are re-read inside the transaction: a product deactivated between the
 * validation and the write can never be sold, and the form really sold is
 * always one of its own forms. The price of each line is resolved here, once.
 */
function resolveLines(items: SaleItemInput[]): ResolvedLine[] {
  return items.map((item) => {
    const product = findProduct(item.productId)

    if (!product.isActive) {
      throw new InvoiceError('productInactive')
    }

    assertFormBelongsToProduct(product, item.form)

    const typedPrice = typeof item.unitPrice === 'number' ? item.unitPrice : null

    if (typedPrice === null) {
      const configuredPrice = getProductSalePrice(product, item.form)

      if (configuredPrice === null) {
        throw new InvoiceError('unitPriceNotConfigured')
      }

      return {
        productId: product.id,
        form: item.form,
        quantity: item.quantity,
        unitPrice: configuredPrice,
        lineTotal: item.quantity * configuredPrice,
      }
    }

    return {
      productId: product.id,
      form: item.form,
      quantity: item.quantity,
      unitPrice: typedPrice,
      lineTotal: item.quantity * typedPrice,
    }
  })
}

/** Same product, same form, twice on one facture: the lines must be merged. */
function assertNoDuplicateLines(items: SaleItemInput[]): void {
  const seen = new Set<string>()

  for (const item of items) {
    const key = lineKey(item.productId, item.form)

    if (seen.has(key)) {
      throw new InvoiceError('duplicateLine')
    }

    seen.add(key)
  }
}

/**
 * A price that is not a number at all is refused with the price message, not
 * with the generic "the facture has no valid line" one: the renderer receives
 * the same message whether the price was negative or typed as text.
 */
function assertUnitPriceTypes(items: SaleItemInput[]): void {
  for (const item of items) {
    const unitPrice = item.unitPrice

    if (
      unitPrice !== undefined &&
      unitPrice !== null &&
      (typeof unitPrice !== 'number' || Number.isNaN(unitPrice))
    ) {
      throw new InvoiceError('unitPriceInvalid')
    }
  }
}

/**
 * A facture always has a client. When none is selected, the single system client
 * "CLIENT COMPTANT" is used: it is created once and never duplicated.
 */
function ensureSystemClientIn(db: InvoiceDatabase): number {
  const existing = db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.name, SYSTEM_CLIENT_NAME))
    .get()

  if (existing) {
    return existing.id
  }

  const now = new Date()
  const inserted = db
    .insert(clients)
    .values({
      name: SYSTEM_CLIENT_NAME,
      phone: SYSTEM_CLIENT_PHONE,
      address: null,
      isActive: true,
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: clients.id })
    .get()

  if (!inserted) {
    throw new InvoiceError('unexpected')
  }

  return inserted.id
}

/** The selected client must exist and be active. */
function resolveClientId(db: InvoiceDatabase, clientId: number | null | undefined): number {
  if (clientId === undefined || clientId === null) {
    return ensureSystemClientIn(db)
  }

  const row = db
    .select({ id: clients.id, isActive: clients.isActive })
    .from(clients)
    .where(eq(clients.id, clientId))
    .get()

  if (!row) {
    throw new InvoiceError('clientNotFound')
  }

  if (!row.isActive) {
    throw new InvoiceError('clientInactive')
  }

  return row.id
}

/**
 * Next free sequence number, read from the last document inside the transaction
 * so the reference and the document are written together. `max(id) + 1` is
 * never a duplicate: the reference follows the autoincrement id, so it stays
 * correct after a cancellation and even after a facture was physically deleted.
 */
function nextReferenceSequence(db: InvoiceDatabase): number {
  const last = db.select({ id: sales.id }).from(sales).orderBy(desc(sales.id)).limit(1).get()

  return (last?.id ?? 0) + 1
}

const saleColumns = {
  id: sales.id,
  reference: sales.reference,
  clientId: sales.clientId,
  clientName: clients.name,
  saleDate: sales.saleDate,
  status: sales.status,
  totalAmount: sales.totalAmount,
  createdAt: sales.createdAt,
  updatedAt: sales.updatedAt,
}

type SaleRow = {
  id: number
  reference: string
  clientId: number
  clientName: string
  saleDate: Date
  status: SaleStatus
  totalAmount: number
  createdAt: Date
  updatedAt: Date
}

function findSaleRow(db: InvoiceDatabase, id: number): SaleRow | null {
  return (
    db
      .select(saleColumns)
      .from(sales)
      .innerJoin(clients, eq(sales.clientId, clients.id))
      .where(eq(sales.id, id))
      .get() ?? null
  )
}

/**
 * The payment status is never stored: it is always recomputed from the payments
 * against the total of the facture. The amount paid can never exceed the total,
 * so the remaining amount is never negative either.
 */
export function computePaymentStatus(
  totalAmount: number,
  paidAmount: number,
): PaymentStatus {
  if (paidAmount <= 0) {
    return 'NON_PAYEE'
  }

  return paidAmount >= totalAmount ? 'PAYEE' : 'PARTIELLEMENT_PAYEE'
}

function computePaidAmount(db: InvoiceDatabase, saleId: number): number {
  const row = db
    .select({ paid: sql<number>`coalesce(sum(${payments.amount}), 0)` })
    .from(payments)
    .where(eq(payments.saleId, saleId))
    .get()

  return row?.paid ?? 0
}

function computePaymentSummary(
  db: InvoiceDatabase,
  totalAmount: number,
  saleId: number,
): SalePaymentSummary {
  const paidAmount = computePaidAmount(db, saleId)

  return {
    paidAmount,
    remainingAmount: Math.max(0, totalAmount - paidAmount),
    status: computePaymentStatus(totalAmount, paidAmount),
  }
}

function toSale(row: SaleRow, summary: SalePaymentSummary): Sale {
  return {
    ...row,
    paidAmount: summary.paidAmount,
    remainingAmount: summary.remainingAmount,
    paymentStatus: summary.status,
  }
}

function selectItems(db: InvoiceDatabase, saleId: number): SaleItem[] {
  return db
    .select({
      id: saleItems.id,
      saleId: saleItems.saleId,
      productId: saleItems.productId,
      productName: products.name,
      form: saleItems.form,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      lineTotal: saleItems.lineTotal,
    })
    .from(saleItems)
    .innerJoin(products, eq(saleItems.productId, products.id))
    .where(eq(saleItems.saleId, saleId))
    .orderBy(asc(saleItems.id))
    .all()
}

function buildDetail(db: InvoiceDatabase, row: SaleRow): SaleDetail {
  const summary = computePaymentSummary(db, row.totalAmount, row.id)

  return {
    ...toSale(row, summary),
    items: selectItems(db, row.id),
    paymentSummary: summary,
  }
}

function buildSale(db: InvoiceDatabase, row: SaleRow): Sale {
  return toSale(row, computePaymentSummary(db, row.totalAmount, row.id))
}

/** Accent and case insensitive LIKE pattern, like the other modules. */
function buildContainsPattern(rawSearch: string): string {
  const search = removeDiacritics(rawSearch.trim()).toLowerCase().replace(/\s+/g, ' ')

  return `%${search.replace(/[\\%_]/g, '\\$&')}%`
}

/** One grouped query instead of one sub query per facture. */
function computePaidBySale(db: InvoiceDatabase): Map<number, number> {
  const rows = db
    .select({ saleId: payments.saleId, paid: sql<number>`coalesce(sum(${payments.amount}), 0)` })
    .from(payments)
    .groupBy(payments.saleId)
    .all()

  return new Map(rows.map((row) => [row.saleId, row.paid]))
}

/** History of the factures, most recent first. */
export function listInvoices(filters: SaleFilters = {}): Sale[] {
  const conditions = []

  if (typeof filters?.search === 'string' && filters.search.trim()) {
    conditions.push(
      sql`unaccent(lower(${sales.reference})) like ${
        buildContainsPattern(filters.search)
      } escape '\\'`,
    )
  }

  if (typeof filters?.clientSearch === 'string' && filters.clientSearch.trim()) {
    conditions.push(
      sql`unaccent(lower(${clients.name})) like ${
        buildContainsPattern(filters.clientSearch)
      } escape '\\'`,
    )
  }

  if (typeof filters?.clientId === 'number') {
    conditions.push(eq(sales.clientId, filters.clientId))
  }

  if (typeof filters?.status === 'string') {
    conditions.push(eq(sales.status, filters.status))
  }

  const db = getDb()
  const rows = db
    .select(saleColumns)
    .from(sales)
    .innerJoin(clients, eq(sales.clientId, clients.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sales.id))
    .all()
  const paidBySale = computePaidBySale(db)

  return rows.map((row) => {
    const paidAmount = paidBySale.get(row.id) ?? 0

    return toSale(row, {
      paidAmount,
      remainingAmount: Math.max(0, row.totalAmount - paidAmount),
      status: computePaymentStatus(row.totalAmount, paidAmount),
    })
  })
}

export function getInvoiceById(id: number): SaleDetail {
  const saleId = Number(id)

  if (!Number.isInteger(saleId) || saleId <= 0) {
    throw new InvoiceError('notFound')
  }

  const db = getDb()
  const row = findSaleRow(db, saleId)

  if (!row) {
    throw new InvoiceError('notFound')
  }

  return buildDetail(db, row)
}

/** Detail by reference (VTE-000001), used by the detail view. */
export function getInvoiceByReference(reference: string): SaleDetail {
  const normalized = String(reference ?? '')
    .trim()
    .toUpperCase()
  const db = getDb()
  const row = db
    .select(saleColumns)
    .from(sales)
    .innerJoin(clients, eq(sales.clientId, clients.id))
    .where(eq(sales.reference, normalized))
    .get()

  if (!row) {
    throw new InvoiceError('notFound')
  }

  return buildDetail(db, row)
}

/**
 * SQLite constraint violations never reach the shopkeeper: they are translated
 * into business errors, anything else keeps bubbling up to be logged by the IPC
 * layer as an unexpected error.
 */
function toDatabaseError(error: unknown): InvoiceError | null {
  if (!(error instanceof Error)) {
    return null
  }

  const message = error.message

  if (message.includes('sales_reference_unique')) {
    return new InvoiceError('referenceConflict')
  }

  if (message.includes('sale_items_sale_product_form_unique')) {
    return new InvoiceError('duplicateLine')
  }

  if (message.includes('sale_items_quantity_check')) {
    return new InvoiceError('quantityInvalid')
  }

  if (message.includes('sale_items_unit_price_check')) {
    return new InvoiceError('unitPriceInvalid')
  }

  if (
    message.includes('sale_items_line_total_check') ||
    message.includes('sales_total_amount_check')
  ) {
    return new InvoiceError('totalInvalid')
  }

  if (message.includes('payments_amount_check')) {
    return new InvoiceError('paymentInvalid')
  }

  if (
    message.includes('stock_movements_sale_reason_check') ||
    message.includes('stock_movements_sale_direction_check') ||
    message.includes('stock_movements_type_check')
  ) {
    return new InvoiceError('unexpected')
  }

  if (message.includes('FOREIGN KEY')) {
    return new InvoiceError('clientNotFound')
  }

  return null
}

function withMappedErrors<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof InvoiceError) {
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
function parsePayload(input: SaleCreateInput | SaleUpdateInput): {
  items: SaleItemInput[]
  /** undefined when the client was not submitted at all. */
  clientId: number | null | undefined
  date: Date | undefined
} {
  const rawInput = input ?? ({} as SaleCreateInput)
  assertUnitPriceTypes(Array.isArray(rawInput.items) ? rawInput.items : [])
  const parsed = invoiceCreateSchema.safeParse({
    // null is a real choice (the system client), undefined means "not submitted".
    clientId: rawInput.clientId,
    date: rawInput.date,
    items: rawInput.items,
  })

  if (!parsed.success) {
    throw new InvoiceError(toErrorCode(parsed.error, 'itemsRequired'))
  }

  assertNoDuplicateLines(parsed.data.items)

  const rawDate =
    typeof rawInput.date === 'string' && rawInput.date.trim() ? rawInput.date : null

  return {
    items: parsed.data.items,
    clientId: parsed.data.clientId,
    date: rawDate === null ? undefined : parseInvoiceDate(rawDate),
  }
}

/** Same parsed values as `parsePayload`, used by the payment operations. */
function parsePaymentInput(
  amount: number,
  paymentDate?: string | null,
): { amount: number; date: Date } {
  const parsed = invoicePaymentSchema.safeParse({
    amount,
    date: typeof paymentDate === 'string' && paymentDate.trim() ? paymentDate : undefined,
  })

  if (!parsed.success) {
    throw new InvoiceError(toErrorCode(parsed.error, 'paymentInvalid'))
  }

  const rawDate =
    typeof paymentDate === 'string' && paymentDate.trim() ? paymentDate : null

  return {
    amount: parsed.data.amount,
    date: rawDate === null ? parseInvoiceDate(todayAsInvoiceDate()) : parseInvoiceDate(rawDate),
  }
}

/**
 * The stock of the sold forms is checked in the transaction, before any write:
 * a form is available when its balance covers the quantity of the facture. The
 * movements of the facture itself are only added afterwards, so a product can
 * never leave the shop with a negative stock.
 */
function assertStockIsAvailable(db: InvoiceDatabase, lines: ResolvedLine[]): void {
  for (const line of lines) {
    if (computeFormQuantity(db, line.productId, line.form) - line.quantity < 0) {
      throw new InvoiceError('insufficientStock')
    }
  }
}

/**
 * Stock check of an update of an unpaid facture. The stock already carries the
 * effect of the previous version of this facture, so its own quantity is
 * temporarily given back: the effective available stock of a form is
 * `balance + previous quantity`, and the new quantity must fit in it.
 */
function assertUpdatedStockIsAvailable(
  db: InvoiceDatabase,
  lines: ResolvedLine[],
  previousQuantities: Map<string, number>,
): void {
  for (const line of lines) {
    const givenBack = previousQuantities.get(lineKey(line.productId, line.form)) ?? 0
    const available = computeFormQuantity(db, line.productId, line.form) + givenBack

    if (available - line.quantity < 0) {
      throw new InvoiceError('insufficientStock')
    }
  }
}

function writeMovement(
  db: InvoiceDatabase,
  values: {
    productId: number
    form: string
    movementType: 'SALE' | 'AJUSTEMENT'
    direction: 'IN' | 'OUT'
    quantity: number
    reason: string
    createdAt: Date
  },
): void {
  db.insert(stockMovements).values(values).run()
}

/**
 * The only stock movements an update of an unpaid facture is allowed to write:
 * the difference between the previous quantity and the new one.
 *
 * A bigger quantity is more stock leaving the shop, and stays a SALE: it is
 * still this facture that removes it. A smaller quantity gives a stock back,
 * which is a correction carrying the facture as its reason. In both cases the
 * previous movements are left untouched.
 */
function writeCompensatingMovement(
  db: InvoiceDatabase,
  values: {
    productId: number
    form: string
    /** Positive to remove more stock, negative to give stock back. */
    delta: number
    reference: string
    createdAt: Date
  },
): void {
  const before = computeFormQuantity(db, values.productId, values.form)

  writeMovement(db, {
    productId: values.productId,
    form: values.form,
    movementType: values.delta > 0 ? 'SALE' : 'AJUSTEMENT',
    direction: values.delta > 0 ? 'OUT' : 'IN',
    quantity: Math.abs(values.delta),
    reason:
      values.delta > 0
        ? invoiceMovementReason(values.reference)
        : invoiceAdjustmentReason(values.reference, 'Modification'),
    createdAt: values.createdAt,
  })

  const after = computeFormQuantity(db, values.productId, values.form)

  // A positive delta removes stock, a negative one gives it back.
  if (after !== before - values.delta || after < 0) {
    throw new InvoiceError('unexpected')
  }
}

/**
 * Writes the lines of a facture and updates its header total. The amounts are
 * always recomputed by the service: what the renderer sent is never trusted.
 */
function writeLines(
  db: InvoiceDatabase,
  saleId: number,
  lines: ResolvedLine[],
): number {
  db.delete(saleItems).where(eq(saleItems.saleId, saleId)).run()

  let totalAmount = 0

  for (const line of lines) {
    const lineTotal = line.quantity * line.unitPrice

    db.insert(saleItems)
      .values({
        saleId,
        productId: line.productId,
        form: line.form,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal,
      })
      .run()

    totalAmount += lineTotal
  }

  const stored = db
    .select({ total: sql<number>`coalesce(sum(${saleItems.lineTotal}), 0)` })
    .from(saleItems)
    .where(eq(saleItems.saleId, saleId))
    .get()

  // The header total must be the exact sum of its own persisted lines.
  if ((stored?.total ?? -1) !== totalAmount || totalAmount < 0) {
    throw new InvoiceError('totalInvalid')
  }

  return totalAmount
}

/**
 * Creates and validates a facture in one single SQLite transaction:
 *
 * 1. structural validation of the payload (dates, forms, quantities, prices)
 * 2. the client is checked, or the system client "CLIENT COMPTANT" is used
 * 3. every product is re-read: it must exist, be active and own the sold form
 * 4. the price of each line is resolved: the price configured on the product is
 *    copied into the line, unless the shopkeeper typed another one
 * 5. the stock of each sold form is recomputed from `stock_movements` and must
 *    cover the quantity: no form is ever converted automatically and the stock
 *    can never become negative
 * 6. the reference VTE-XXXXXX is generated inside the same transaction
 * 7. the facture is inserted, its lines are written and its total is recomputed
 * 8. the SALE OUT movements are written, one per line, each one naming the
 *    facture in its reason
 *
 * Any failure rolls everything back: a partial facture (a header without its
 * lines or its movements) is impossible.
 */
export function createInvoice(input: SaleCreateInput): SaleDetail {
  const { items, clientId, date } = parsePayload(input)
  const db = getDb()

  return withMappedErrors(() =>
    db.transaction((tx) => {
      const resolvedClientId = resolveClientId(tx, clientId)
      const lines = resolveLines(items)

      assertStockIsAvailable(tx, lines)

      const now = new Date()
      const reference = formatInvoiceReference(nextReferenceSequence(tx))

      const inserted = tx
        .insert(sales)
        .values({
          reference,
          clientId: resolvedClientId,
          saleDate: date ?? parseInvoiceDate(todayAsInvoiceDate(now)),
          status: 'VALIDEE',
          // Placeholder: the real total is the sum of the persisted lines,
          // computed below and written back before the commit.
          totalAmount: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: sales.id })
        .get()

      if (!inserted) {
        throw new InvoiceError('unexpected')
      }

      const saleId = inserted.id
      const totalAmount = writeLines(tx, saleId, lines)

      tx.update(sales)
        .set({ totalAmount })
        .where(eq(sales.id, saleId))
        .run()

      for (const line of lines) {
        const before = computeFormQuantity(tx, line.productId, line.form)

        writeMovement(tx, {
          productId: line.productId,
          form: line.form,
          movementType: 'SALE',
          direction: 'OUT',
          quantity: line.quantity,
          reason: invoiceMovementReason(reference),
          createdAt: now,
        })

        const after = computeFormQuantity(tx, line.productId, line.form)

        // The movement must lower the balance of exactly the sold form, by
        // exactly the sold quantity, and never below zero.
        if (after !== before - line.quantity || after < 0) {
          throw new InvoiceError('unexpected')
        }
      }

      const row = findSaleRow(tx, saleId)

      if (!row) {
        throw new InvoiceError('unexpected')
      }

      return buildDetail(tx, row)
    }),
  )
}

/** One form of a facture, with the quantity it currently holds. */
interface PersistedLineQuantity {
  productId: number
  form: string
  quantity: number
}

/**
 * Reads the persisted lines of a facture, the previous version of its content,
 * indexed by product and form.
 */
function readPersistedLineQuantities(
  db: InvoiceDatabase,
  saleId: number,
): Map<string, PersistedLineQuantity> {
  const rows = db
    .select({
      productId: saleItems.productId,
      form: saleItems.form,
      quantity: saleItems.quantity,
    })
    .from(saleItems)
    .where(eq(saleItems.saleId, saleId))
    .all()

  return new Map(
    rows.map((row) => [
      lineKey(row.productId, row.form),
      { productId: row.productId, form: row.form, quantity: row.quantity },
    ]),
  )
}

/**
 * Modifies an unpaid facture, in one single SQLite transaction:
 *
 * 1. the facture must exist and still be VALIDEE
 * 2. it must carry no payment at all: as soon as it received one, its client,
 *    its products, its forms, its quantities and its prices are locked
 * 3. the client, the products, the forms and the prices are validated exactly
 *    like at creation
 * 4. the stock is checked as if the previous quantities were temporarily given
 *    back: `available = balance + previous quantity`
 * 5. only the difference is written in `stock_movements`, which stays
 *    append-only: the movements of the previous version are never modified nor
 *    deleted. A bigger quantity is an additional SALE OUT, a smaller one is an
 *    AJUSTEMENT IN naming the facture, and a change of product or form gives
 *    back the old line and takes the new one
 * 6. the lines and the total are recomputed by the service
 *
 * Any failure rolls everything back.
 */
export function updateInvoice(id: number, input: SaleUpdateInput): SaleDetail {
  const saleId = Number(id)

  if (!Number.isInteger(saleId) || saleId <= 0) {
    throw new InvoiceError('notFound')
  }

  const { items, clientId, date } = parsePayload(input)
  const db = getDb()

  return withMappedErrors(() =>
    db.transaction((tx) => {
      const row = findSaleRow(tx, saleId)

      if (!row) {
        throw new InvoiceError('notFound')
      }

      if (row.status === 'ANNULEE') {
        throw new InvoiceError('alreadyCancelled')
      }

      // The commercial content is locked as soon as the facture received a
      // payment, even partially: the payments themselves stay editable.
      if (computePaidAmount(tx, saleId) > 0) {
        throw new InvoiceError('locked')
      }

      const previousLines = readPersistedLineQuantities(tx, saleId)
      const resolvedClientId =
        clientId === undefined ? row.clientId : resolveClientId(tx, clientId)
      const lines = resolveLines(items)
      const previousQuantities = new Map<string, number>()

      for (const [key, previous] of previousLines) {
        previousQuantities.set(key, previous.quantity)
      }

      assertUpdatedStockIsAvailable(tx, lines, previousQuantities)

      const now = new Date()
      const nextLines = new Map<string, PersistedLineQuantity>(
        lines.map((line) => [
          lineKey(line.productId, line.form),
          { productId: line.productId, form: line.form, quantity: line.quantity },
        ]),
      )
      const totalAmount = writeLines(tx, saleId, lines)

      tx.update(sales)
        .set({
          clientId: resolvedClientId,
          saleDate: date ?? row.saleDate,
          totalAmount,
          updatedAt: now,
        })
        .where(eq(sales.id, saleId))
        .run()

      // Compensating movements only: the difference between the previous lines
      // and the new ones, for every form of the facture.
      for (const next of nextLines.values()) {
        const previousQuantity =
          previousQuantities.get(lineKey(next.productId, next.form)) ?? 0
        const delta = next.quantity - previousQuantity

        if (delta === 0) {
          continue
        }

        writeCompensatingMovement(tx, {
          productId: next.productId,
          form: next.form,
          delta,
          reference: row.reference,
          createdAt: now,
        })
      }

      // A line that disappeared gives its whole quantity back.
      for (const previous of previousLines.values()) {
        if (nextLines.has(lineKey(previous.productId, previous.form))) {
          continue
        }

        writeCompensatingMovement(tx, {
          productId: previous.productId,
          form: previous.form,
          delta: -previous.quantity,
          reference: row.reference,
          createdAt: now,
        })
      }

      const updated = findSaleRow(tx, saleId)

      if (!updated) {
        throw new InvoiceError('unexpected')
      }

      return buildDetail(tx, updated)
    }),
  )
}

/**
 * Cancels a facture that received no payment at all, in one single transaction:
 * the stock it took out is given back with AJUSTEMENT IN movements naming the
 * facture, then the status becomes ANNULEE. The SALE movements of the creation
 * are never modified nor deleted: `stock_movements` stays append-only.
 *
 * A partially paid or a paid facture can never be cancelled: the money received
 * has to be settled by the payments first.
 */
export function cancelInvoice(id: number): Sale {
  const saleId = Number(id)

  if (!Number.isInteger(saleId) || saleId <= 0) {
    throw new InvoiceError('notFound')
  }

  const db = getDb()

  return withMappedErrors(() =>
    db.transaction((tx) => {
      const row = findSaleRow(tx, saleId)

      if (!row) {
        throw new InvoiceError('notFound')
      }

      if (row.status === 'ANNULEE') {
        throw new InvoiceError('alreadyCancelled')
      }

      if (computePaidAmount(tx, saleId) > 0) {
        throw new InvoiceError('cancelNotAllowed')
      }

      const now = new Date()
      const lines = tx
        .select({
          productId: saleItems.productId,
          form: saleItems.form,
          quantity: saleItems.quantity,
        })
        .from(saleItems)
        .where(eq(saleItems.saleId, saleId))
        .all()

      for (const line of lines) {
        const before = computeFormQuantity(tx, line.productId, line.form)

        writeMovement(tx, {
          productId: line.productId,
          form: line.form,
          movementType: 'AJUSTEMENT',
          direction: 'IN',
          quantity: line.quantity,
          reason: invoiceAdjustmentReason(row.reference, 'Annulation'),
          createdAt: now,
        })

        const after = computeFormQuantity(tx, line.productId, line.form)

        if (after !== before + line.quantity || after < 0) {
          throw new InvoiceError('unexpected')
        }
      }

      tx.update(sales)
        .set({ status: 'ANNULEE', updatedAt: now })
        .where(eq(sales.id, saleId))
        .run()

      const updated = findSaleRow(tx, saleId)

      if (!updated) {
        throw new InvoiceError('unexpected')
      }

      return buildSale(tx, updated)
    }),
  )
}

/**
 * Physically deletes a cancelled facture and its lines, in one transaction. A
 * VALIDEE facture can never be deleted, whatever its payments: it must be
 * cancelled first, and a cancellation is only possible when it carries no
 * payment at all. The historical movements of `stock_movements` are never
 * deleted: the stock history outlives the document.
 */
export function deleteInvoice(id: number): null {
  const saleId = Number(id)

  if (!Number.isInteger(saleId) || saleId <= 0) {
    throw new InvoiceError('notFound')
  }

  const db = getDb()

  return withMappedErrors(() =>
    db.transaction((tx) => {
      const row = findSaleRow(tx, saleId)

      if (!row) {
        throw new InvoiceError('notFound')
      }

      if (row.status !== 'ANNULEE' || computePaidAmount(tx, saleId) > 0) {
        throw new InvoiceError('deleteNotAllowed')
      }

      tx.delete(saleItems).where(eq(saleItems.saleId, saleId)).run()
      tx.delete(payments).where(eq(payments.saleId, saleId)).run()
      tx.delete(sales).where(eq(sales.id, saleId)).run()

      const remainingItems = tx
        .select({ count: sql<number>`count(*)` })
        .from(saleItems)
        .where(eq(saleItems.saleId, saleId))
        .get()
      const remainingPayments = tx
        .select({ count: sql<number>`count(*)` })
        .from(payments)
        .where(eq(payments.saleId, saleId))
        .get()

      if (
        findSaleRow(tx, saleId) ||
        (remainingItems?.count ?? -1) !== 0 ||
        (remainingPayments?.count ?? -1) !== 0
      ) {
        throw new InvoiceError('unexpected')
      }

      return null
    }),
  )
}

/** The payments of a facture, most recent first. */
export function listInvoicePayments(saleId: number): Payment[] {
  const id = Number(saleId)

  if (!Number.isInteger(id) || id <= 0 || !findSaleRow(getDb(), id)) {
    throw new InvoiceError('notFound')
  }

  return getDb()
    .select()
    .from(payments)
    .where(eq(payments.saleId, id))
    .orderBy(desc(payments.id))
    .all()
}

/** Payment status recomputed on demand, never stored. */
export function getInvoicePaymentSummary(saleId: number): SalePaymentSummary {
  const id = Number(saleId)

  if (!Number.isInteger(id) || id <= 0) {
    throw new InvoiceError('notFound')
  }

  const db = getDb()
  const row = findSaleRow(db, id)

  if (!row) {
    throw new InvoiceError('notFound')
  }

  return computePaymentSummary(db, row.totalAmount, id)
}

/**
 * Records a payment on a facture, in one transaction. There is no payment
 * method in this version: only the amount and the date are stored.
 *
 * The facture must exist, must not be cancelled, and the total of its payments
 * must never exceed its total: the amount paid can never be greater than the
 * amount due.
 */
export function addPayment(
  saleId: number,
  amount: number,
  paymentDate?: string | null,
): Payment {
  const id = Number(saleId)

  if (!Number.isInteger(id) || id <= 0) {
    throw new InvoiceError('notFound')
  }

  const input = parsePaymentInput(amount, paymentDate)
  const db = getDb()

  return withMappedErrors(() =>
    db.transaction((tx) => {
      const row = findSaleRow(tx, id)

      if (!row) {
        throw new InvoiceError('notFound')
      }

      if (row.status === 'ANNULEE') {
        throw new InvoiceError('paymentOnCancelledSale')
      }

      const paidAmount = computePaidAmount(tx, id)

      if (paidAmount + input.amount > row.totalAmount) {
        throw new InvoiceError('paymentTooHigh')
      }

      const now = new Date()
      const inserted = tx
        .insert(payments)
        .values({
          saleId: id,
          amount: input.amount,
          paymentDate: input.date,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()

      if (!inserted) {
        throw new InvoiceError('unexpected')
      }

      return inserted
    }),
  )
}

/**
 * Modifies a payment, in one transaction. The amount is checked against the
 * total of the facture excluding the payment being modified, so replacing it
 * never counts it twice. Payments stay editable whatever the payment status of
 * the facture, even when it is fully paid.
 */
export function updatePayment(
  paymentId: number,
  amount: number,
  paymentDate?: string | null,
): Payment {
  const id = Number(paymentId)

  if (!Number.isInteger(id) || id <= 0) {
    throw new InvoiceError('paymentNotFound')
  }

  const input = parsePaymentInput(amount, paymentDate)
  const db = getDb()

  return withMappedErrors(() =>
    db.transaction((tx) => {
      const existing = tx
        .select()
        .from(payments)
        .where(eq(payments.id, id))
        .get()

      if (!existing) {
        throw new InvoiceError('paymentNotFound')
      }

      const row = findSaleRow(tx, existing.saleId)

      if (!row) {
        throw new InvoiceError('notFound')
      }

      if (row.status === 'ANNULEE') {
        throw new InvoiceError('paymentOnCancelledSale')
      }

      // The old amount is excluded before the new one is checked.
      const paidAmount = computePaidAmount(tx, existing.saleId) - existing.amount

      if (paidAmount + input.amount > row.totalAmount) {
        throw new InvoiceError('paymentTooHigh')
      }

      const updated = tx
        .update(payments)
        .set({
          amount: input.amount,
          paymentDate: paymentDate === undefined || paymentDate === null
            ? existing.paymentDate
            : input.date,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, id))
        .returning()
        .get()

      if (!updated) {
        throw new InvoiceError('paymentNotFound')
      }

      return updated
    }),
  )
}

/**
 * Deletes a payment, in one transaction. The payment status, the amount paid and
 * the remaining amount are always recomputed afterwards: none of them is stored.
 */
export function deletePayment(paymentId: number): null {
  const id = Number(paymentId)

  if (!Number.isInteger(id) || id <= 0) {
    throw new InvoiceError('paymentNotFound')
  }

  const db = getDb()

  return withMappedErrors(() =>
    db.transaction((tx) => {
      const existing = tx
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.id, id))
        .get()

      if (!existing) {
        throw new InvoiceError('paymentNotFound')
      }

      tx.delete(payments).where(eq(payments.id, id)).run()

      const remaining = tx
        .select({ count: sql<number>`count(*)` })
        .from(payments)
        .where(eq(payments.id, id))
        .get()

      if ((remaining?.count ?? -1) !== 0) {
        throw new InvoiceError('unexpected')
      }

      return null
    }),
  )
}

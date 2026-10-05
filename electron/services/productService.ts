import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { categories, products } from '../database/schema'
import { getDb, removeDiacritics } from '../database/client'
import type {
  Product,
  ProductFilters,
  ProductInput,
  ProductUpdateInput,
} from '../types'

export const PRODUCT_ERRORS = {
  nameRequired: 'Le nom du produit est obligatoire.',
  nameTooShort: 'Le nom du produit doit contenir au moins 2 caractères.',
  nameTooLong: 'Le nom du produit ne peut pas dépasser 120 caractères.',
  duplicate: 'Ce produit existe déjà.',
  categoryRequired: 'La catégorie du produit est obligatoire.',
  categoryNotFound: "Cette catégorie n'existe pas.",
  notFound: "Ce produit n'existe pas.",
  purchasePriceInvalid: "Le prix d'achat doit être un entier supérieur ou égal à 0.",
  purchasePriceTooHigh: "Le prix d'achat ne peut pas dépasser 1 000 000 000 FCFA.",
  salePriceInvalid: 'Le prix de vente doit être un entier supérieur ou égal à 0.',
  salePriceTooHigh: 'Le prix de vente ne peut pas dépasser 1 000 000 000 FCFA.',
  primaryFormRequired: 'La forme principale est obligatoire.',
  primaryFormTooLong: 'La forme principale ne peut pas dépasser 40 caractères.',
  secondaryFormRequired: 'La forme secondaire est obligatoire.',
  secondaryFormTooLong: 'La forme secondaire ne peut pas dépasser 40 caractères.',
  formsMustDiffer: 'La forme principale et la forme secondaire doivent être différentes.',
  conversionQuantityRequired: 'La quantité de conversion est obligatoire.',
  conversionQuantityInvalid: 'La quantité de conversion doit être un entier supérieur à 0.',
  secondarySalePriceRequired: 'Le prix de vente secondaire est obligatoire.',
  secondarySalePriceInvalid:
    'Le prix de vente secondaire doit être un entier supérieur ou égal à 0.',
  secondarySalePriceTooHigh:
    'Le prix de vente secondaire ne peut pas dépasser 1 000 000 000 FCFA.',
  unexpected: 'Une erreur inattendue est survenue.',
} as const

export type ProductErrorCode = keyof typeof PRODUCT_ERRORS

export class ProductError extends Error {
  readonly code: ProductErrorCode

  constructor(code: ProductErrorCode) {
    super(PRODUCT_ERRORS[code])
    this.name = 'ProductError'
    this.code = code
  }
}

export const PRODUCT_NAME_MIN_LENGTH = 2
export const PRODUCT_NAME_MAX_LENGTH = 120
export const PRODUCT_FORM_MAX_LENGTH = 40
export const PRODUCT_PRICE_MAX = 1_000_000_000
export const PRODUCT_CONVERSION_QUANTITY_MAX = 1_000_000

const PRODUCT_ERROR_CODES = Object.keys(PRODUCT_ERRORS) as ProductErrorCode[]

/**
 * Product names follow the same convention as categories: they are trimmed,
 * inner blanks collapsed and stored upper cased ("Chocopain 5 kg" ->
 * "CHOCOPAIN 5 KG"). This keeps the database name and the unique index
 * comparable without any case handling in the renderer.
 */
export function normalizeProductName(rawName: string): string {
  return rawName.trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * Builds a LIKE pattern for searches, or null when the search is empty.
 * The term is lower cased, unaccented and escaped so the comparison happens in
 * SQLite (`unaccent(lower(column)) like ?`) instead of in the renderer.
 */
export function buildSearchPattern(rawSearch: string): string | null {
  const search = removeDiacritics(rawSearch.trim()).toLowerCase().replace(/\s+/g, ' ')

  if (!search) {
    return null
  }

  return `%${search.replace(/[\\%_]/g, '\\$&')}%`
}

/** Form labels are configuration, not user text: they are stored upper cased. */
export function normalizeFormName(rawForm: string): string {
  return rawForm.trim().replace(/\s+/g, ' ').toUpperCase()
}

const productNameSchema = z
  .string({ error: PRODUCT_ERRORS.nameRequired })
  .transform(normalizeProductName)
  .pipe(
    z
      .string()
      .min(1, PRODUCT_ERRORS.nameRequired)
      .max(PRODUCT_NAME_MAX_LENGTH, PRODUCT_ERRORS.nameTooLong)
      .refine(
        (name) => name.length >= PRODUCT_NAME_MIN_LENGTH,
        PRODUCT_ERRORS.nameTooShort,
      ),
  )

const categoryIdSchema = z
  .number({ error: PRODUCT_ERRORS.categoryRequired })
  .int(PRODUCT_ERRORS.categoryRequired)
  .positive(PRODUCT_ERRORS.categoryRequired)

const purchasePriceSchema = z
  .number({ error: PRODUCT_ERRORS.purchasePriceInvalid })
  .int(PRODUCT_ERRORS.purchasePriceInvalid)
  .min(0, PRODUCT_ERRORS.purchasePriceInvalid)
  .max(PRODUCT_PRICE_MAX, PRODUCT_ERRORS.purchasePriceTooHigh)

const salePriceSchema = z
  .number({ error: PRODUCT_ERRORS.salePriceInvalid })
  .int(PRODUCT_ERRORS.salePriceInvalid)
  .min(0, PRODUCT_ERRORS.salePriceInvalid)
  .max(PRODUCT_PRICE_MAX, PRODUCT_ERRORS.salePriceTooHigh)

const secondarySalePriceSchema = z
  .number({ error: PRODUCT_ERRORS.secondarySalePriceRequired })
  .int(PRODUCT_ERRORS.secondarySalePriceInvalid)
  .min(0, PRODUCT_ERRORS.secondarySalePriceInvalid)
  .max(PRODUCT_PRICE_MAX, PRODUCT_ERRORS.secondarySalePriceTooHigh)

const conversionQuantitySchema = z
  .number({ error: PRODUCT_ERRORS.conversionQuantityRequired })
  .int(PRODUCT_ERRORS.conversionQuantityInvalid)
  .positive(PRODUCT_ERRORS.conversionQuantityInvalid)
  .max(
    PRODUCT_CONVERSION_QUANTITY_MAX,
    PRODUCT_ERRORS.conversionQuantityInvalid,
  )

function buildFormSchema(
  requiredMessage: string,
  tooLongMessage: string,
) {
  return z
    .string({ error: requiredMessage })
    .transform(normalizeFormName)
    .pipe(z.string().min(1, requiredMessage).max(PRODUCT_FORM_MAX_LENGTH, tooLongMessage))
}

const primaryFormSchema = buildFormSchema(
  PRODUCT_ERRORS.primaryFormRequired,
  PRODUCT_ERRORS.primaryFormTooLong,
)

const secondaryFormSchema = buildFormSchema(
  PRODUCT_ERRORS.secondaryFormRequired,
  PRODUCT_ERRORS.secondaryFormTooLong,
)

const productIdSchema = z
  .number({ error: PRODUCT_ERRORS.notFound })
  .int()
  .positive()

const isActiveSchema = z.boolean()

const simpleProductSchema = z.object({
  name: productNameSchema,
  categoryId: categoryIdSchema,
  purchasePrice: purchasePriceSchema,
  salePrice: salePriceSchema,
  isTransformable: z.literal(false),
  primaryForm: primaryFormSchema,
})

const transformableProductSchema = z.object({
  name: productNameSchema,
  categoryId: categoryIdSchema,
  purchasePrice: purchasePriceSchema,
  salePrice: salePriceSchema,
  isTransformable: z.literal(true),
  primaryForm: primaryFormSchema,
  secondaryForm: secondaryFormSchema,
  conversionQuantity: conversionQuantitySchema,
  secondarySalePrice: secondarySalePriceSchema,
})

type ParsedProduct = {
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

function toErrorCode(error: z.ZodError, fallback: ProductErrorCode): ProductErrorCode {
  const message = error.issues[0]?.message

  return PRODUCT_ERROR_CODES.find((code) => PRODUCT_ERRORS[code] === message) ?? fallback
}

/**
 * Conditional business rules live here, not in the renderer:
 * a simple product never carries transformation data (all NULL) and a
 * transformable product requires both forms, the conversion quantity and the
 * secondary sale price. Forms are compared after normalization.
 */
function parseProduct(input: ProductInput | ProductUpdateInput): ParsedProduct {
  const raw = input ?? ({} as ProductInput)
  const common = {
    name: raw.name,
    categoryId: raw.categoryId,
    purchasePrice: raw.purchasePrice,
    salePrice: raw.salePrice,
  }

  if (raw.isTransformable === true) {
    const parsed = transformableProductSchema.safeParse({
      ...common,
      isTransformable: true,
      primaryForm: raw.primaryForm,
      secondaryForm: raw.secondaryForm,
      conversionQuantity: raw.conversionQuantity,
      secondarySalePrice: raw.secondarySalePrice,
    })

    if (!parsed.success) {
      throw new ProductError(toErrorCode(parsed.error, 'primaryFormRequired'))
    }

    if (parsed.data.primaryForm === parsed.data.secondaryForm) {
      throw new ProductError('formsMustDiffer')
    }

    return {
      name: parsed.data.name,
      categoryId: parsed.data.categoryId,
      purchasePrice: parsed.data.purchasePrice,
      salePrice: parsed.data.salePrice,
      isTransformable: true,
      primaryForm: parsed.data.primaryForm,
      secondaryForm: parsed.data.secondaryForm,
      conversionQuantity: parsed.data.conversionQuantity,
      secondarySalePrice: parsed.data.secondarySalePrice,
    }
  }

  const parsed = simpleProductSchema.safeParse({
    ...common,
    isTransformable: false,
    primaryForm: raw.primaryForm,
  })

  if (!parsed.success) {
    throw new ProductError(toErrorCode(parsed.error, 'nameRequired'))
  }

  return {
    name: parsed.data.name,
    categoryId: parsed.data.categoryId,
    purchasePrice: parsed.data.purchasePrice,
    salePrice: parsed.data.salePrice,
    isTransformable: false,
    // A simple product has exactly one logical form (its primary form), which is
    // the unit the stock is counted in.
    primaryForm: parsed.data.primaryForm,
    secondaryForm: null,
    conversionQuantity: null,
    secondarySalePrice: null,
  }
}

function parseProductId(id: unknown): number {
  const parsed = productIdSchema.safeParse(id)

  if (!parsed.success) {
    throw new ProductError('notFound')
  }

  return parsed.data
}

const productColumns = {
  id: products.id,
  name: products.name,
  categoryId: products.categoryId,
  categoryName: categories.name,
  purchasePrice: products.purchasePrice,
  salePrice: products.salePrice,
  isTransformable: products.isTransformable,
  primaryForm: products.primaryForm,
  secondaryForm: products.secondaryForm,
  conversionQuantity: products.conversionQuantity,
  secondarySalePrice: products.secondarySalePrice,
  isActive: products.isActive,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
}

type ProductRow = {
  id: number
  name: string
  categoryId: number
  categoryName: string
  purchasePrice: number
  salePrice: number
  isTransformable: boolean
  primaryForm: string | null
  secondaryForm: string | null
  conversionQuantity: number | null
  secondarySalePrice: number | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    purchasePrice: row.purchasePrice,
    salePrice: row.salePrice,
    isTransformable: row.isTransformable,
    primaryForm: row.primaryForm,
    secondaryForm: row.secondaryForm,
    conversionQuantity: row.conversionQuantity,
    secondarySalePrice: row.secondarySalePrice,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function selectProductById(id: number): Product | null {
  const row = getDb()
    .select(productColumns)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.id, id))
    .get()

  return row ?? null
}

function assertCategoryExists(categoryId: number): void {
  const category = getDb()
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get()

  if (!category) {
    throw new ProductError('categoryNotFound')
  }
}

/**
 * Row id of the product already using this name, ignoring `excludeId`.
 * Mirrors the `products_name_unique` index (lower(name)) so a duplicate is
 * reported as a business error before SQLite rejects the write.
 */
function findByName(name: string, excludeId?: number) {
  const conditions = [sql`lower(${products.name}) = lower(${name})`]

  if (excludeId) {
    conditions.push(ne(products.id, excludeId))
  }

  return getDb()
    .select({ id: products.id })
    .from(products)
    .where(and(...conditions))
    .get()
}

function assertNameIsAvailable(name: string, excludeId?: number): void {
  if (findByName(name, excludeId)) {
    throw new ProductError('duplicate')
  }
}

function isDatabaseError(error: unknown): error is Error {
  return error instanceof Error
}

/**
 * SQLite constraint violations never reach the shopkeeper: they are translated
 * into business errors, anything else keeps bubbling up to be logged by the IPC
 * layer as an unexpected error.
 */
function toDatabaseError(error: unknown): ProductError | null {
  if (!isDatabaseError(error)) {
    return null
  }

  const message = error.message

  if (message.includes('UNIQUE')) {
    return new ProductError('duplicate')
  }

  if (message.includes('FOREIGN KEY')) {
    return new ProductError('categoryNotFound')
  }

  if (message.includes('products_purchase_price_check')) {
    return new ProductError('purchasePriceInvalid')
  }

  if (message.includes('products_sale_price_check')) {
    return new ProductError('salePriceInvalid')
  }

  return null
}

function withMappedErrors<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof ProductError) {
      throw error
    }

    const mapped = toDatabaseError(error)

    if (mapped) {
      throw mapped
    }

    throw error
  }
}

export function listProducts(filters: ProductFilters = {}): Product[] {
  const conditions = []

  if (typeof filters?.search === 'string') {
    const pattern = buildSearchPattern(filters.search)

    if (pattern) {
      conditions.push(
        sql`unaccent(lower(${products.name})) like ${pattern} escape '\\'`,
      )
    }
  }

  if (typeof filters?.categorySearch === 'string') {
    const pattern = buildSearchPattern(filters.categorySearch)

    if (pattern) {
      conditions.push(
        sql`unaccent(lower(${categories.name})) like ${pattern} escape '\\'`,
      )
    }
  }

  if (typeof filters?.categoryId === 'number') {
    conditions.push(eq(products.categoryId, filters.categoryId))
  }

  if (typeof filters?.isActive === 'boolean') {
    conditions.push(eq(products.isActive, filters.isActive))
  }

  const rows = getDb()
    .select(productColumns)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(products.name))
    .all()

  return rows.map(toProduct)
}

export function getProductById(id: number): Product {
  const productId = parseProductId(id)
  const product = selectProductById(productId)

  if (!product) {
    throw new ProductError('notFound')
  }

  return product
}

export function createProduct(input: ProductInput): Product {
  const parsed = parseProduct(input)
  const now = new Date()

  assertCategoryExists(parsed.categoryId)
  assertNameIsAvailable(parsed.name)

  return withMappedErrors(() => {
    const inserted = getDb()
      .insert(products)
      .values({ ...parsed, createdAt: now, updatedAt: now })
      .returning({ id: products.id })
      .get()

    if (!inserted) {
      throw new ProductError('unexpected')
    }

    return getProductById(inserted.id)
  })
}

export function updateProduct(id: number, input: ProductUpdateInput): Product {
  const productId = parseProductId(id)
  const parsed = parseProduct(input)

  const existing = getDb()
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId))
    .get()

  if (!existing) {
    throw new ProductError('notFound')
  }

  assertCategoryExists(parsed.categoryId)
  assertNameIsAvailable(parsed.name, productId)

  return withMappedErrors(() => {
    getDb()
      .update(products)
      .set({ ...parsed, updatedAt: new Date() })
      .where(eq(products.id, productId))
      .run()

    return getProductById(productId)
  })
}

export function setProductActive(id: number, isActive: boolean): Product {
  const productId = parseProductId(id)
  const parsedActive = isActiveSchema.safeParse(isActive)

  if (!parsedActive.success) {
    throw new ProductError('unexpected')
  }

  const existing = getDb()
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId))
    .get()

  if (!existing) {
    throw new ProductError('notFound')
  }

  getDb()
    .update(products)
    .set({ isActive: parsedActive.data, updatedAt: new Date() })
    .where(eq(products.id, productId))
    .run()

  return getProductById(productId)
}

/** True when the category is already referenced by at least one product. */
export function isCategoryUsedByProducts(categoryId: number): boolean {
  const usage = getDb()
    .select({ id: products.id })
    .from(products)
    .where(eq(products.categoryId, categoryId))
    .get()

  return Boolean(usage)
}

/**
 * Real-time uniqueness check used by the form while the shopkeeper types.
 * The name is normalized first ("riz  parfumé" -> "RIZ PARFUMÉ") and
 * `excludeId` lets an edited product keep its own name. Too short names answer
 * false without any query: the renderer simply shows nothing in that case.
 */
export function isNameAvailable(name: string, excludeId?: number): boolean {
  if (!name || name.trim().length < PRODUCT_NAME_MIN_LENGTH) {
    return false
  }

  return !findByName(normalizeProductName(name.trim()), excludeId)
}

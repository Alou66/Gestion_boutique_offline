import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { categories } from '../database/schema'
import { getDb } from '../database/client'
import { isCategoryUsedByProducts } from './productService'
import type { Category, CategoryInput, CategoryUpdateInput } from '../types'

export const CATEGORY_ERRORS = {
  nameRequired: 'Le nom de la catégorie est obligatoire.',
  nameTooShort: 'Le nom de la catégorie doit contenir au moins 2 caractères.',
  nameTooLong: 'Le nom de la catégorie ne peut pas dépasser 60 caractères.',
  duplicate: 'Cette catégorie existe déjà.',
  notFound: "Cette catégorie n'existe pas.",
  inUse: 'Cette catégorie est utilisée par un ou plusieurs produits et ne peut pas être supprimée.',
  unexpected: 'Une erreur inattendue est survenue.',
} as const

export type CategoryErrorCode = keyof typeof CATEGORY_ERRORS

export class CategoryError extends Error {
  readonly code: CategoryErrorCode

  constructor(code: CategoryErrorCode) {
    super(CATEGORY_ERRORS[code])
    this.name = 'CategoryError'
    this.code = code
  }
}

export const CATEGORY_NAME_MIN_LENGTH = 2
export const CATEGORY_NAME_MAX_LENGTH = 60

const CATEGORY_ERROR_CODES = Object.keys(CATEGORY_ERRORS) as CategoryErrorCode[]

export const categoryNameSchema = z
  .string({ error: CATEGORY_ERRORS.nameRequired })
  .trim()
  .min(1, CATEGORY_ERRORS.nameRequired)
  .max(CATEGORY_NAME_MAX_LENGTH, CATEGORY_ERRORS.nameTooLong)
  .refine((name) => name.length >= CATEGORY_NAME_MIN_LENGTH, CATEGORY_ERRORS.nameTooShort)

export const categorySchema = z.object({
  name: categoryNameSchema,
})

export const categoryIdSchema = z
  .number({ error: CATEGORY_ERRORS.notFound })
  .int()
  .positive()

/**
 * Single source of truth for name normalization: trim + collapse inner blanks +
 * upper case, exactly like the clients. "  boissons " and "BOISSONS" are the
 * same name. Applied in the main process before any write, so the database only
 * ever stores normalized names and uniqueness comparisons are done on that form.
 */
export function normalizeCategoryName(rawName: string): string {
  return rawName.trim().replace(/\s+/g, ' ').toUpperCase()
}

function toErrorCode(error: z.ZodError, fallback: CategoryErrorCode): CategoryErrorCode {
  const message = error.issues[0]?.message

  return CATEGORY_ERROR_CODES.find((code) => CATEGORY_ERRORS[code] === message) ?? fallback
}

function parseCategoryName(input: CategoryInput | CategoryUpdateInput): string {
  const parsed = categorySchema.safeParse(input)

  if (!parsed.success) {
    throw new CategoryError(toErrorCode(parsed.error, 'nameRequired'))
  }

  return normalizeCategoryName(parsed.data.name)
}

function parseCategoryId(id: unknown): number {
  const parsed = categoryIdSchema.safeParse(id)

  if (!parsed.success) {
    throw new CategoryError('notFound')
  }

  return parsed.data
}

function toCategory(row: typeof categories.$inferSelect): Category {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Row id of the category already using this name, ignoring `excludeId`.
 * The comparison is case insensitive because the name is normalized before any
 * comparison, on write and on check.
 */
function findByName(name: string, excludeId?: number) {
  const conditions = [sql`lower(${categories.name}) = ${name.toLowerCase()}`]

  if (excludeId) {
    conditions.push(ne(categories.id, excludeId))
  }

  return getDb()
    .select({ id: categories.id })
    .from(categories)
    .where(and(...conditions))
    .get()
}

function assertNameIsAvailable(name: string, excludeId?: number): void {
  if (findByName(name, excludeId)) {
    throw new CategoryError('duplicate')
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE')
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('FOREIGN KEY')
}

export function listCategories(): Category[] {
  const rows = getDb().select().from(categories).orderBy(asc(categories.name)).all()
  return rows.map(toCategory)
}

export function getCategoryById(id: number): Category | null {
  const categoryId = parseCategoryId(id)
  const row = getDb().select().from(categories).where(eq(categories.id, categoryId)).get()
  return row ? toCategory(row) : null
}

export function createCategory(input: CategoryInput): Category {
  const name = parseCategoryName(input)
  const db = getDb()
  const now = new Date()

  assertNameIsAvailable(name)

  try {
    return toCategory(
      db.insert(categories).values({ name, createdAt: now, updatedAt: now }).returning().get(),
    )
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CategoryError('duplicate')
    }
    throw error
  }
}

export function updateCategory(id: number, input: CategoryUpdateInput): Category {
  const categoryId = parseCategoryId(id)
  const name = parseCategoryName(input)
  const db = getDb()

  if (!db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).get()) {
    throw new CategoryError('notFound')
  }

  assertNameIsAvailable(name, categoryId)

  try {
    const updated = db
      .update(categories)
      .set({ name, updatedAt: new Date() })
      .where(eq(categories.id, categoryId))
      .returning()
      .get()

    if (!updated) {
      throw new CategoryError('notFound')
    }

    return toCategory(updated)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CategoryError('duplicate')
    }
    throw error
  }
}

export function deleteCategory(id: number): null {
  const categoryId = parseCategoryId(id)
  const db = getDb()

  if (!db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).get()) {
    throw new CategoryError('notFound')
  }

  // A category referenced by a product is never deleted: the products keep their
  // history and the FK is ON DELETE restrict. The explicit check only exists to
  // return the business error before SQLite refuses the statement.
  if (isCategoryUsedByProducts(categoryId)) {
    throw new CategoryError('inUse')
  }

  try {
    db.delete(categories).where(eq(categories.id, categoryId)).run()
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new CategoryError('inUse')
    }
    throw error
  }

  return null
}

/**
 * Real-time uniqueness check used by the form while the shopkeeper types.
 * The name is normalized first (" boissons " -> "BOISSONS") and `excludeId`
 * lets an edited category keep its own name. Too short names answer false
 * without any query: the renderer simply shows nothing in that case.
 */
export function isNameAvailable(name: string, excludeId?: number): boolean {
  if (!name || name.trim().length < CATEGORY_NAME_MIN_LENGTH) {
    return false
  }

  return !findByName(normalizeCategoryName(name.trim()), excludeId)
}

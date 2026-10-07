import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { suppliers } from '../database/schema'
import { getDb } from '../database/client'
import type {
  Supplier,
  SupplierFilters,
  SupplierInput,
  SupplierUpdateInput,
} from '../types'

export const SUPPLIER_ERRORS = {
  nameRequired: 'Le nom du fournisseur est obligatoire.',
  nameTooShort: 'Le nom du fournisseur doit contenir au moins 2 caractères.',
  nameTooLong: 'Le nom du fournisseur ne peut pas dépasser 120 caractères.',
  phoneRequired: 'Le téléphone du fournisseur est obligatoire.',
  phoneTooShort: 'Le numéro de téléphone doit contenir au moins 9 chiffres.',
  phoneTooLong: 'Le numéro de téléphone ne peut pas dépasser 20 caractères.',
  phoneInvalid: 'Le numéro de téléphone est invalide.',
  addressTooLong: "L'adresse ne peut pas dépasser 255 caractères.",
  duplicateName: 'Ce nom de fournisseur existe déjà.',
  duplicatePhone: 'Ce numéro de téléphone est déjà utilisé.',
  notFound: "Ce fournisseur n'existe pas.",
  systemSupplierImmutable: 'Le fournisseur système ne peut pas être modifié.',
  systemSupplierCannotDeactivate: 'Le fournisseur système ne peut pas être désactivé.',
  unexpected: 'Une erreur inattendue est survenue.',
} as const

export type SupplierErrorCode = keyof typeof SUPPLIER_ERRORS

export class SupplierError extends Error {
  readonly code: SupplierErrorCode

  constructor(code: SupplierErrorCode) {
    super(SUPPLIER_ERRORS[code])
    this.name = 'SupplierError'
    this.code = code
  }
}

export const SUPPLIER_NAME_MIN_LENGTH = 2
export const SUPPLIER_NAME_MAX_LENGTH = 120
export const SUPPLIER_PHONE_MIN_DIGITS = 9
export const SUPPLIER_PHONE_MAX_LENGTH = 20
export const SUPPLIER_ADDRESS_MAX_LENGTH = 255
export const SYSTEM_SUPPLIER_NAME = 'FOURNISSEUR COMPTANT'
export const SYSTEM_SUPPLIER_PHONE = '000-000-0000'

const SUPPLIER_ERROR_CODES = Object.keys(SUPPLIER_ERRORS) as SupplierErrorCode[]

/**
 * Single source of truth for name normalization: trim + collapse spaces + upper case.
 * Applied in the main process before any write, so the database only ever
 * stores normalized names and uniqueness comparisons are done on that form.
 */
export function normalizeSupplierName(rawName: string): string {
  return rawName.trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * Phone normalization: remove all non-digit characters except + at start,
 * then ensure it's a valid Senegalese phone format.
 * This ensures that "77 123 45 67", "771234567", "+221771234567" are treated as the same.
 */
export function normalizePhone(rawPhone: string): string {
  const cleaned = rawPhone.trim().replace(/[\s\-().]/g, '')

  if (cleaned.startsWith('+221')) {
    return cleaned
  }

  if (cleaned.startsWith('221') && cleaned.length === 12) {
    return '+' + cleaned
  }

  if (/^\d{9}$/.test(cleaned)) {
    return '+221' + cleaned
  }

  return cleaned
}

export function isValidSenegalesePhone(phone: string): boolean {
  const normalized = normalizePhone(phone)
  return /^\+221\d{9}$/.test(normalized) || /^\d{9}$/.test(normalized)
}

function toErrorCode(error: z.ZodError, fallback: SupplierErrorCode): SupplierErrorCode {
  const message = error.issues[0]?.message

  return SUPPLIER_ERROR_CODES.find((code) => SUPPLIER_ERRORS[code] === message) ?? fallback
}

function parseSupplierName(input: SupplierInput | SupplierUpdateInput): string {
  const nameSchema = z
    .string({ error: SUPPLIER_ERRORS.nameRequired })
    .trim()
    .min(1, SUPPLIER_ERRORS.nameRequired)
    .max(SUPPLIER_NAME_MAX_LENGTH, SUPPLIER_ERRORS.nameTooLong)
    .refine((name) => name.length >= SUPPLIER_NAME_MIN_LENGTH, SUPPLIER_ERRORS.nameTooShort)

  const parsed = nameSchema.safeParse(input.name)

  if (!parsed.success) {
    throw new SupplierError(toErrorCode(parsed.error, 'nameRequired'))
  }

  return normalizeSupplierName(parsed.data)
}

function parseSupplierPhone(input: SupplierInput | SupplierUpdateInput): string {
  const phoneSchema = z
    .string({ error: SUPPLIER_ERRORS.phoneRequired })
    .trim()
    .min(1, SUPPLIER_ERRORS.phoneRequired)
    .max(SUPPLIER_PHONE_MAX_LENGTH, SUPPLIER_ERRORS.phoneTooLong)

  const parsed = phoneSchema.safeParse(input.phone)

  if (!parsed.success) {
    throw new SupplierError(toErrorCode(parsed.error, 'phoneRequired'))
  }

  const normalized = normalizePhone(parsed.data)

  if (!isValidSenegalesePhone(normalized)) {
    throw new SupplierError('phoneInvalid')
  }

  return normalized
}

function parseSupplierAddress(input: SupplierInput | SupplierUpdateInput): string | null {
  if (input.address === undefined || input.address === null || input.address.trim() === '') {
    return null
  }

  const addressSchema = z
    .string()
    .trim()
    .max(SUPPLIER_ADDRESS_MAX_LENGTH, SUPPLIER_ERRORS.addressTooLong)

  const parsed = addressSchema.safeParse(input.address)

  if (!parsed.success) {
    throw new SupplierError(toErrorCode(parsed.error, 'addressTooLong'))
  }

  const trimmed = parsed.data.trim()
  return trimmed === '' ? null : trimmed
}

function parseSupplierId(id: unknown): number {
  const idSchema = z.number({ error: SUPPLIER_ERRORS.notFound }).int().positive()

  const parsed = idSchema.safeParse(id)

  if (!parsed.success) {
    throw new SupplierError('notFound')
  }

  return parsed.data
}

function toSupplier(row: typeof suppliers.$inferSelect): Supplier {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    isActive: Boolean(row.isActive),
    isSystem: Boolean(row.isSystem),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function assertNameIsAvailable(name: string, excludeId?: number): void {
  const nameLower = name.toLowerCase()
  const conditions = [sql`lower(${suppliers.name}) = ${nameLower}`]

  if (excludeId) {
    conditions.push(ne(suppliers.id, excludeId))
  }

  const duplicate = getDb()
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(...conditions))
    .get()

  if (duplicate) {
    throw new SupplierError('duplicateName')
  }
}

function assertPhoneIsAvailable(phone: string, excludeId?: number): void {
  const conditions = [eq(suppliers.phone, phone)]

  if (excludeId) {
    conditions.push(ne(suppliers.id, excludeId))
  }

  const duplicate = getDb()
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(...conditions))
    .get()

  if (duplicate) {
    throw new SupplierError('duplicatePhone')
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE')
}

export function listSuppliers(filters: SupplierFilters = {}): Supplier[] {
  const conditions = []

  if (typeof filters?.search === 'string' && filters.search.trim()) {
    const pattern = `%${filters.search.trim().toLowerCase().replace(/[\\%_]/g, '\\$&')}%`
    conditions.push(sql`lower(${suppliers.name}) like ${pattern} escape '\\'`)
  }

  if (typeof filters?.phoneSearch === 'string' && filters.phoneSearch.trim()) {
    const pattern = `%${filters.phoneSearch.trim().replace(/[\\%_]/g, '\\$&')}%`
    conditions.push(sql`${suppliers.phone} like ${pattern} escape '\\'`)
  }

  if (typeof filters?.isActive === 'boolean') {
    conditions.push(eq(suppliers.isActive, filters.isActive))
  }

  const rows = getDb()
    .select()
    .from(suppliers)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(suppliers.name))
    .all()

  return rows.map(toSupplier)
}

export function getSupplierById(id: number): Supplier | null {
  const supplierId = parseSupplierId(id)
  const row = getDb().select().from(suppliers).where(eq(suppliers.id, supplierId)).get()
  return row ? toSupplier(row) : null
}

export function createSupplier(input: SupplierInput): Supplier {
  const name = parseSupplierName(input)
  const phone = parseSupplierPhone(input)
  const address = parseSupplierAddress(input)
  const db = getDb()
  const now = new Date()

  if (name === SYSTEM_SUPPLIER_NAME) {
    throw new SupplierError('duplicateName')
  }

  assertNameIsAvailable(name)
  assertPhoneIsAvailable(phone)

  try {
    const inserted = db
      .insert(suppliers)
      .values({ name, phone, address, isActive: true, isSystem: false, createdAt: now, updatedAt: now })
      .returning({ id: suppliers.id })
      .get()

    if (!inserted) {
      throw new SupplierError('unexpected')
    }

    return getSupplierById(inserted.id)!
  } catch (error) {
    if (isUniqueViolation(error)) {
      const message = (error as Error).message
      if (message.includes('suppliers_name_unique')) {
        throw new SupplierError('duplicateName')
      }
      if (message.includes('suppliers_phone_unique')) {
        throw new SupplierError('duplicatePhone')
      }
      throw new SupplierError('duplicateName')
    }
    throw error
  }
}

export function updateSupplier(id: number, input: SupplierUpdateInput): Supplier {
  const supplierId = parseSupplierId(id)
  const db = getDb()

  const existing = db.select({ id: suppliers.id, isSystem: suppliers.isSystem }).from(suppliers).where(eq(suppliers.id, supplierId)).get()

  if (!existing) {
    throw new SupplierError('notFound')
  }

  if (existing.isSystem) {
    throw new SupplierError('systemSupplierImmutable')
  }

  const name = parseSupplierName(input)
  const phone = parseSupplierPhone(input)
  const address = parseSupplierAddress(input)

  if (name === SYSTEM_SUPPLIER_NAME) {
    throw new SupplierError('duplicateName')
  }

  assertNameIsAvailable(name, supplierId)
  assertPhoneIsAvailable(phone, supplierId)

  try {
    const updated = db
      .update(suppliers)
      .set({ name, phone, address, updatedAt: new Date() })
      .where(eq(suppliers.id, supplierId))
      .returning({ id: suppliers.id })
      .get()

    if (!updated) {
      throw new SupplierError('notFound')
    }

    return getSupplierById(supplierId)!
  } catch (error) {
    if (isUniqueViolation(error)) {
      const message = (error as Error).message
      if (message.includes('suppliers_name_unique')) {
        throw new SupplierError('duplicateName')
      }
      if (message.includes('suppliers_phone_unique')) {
        throw new SupplierError('duplicatePhone')
      }
      throw new SupplierError('duplicateName')
    }
    throw error
  }
}

export function setSupplierActive(id: number, isActive: boolean): Supplier {
  const supplierId = parseSupplierId(id)
  const db = getDb()

  const existing = db.select({ id: suppliers.id, isSystem: suppliers.isSystem }).from(suppliers).where(eq(suppliers.id, supplierId)).get()

  if (!existing) {
    throw new SupplierError('notFound')
  }

  if (existing.isSystem && !isActive) {
    throw new SupplierError('systemSupplierCannotDeactivate')
  }

  db.update(suppliers).set({ isActive, updatedAt: new Date() }).where(eq(suppliers.id, supplierId)).run()

  return getSupplierById(supplierId)!
}

export function isNameAvailable(name: string, excludeSupplierId?: number): boolean {
  if (!name || name.trim().length < SUPPLIER_NAME_MIN_LENGTH) {
    return false
  }

  const normalized = normalizeSupplierName(name.trim())
  const normalizedLower = normalized.toLowerCase()
  const duplicate = excludeSupplierId
    ? getDb()
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(sql`lower(${suppliers.name}) = ${normalizedLower}`, ne(suppliers.id, excludeSupplierId)))
        .get()
    : getDb().select({ id: suppliers.id }).from(suppliers).where(sql`lower(${suppliers.name}) = ${normalizedLower}`).get()

  return !duplicate
}

export function isPhoneAvailable(phone: string, excludeSupplierId?: number): boolean {
  if (!phone || phone.trim().length < SUPPLIER_PHONE_MIN_DIGITS) {
    return false
  }

  const normalized = normalizePhone(phone.trim())
  if (!isValidSenegalesePhone(normalized)) {
    return false
  }

  const duplicate = excludeSupplierId
    ? getDb()
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.phone, normalized), ne(suppliers.id, excludeSupplierId)))
        .get()
    : getDb().select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.phone, normalized)).get()

  return !duplicate
}

/**
 * Ensures the system supplier "FOURNISSEUR COMPTANT" exists.
 * Creates it if it doesn't exist.
 * Returns the system supplier.
 */
export function ensureSystemSupplier(): Supplier {
  const existing = getDb()
    .select()
    .from(suppliers)
    .where(eq(suppliers.name, SYSTEM_SUPPLIER_NAME))
    .get()

  if (existing) {
    return toSupplier(existing)
  }

  const db = getDb()
  const now = new Date()

  const inserted = db
    .insert(suppliers)
    .values({
      name: SYSTEM_SUPPLIER_NAME,
      phone: SYSTEM_SUPPLIER_PHONE,
      address: null,
      isActive: true,
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: suppliers.id })
    .get()

  if (!inserted) {
    throw new SupplierError('unexpected')
  }

  return getSupplierById(inserted.id)!
}

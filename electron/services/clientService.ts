import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { clients } from '../database/schema'
import { getDb } from '../database/client'
import type {
  Client,
  ClientFilters,
  ClientInput,
  ClientUpdateInput,
} from '../types'

export const CLIENT_ERRORS = {
  nameRequired: 'Le nom du client est obligatoire.',
  nameTooShort: 'Le nom du client doit contenir au moins 2 caractères.',
  nameTooLong: 'Le nom du client ne peut pas dépasser 120 caractères.',
  phoneRequired: 'Le téléphone du client est obligatoire.',
  phoneTooShort: 'Le numéro de téléphone doit contenir au moins 9 chiffres.',
  phoneTooLong: 'Le numéro de téléphone ne peut pas dépasser 20 caractères.',
  phoneInvalid: 'Le numéro de téléphone est invalide.',
  addressTooLong: "L'adresse ne peut pas dépasser 255 caractères.",
  duplicateName: 'Ce nom de client existe déjà.',
  duplicatePhone: 'Ce numéro de téléphone est déjà utilisé.',
  notFound: "Ce client n'existe pas.",
  systemClientImmutable: 'Le client système ne peut pas être modifié.',
  systemClientCannotDeactivate: 'Le client système ne peut pas être désactivé.',
  unexpected: 'Une erreur inattendue est survenue.',
} as const

export type ClientErrorCode = keyof typeof CLIENT_ERRORS

export class ClientError extends Error {
  readonly code: ClientErrorCode

  constructor(code: ClientErrorCode) {
    super(CLIENT_ERRORS[code])
    this.name = 'ClientError'
    this.code = code
  }
}

export const CLIENT_NAME_MIN_LENGTH = 2
export const CLIENT_NAME_MAX_LENGTH = 120
export const CLIENT_PHONE_MIN_DIGITS = 9
export const CLIENT_PHONE_MAX_LENGTH = 20
export const CLIENT_ADDRESS_MAX_LENGTH = 255
export const SYSTEM_CLIENT_NAME = 'CLIENT COMPTANT'
export const SYSTEM_CLIENT_PHONE = '000-000-0000'

const CLIENT_ERROR_CODES = Object.keys(CLIENT_ERRORS) as ClientErrorCode[]

/**
 * Single source of truth for name normalization: trim + collapse spaces + upper case.
 * Applied in the main process before any write, so the database only ever
 * stores normalized names and uniqueness comparisons are done on that form.
 */
export function normalizeClientName(rawName: string): string {
  return rawName.trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * Phone normalization: remove all non-digit characters except + at start,
 * then ensure it's a valid Senegalese phone format.
 * This ensures that "77 123 45 67", "771234567", "+221771234567" are treated as the same.
 */
export function normalizePhone(rawPhone: string): string {
  const cleaned = rawPhone.trim().replace(/[\s\-().]/g, '')

  // If it starts with +221, keep it
  if (cleaned.startsWith('+221')) {
    return cleaned
  }

  // If it starts with 221 (without +), add +
  if (cleaned.startsWith('221') && cleaned.length === 12) {
    return '+' + cleaned
  }

  // If it's a 9-digit Senegalese number, add +221 prefix
  if (/^\d{9}$/.test(cleaned)) {
    return '+221' + cleaned
  }

  // Otherwise return as-is (will be validated by schema)
  return cleaned
}

/**
 * Checks if a phone number is a valid Senegalese format after normalization.
 */
export function isValidSenegalesePhone(phone: string): boolean {
  const normalized = normalizePhone(phone)
  // Valid formats: +221XXXXXXXXX (12 digits after +) or 9 digits
  return /^\+221\d{9}$/.test(normalized) || /^\d{9}$/.test(normalized)
}

function toErrorCode(error: z.ZodError, fallback: ClientErrorCode): ClientErrorCode {
  const message = error.issues[0]?.message

  return CLIENT_ERROR_CODES.find((code) => CLIENT_ERRORS[code] === message) ?? fallback
}

function parseClientName(input: ClientInput | ClientUpdateInput): string {
  const nameSchema = z
    .string({ error: CLIENT_ERRORS.nameRequired })
    .trim()
    .min(1, CLIENT_ERRORS.nameRequired)
    .max(CLIENT_NAME_MAX_LENGTH, CLIENT_ERRORS.nameTooLong)
    .refine((name) => name.length >= CLIENT_NAME_MIN_LENGTH, CLIENT_ERRORS.nameTooShort)

  const parsed = nameSchema.safeParse(input.name)

  if (!parsed.success) {
    throw new ClientError(toErrorCode(parsed.error, 'nameRequired'))
  }

  return normalizeClientName(parsed.data)
}

function parseClientPhone(input: ClientInput | ClientUpdateInput): string {
  const phoneSchema = z
    .string({ error: CLIENT_ERRORS.phoneRequired })
    .trim()
    .min(1, CLIENT_ERRORS.phoneRequired)
    .max(CLIENT_PHONE_MAX_LENGTH, CLIENT_ERRORS.phoneTooLong)

  const parsed = phoneSchema.safeParse(input.phone)

  if (!parsed.success) {
    throw new ClientError(toErrorCode(parsed.error, 'phoneRequired'))
  }

  const normalized = normalizePhone(parsed.data)

  if (!isValidSenegalesePhone(normalized)) {
    throw new ClientError('phoneInvalid')
  }

  return normalized
}

function parseClientAddress(input: ClientInput | ClientUpdateInput): string | null {
  if (input.address === undefined || input.address === null || input.address.trim() === '') {
    return null
  }

  const addressSchema = z
    .string()
    .trim()
    .max(CLIENT_ADDRESS_MAX_LENGTH, CLIENT_ERRORS.addressTooLong)

  const parsed = addressSchema.safeParse(input.address)

  if (!parsed.success) {
    throw new ClientError(toErrorCode(parsed.error, 'addressTooLong'))
  }

  const trimmed = parsed.data.trim()
  return trimmed === '' ? null : trimmed
}

function parseClientId(id: unknown): number {
  const idSchema = z.number({ error: CLIENT_ERRORS.notFound }).int().positive()

  const parsed = idSchema.safeParse(id)

  if (!parsed.success) {
    throw new ClientError('notFound')
  }

  return parsed.data
}

function toClient(row: typeof clients.$inferSelect): Client {
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
  const conditions = [sql`lower(${clients.name}) = ${nameLower}`]

  if (excludeId) {
    conditions.push(ne(clients.id, excludeId))
  }

  const duplicate = getDb()
    .select({ id: clients.id })
    .from(clients)
    .where(and(...conditions))
    .get()

  if (duplicate) {
    throw new ClientError('duplicateName')
  }
}

function assertPhoneIsAvailable(phone: string, excludeId?: number): void {
  const conditions = [eq(clients.phone, phone)]

  if (excludeId) {
    conditions.push(ne(clients.id, excludeId))
  }

  const duplicate = getDb()
    .select({ id: clients.id })
    .from(clients)
    .where(and(...conditions))
    .get()

  if (duplicate) {
    throw new ClientError('duplicatePhone')
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE')
}

export function listClients(filters: ClientFilters = {}): Client[] {
  const conditions = []

  if (typeof filters?.search === 'string' && filters.search.trim()) {
    const pattern = `%${filters.search.trim().toLowerCase().replace(/[\\%_]/g, '\\$&')}%`
    conditions.push(sql`lower(${clients.name}) like ${pattern} escape '\\'`)
  }

  if (typeof filters?.phoneSearch === 'string' && filters.phoneSearch.trim()) {
    const pattern = `%${filters.phoneSearch.trim().replace(/[\\%_]/g, '\\$&')}%`
    conditions.push(sql`${clients.phone} like ${pattern} escape '\\'`)
  }

  if (typeof filters?.isActive === 'boolean') {
    conditions.push(eq(clients.isActive, filters.isActive))
  }

  const rows = getDb()
    .select()
    .from(clients)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(clients.name))
    .all()

  return rows.map(toClient)
}

export function getClientById(id: number): Client | null {
  const clientId = parseClientId(id)
  const row = getDb().select().from(clients).where(eq(clients.id, clientId)).get()
  return row ? toClient(row) : null
}

export function createClient(input: ClientInput): Client {
  const name = parseClientName(input)
  const phone = parseClientPhone(input)
  const address = parseClientAddress(input)
  const db = getDb()
  const now = new Date()

  // Check for system client name
  if (name === SYSTEM_CLIENT_NAME) {
    throw new ClientError('duplicateName')
  }

  assertNameIsAvailable(name)
  assertPhoneIsAvailable(phone)

  try {
    const inserted = db
      .insert(clients)
      .values({ name, phone, address, isActive: true, isSystem: false, createdAt: now, updatedAt: now })
      .returning({ id: clients.id })
      .get()

    if (!inserted) {
      throw new ClientError('unexpected')
    }

    return getClientById(inserted.id)!
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Determine which field caused the violation
      const message = (error as Error).message
      if (message.includes('clients_name_unique')) {
        throw new ClientError('duplicateName')
      }
      if (message.includes('clients_phone_unique')) {
        throw new ClientError('duplicatePhone')
      }
      throw new ClientError('duplicateName')
    }
    throw error
  }
}

export function updateClient(id: number, input: ClientUpdateInput): Client {
  const clientId = parseClientId(id)
  const db = getDb()

  // Check if client exists and is not system
  const existing = db.select({ id: clients.id, isSystem: clients.isSystem }).from(clients).where(eq(clients.id, clientId)).get()

  if (!existing) {
    throw new ClientError('notFound')
  }

  if (existing.isSystem) {
    throw new ClientError('systemClientImmutable')
  }

  const name = parseClientName(input)
  const phone = parseClientPhone(input)
  const address = parseClientAddress(input)

  // Check for system client name
  if (name === SYSTEM_CLIENT_NAME) {
    throw new ClientError('duplicateName')
  }

  assertNameIsAvailable(name, clientId)
  assertPhoneIsAvailable(phone, clientId)

  try {
    const updated = db
      .update(clients)
      .set({ name, phone, address, updatedAt: new Date() })
      .where(eq(clients.id, clientId))
      .returning({ id: clients.id })
      .get()

    if (!updated) {
      throw new ClientError('notFound')
    }

    return getClientById(clientId)!
  } catch (error) {
    if (isUniqueViolation(error)) {
      const message = (error as Error).message
      if (message.includes('clients_name_unique')) {
        throw new ClientError('duplicateName')
      }
      if (message.includes('clients_phone_unique')) {
        throw new ClientError('duplicatePhone')
      }
      throw new ClientError('duplicateName')
    }
    throw error
  }
}

export function setClientActive(id: number, isActive: boolean): Client {
  const clientId = parseClientId(id)
  const db = getDb()

  const existing = db.select({ id: clients.id, isSystem: clients.isSystem }).from(clients).where(eq(clients.id, clientId)).get()

  if (!existing) {
    throw new ClientError('notFound')
  }

  if (existing.isSystem && !isActive) {
    throw new ClientError('systemClientCannotDeactivate')
  }

  db.update(clients).set({ isActive, updatedAt: new Date() }).where(eq(clients.id, clientId)).run()

  return getClientById(clientId)!
}

export function isNameAvailable(name: string, excludeClientId?: number): boolean {
  if (!name || name.trim().length < CLIENT_NAME_MIN_LENGTH) {
    return false
  }

  const normalized = normalizeClientName(name.trim())
  const normalizedLower = normalized.toLowerCase()
  const duplicate = excludeClientId
    ? getDb()
        .select({ id: clients.id })
        .from(clients)
        .where(and(sql`lower(${clients.name}) = ${normalizedLower}`, ne(clients.id, excludeClientId)))
        .get()
    : getDb().select({ id: clients.id }).from(clients).where(sql`lower(${clients.name}) = ${normalizedLower}`).get()

  return !duplicate
}

export function isPhoneAvailable(phone: string, excludeClientId?: number): boolean {
  if (!phone || phone.trim().length < CLIENT_PHONE_MIN_DIGITS) {
    return false
  }

  const normalized = normalizePhone(phone.trim())
  if (!isValidSenegalesePhone(normalized)) {
    return false
  }

  const duplicate = excludeClientId
    ? getDb()
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.phone, normalized), ne(clients.id, excludeClientId)))
        .get()
    : getDb().select({ id: clients.id }).from(clients).where(eq(clients.phone, normalized)).get()

  return !duplicate
}

/**
 * Ensures the system client "CLIENT COMPTANT" exists.
 * Creates it if it doesn't exist.
 * Returns the system client.
 */
export function ensureSystemClient(): Client {
  const existing = getDb()
    .select()
    .from(clients)
    .where(eq(clients.name, SYSTEM_CLIENT_NAME))
    .get()

  if (existing) {
    return toClient(existing)
  }

  const db = getDb()
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
    throw new ClientError('unexpected')
  }

  return getClientById(inserted.id)!
}
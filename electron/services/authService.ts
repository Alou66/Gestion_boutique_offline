import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { settings, users } from '../database/schema'
import { getDb } from '../database/client'
import { buildSettingsRow } from './databaseService'
import type {
  AuthCredentials,
  AuthSetupInput,
  AuthStatus,
  PublicUser,
  SettingsInput,
} from '../types'

const SCRYPT_PREFIX = 'scrypt'
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SALT_BYTES = 16
const KEY_BYTES = 64

export const AUTH_ERRORS = {
  invalidCredentials: "Nom d'utilisateur ou mot de passe incorrect.",
  alreadyConfigured: 'La boutique est déjà configurée.',
  invalidInput: 'Les informations fournies sont invalides.',
  usernameTaken: "Ce nom d'utilisateur est déjà utilisé.",
} as const

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(200),
})

const setupSchema = z.object({
  shopName: z.string().trim().min(1).max(120),
  address: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  phone2: z.string().trim().max(40).optional(),
  ninea: z.string().trim().max(40).optional(),
  ownerName: z.string().trim().max(120).optional(),
  username: z
    .string()
    .trim()
    .min(3, 'username too short')
    .max(50, 'username too long')
    .regex(/^[a-zA-Z0-9._-]+$/, 'username invalid chars'),
  password: z
    .string()
    .min(8, 'password too short')
    .max(200, 'password too long')
    .regex(/[A-Za-z]/, 'password needs a letter')
    .regex(/[0-9]/, 'password needs a digit'),
})

let currentUserId: number | null = null
let dummyHash: string | null = null

function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES)
  const derived = scryptSync(password, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })

  return [
    SCRYPT_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$')
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) {
    return false
  }

  const cost = Number(parts[1])
  const blockSize = Number(parts[2])
  const parallelization = Number(parts[3])
  const expected = Buffer.from(parts[5], 'hex')

  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelization) ||
    expected.length === 0
  ) {
    return false
  }

  const actual = scryptSync(password, Buffer.from(parts[4], 'hex'), expected.length, {
    N: cost,
    r: blockSize,
    p: parallelization,
  })

  return timingSafeEqual(actual, expected)
}

function burnVerification(password: string): void {
  dummyHash ??= hashPassword('no-account-in-this-installation')
  verifyPassword(password, dummyHash)
}

function toPublicUser(row: typeof users.$inferSelect): PublicUser {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt,
  }
}

export function hasAccount(): boolean {
  const db = getDb()
  const row = db.select({ total: count() }).from(users).get()
  return (row?.total ?? 0) > 0
}

export function setupAccount(input: AuthSetupInput): PublicUser {
  const parsed = setupSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(AUTH_ERRORS.invalidInput)
  }

  if (hasAccount()) {
    throw new Error(AUTH_ERRORS.alreadyConfigured)
  }

  const db = getDb()
  const now = new Date()
  const data = parsed.data
  const settingsInput: SettingsInput = {
    shopName: data.shopName,
    address: data.address ?? null,
    phone: data.phone ?? null,
    phone2: data.phone2 ?? null,
    ninea: data.ninea ?? null,
    ownerName: data.ownerName ?? null,
  }

  let created: typeof users.$inferSelect
  try {
    created = db.transaction((tx) => {
      const user = tx
        .insert(users)
        .values({
          username: data.username,
          passwordHash: hashPassword(data.password),
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()

      tx.insert(settings).values({ id: 1, ...buildSettingsRow(settingsInput, now) }).run()

      return user
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      throw new Error(AUTH_ERRORS.usernameTaken)
    }
    throw error
  }

  currentUserId = created.id
  return toPublicUser(created)
}

export function login(credentials: AuthCredentials): PublicUser | null {
  const parsed = credentialsSchema.safeParse(credentials)
  if (!parsed.success) {
    return null
  }

  const db = getDb()
  const row = db
    .select()
    .from(users)
    .where(eq(users.username, parsed.data.username))
    .get()

  if (!row) {
    burnVerification(parsed.data.password)
    return null
  }

  if (!verifyPassword(parsed.data.password, row.passwordHash)) {
    return null
  }

  currentUserId = row.id
  return toPublicUser(row)
}

export function logout(): void {
  currentUserId = null
}

export function getCurrentUser(): PublicUser | null {
  if (currentUserId === null) {
    return null
  }

  const db = getDb()
  const row = db.select().from(users).where(eq(users.id, currentUserId)).get()

  if (!row) {
    currentUserId = null
    return null
  }

  return toPublicUser(row)
}

export function getAuthStatus(): AuthStatus {
  const user = getCurrentUser()
  return {
    isConfigured: hasAccount(),
    isAuthenticated: user !== null,
    user,
  }
}
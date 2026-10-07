import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { settings } from '../database/schema'
import { getDb, initializeDatabase, type AppDatabase } from '../database/client'
import type { DatabaseStatus, Settings, SettingsInput } from '../types'

export function buildSettingsRow(input: SettingsInput, now: Date) {
  return {
    shopName: input.shopName.trim(),
    address: input.address?.trim() || null,
    phone: input.phone?.trim() || null,
    phone2: input.phone2?.trim() || null,
    ninea: input.ninea?.trim() || null,
    ownerName: input.ownerName?.trim() || null,
    createdAt: now,
    updatedAt: now,
  }
}

export function initDatabase(migrationsFolder: string): void {
  const db = initializeDatabase()
  runMigrationsWithRecovery(db, migrationsFolder)
}

/**
 * Runs Drizzle migrations with recovery for schema drift.
 *
 * Some databases in the wild were partially migrated by `drizzle-kit push`
 * (which modifies the schema directly without recording the migration in
 * `__drizzle_migrations`). When Drizzle later tries to run the corresponding
 * migration SQL, it fails with errors like "duplicate column name" or
 * "duplicate table name".
 *
 * This wrapper detects those "already applied" errors, marks the offending
 * migration as applied in `__drizzle_migrations` (using the same SHA-256 hash
 * that Drizzle uses), and retries — letting subsequent pending migrations
 * proceed.
 */
function runMigrationsWithRecovery(db: AppDatabase, migrationsFolder: string): void {
  let done = false
  while (!done) {
    try {
      migrate(db, { migrationsFolder })
      done = true
    } catch (error) {
      if (!isAlreadyAppliedError(error as Error)) {
        throw error
      }
      if (!markMigrationAsApplied(db, migrationsFolder, error as Error)) {
        throw error
      }
    }
  }
}

function isAlreadyAppliedError(error: Error): boolean {
  const messages = [error.message, (error as Error & { cause?: unknown }).cause instanceof Error ? (error as Error & { cause: Error }).cause.message : '']
  return messages.some((msg) => {
    const lower = msg.toLowerCase()
    return (
      lower.includes('duplicate column name') ||
      lower.includes('duplicate table name') ||
      lower.includes('already exists')
    )
  })
}

function getErrorMessage(error: Error): string {
  const parts = [error.message]
  const cause = (error as Error & { cause?: unknown }).cause
  if (cause instanceof Error) {
    parts.push(cause.message)
  }
  return parts.join('\n')
}

function markMigrationAsApplied(
  db: AppDatabase,
  migrationsFolder: string,
  error: Error,
): boolean {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json')
  if (!fs.existsSync(journalPath)) {
    return false
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))

  const fullMessage = getErrorMessage(error)
  const sqlMatch = fullMessage.match(/Failed to run the query '([^']+)'/s)
  if (!sqlMatch) {
    return false
  }

  const failingSqlFirstLine = sqlMatch[1]
    .trim()
    .replace(/--> statement-breakpoint/, '')
    .trim()
    .split('\n')[0]
    .trim()

  for (const entry of journal.entries) {
    const sqlFile = path.join(migrationsFolder, `${entry.tag}.sql`)
    if (!fs.existsSync(sqlFile)) {
      continue
    }

    const content = fs.readFileSync(sqlFile, 'utf8')
    if (content.includes(failingSqlFirstLine)) {
      const hash = crypto.createHash('sha256').update(content).digest('hex')
      db.$client
        .prepare(
          'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
        )
        .run(hash, entry.when)
      console.warn(
        `[migrations] Schema drift detected: marked migration "${entry.tag}" as already applied`,
      )
      return true
    }
  }

  return false
}

export function getDatabaseStatus(): DatabaseStatus {
  const db = getDb()
  const sqlite = db.$client

  const versionRow = sqlite
    .prepare('select sqlite_version() as version')
    .get() as { version: string } | undefined

  const settingsTable = sqlite
    .prepare(
      "select name from sqlite_master where type='table' and name='settings'",
    )
    .get()

  return {
    connected: true,
    initialized: !!settingsTable,
    version: versionRow?.version ?? 'unknown',
  }
}

export async function getSettings(): Promise<Settings | null> {
  const db = getDb()
  try {
    const row = await db.select().from(settings).where(eq(settings.id, 1)).get()
    return row ?? null
  } catch (error) {
    console.error('[settings] getSettings failed:', error)
    return null
  }
}

export async function saveSettings(input: SettingsInput): Promise<Settings> {
  const db = getDb()
  const values = buildSettingsRow(input, new Date())
  const existing = await db
    .select()
    .from(settings)
    .where(eq(settings.id, 1))
    .get()

  if (existing) {
    await db
      .update(settings)
      .set({
        shopName: values.shopName,
        address: values.address,
        phone: values.phone,
        phone2: values.phone2,
        ninea: values.ninea,
        ownerName: values.ownerName,
        updatedAt: values.updatedAt,
      })
      .where(eq(settings.id, 1))
      .run()
  } else {
    await db.insert(settings).values({ id: 1, ...values }).run()
  }

  const saved = await db
    .select()
    .from(settings)
    .where(eq(settings.id, 1))
    .get()

  if (!saved) {
    throw new Error('Failed to save settings')
  }
  return saved
}

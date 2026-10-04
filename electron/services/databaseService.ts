import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { settings } from '../database/schema'
import { getDb, initializeDatabase } from '../database/client'
import type { DatabaseStatus, Settings, SettingsInput } from '../types'

export function buildSettingsRow(input: SettingsInput, now: Date) {
  return {
    shopName: input.shopName.trim(),
    phone: input.phone?.trim() || null,
    ownerName: input.ownerName?.trim() || null,
    createdAt: now,
    updatedAt: now,
  }
}

export function initDatabase(migrationsFolder: string): void {
  const db = initializeDatabase()
  migrate(db, { migrationsFolder })
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
    const rows = await db.select().from(settings).all()
    return rows[0] ?? null
  } catch {
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
        phone: values.phone,
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

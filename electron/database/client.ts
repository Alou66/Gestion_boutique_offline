import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import path from 'node:path'
import * as schema from './schema'

export type AppDatabase = ReturnType<typeof drizzle>

let db: AppDatabase | null = null

/**
 * Removes diacritics so a search typed without accents still matches French
 * labels: SQLite's built-in lower() is ASCII only ("HYGIÈNE" would stay
 * "HYGIÈNE" and never match "hygiene").
 */
export function removeDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function initializeDatabase(): AppDatabase {
  if (db) {
    return db
  }

  const dbPath = path.join(app.getPath('userData'), 'database.sqlite')
  const sqlite = new Database(dbPath)
  // better-sqlite3 leaves foreign keys off by default: products.category_id is a
  // real FK (ON DELETE restrict) and must be enforced by the connection itself.
  sqlite.pragma('foreign_keys = ON')
  // Deterministic so it can be used safely in queries and comparisons.
  sqlite.function('unaccent', { deterministic: true }, removeDiacritics)
  db = drizzle(sqlite, { schema })
  return db
}

export function getDb(): AppDatabase {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return db
}

/**
 * Closes the SQLite connection and clears the singleton, so `initializeDatabase`
 * can open a fresh connection on the same file. Used on shutdown and by the test
 * suite to prove the movements survive a close / reopen cycle.
 */
export function closeDatabase(): void {
  if (db) {
    db.$client.close()
    db = null
  }
}

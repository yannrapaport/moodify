import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { preMigrate, finalizeMigration } from './migrate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

/**
 * Opens (or reuses) the database. Sync — assumes `initDb()` ran first to apply
 * any pending migrations. Callers that bypass `initDb()` get a freshly-opened
 * DB with the latest schema but no v1→v2 upgrade applied.
 */
export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DB_PATH ?? './moodify.db';
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  return db;
}

/**
 * Async wrapper that runs the v1→v2 migration when needed. Open the DB, run
 * preMigrate (rename v1 tables, capture legacy state via Spotify /me), apply
 * the v2 schema, then finalizeMigration (backfill, drop renamed tables).
 *
 * Call this once at process startup before serving requests.
 */
export async function initDb(): Promise<Database.Database> {
  if (db) return db;

  const dbPath = process.env.DB_PATH ?? './moodify.db';
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const ctx = await preMigrate(db);

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  if (ctx) finalizeMigration(db, ctx);

  return db;
}

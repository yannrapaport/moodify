import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { preMigrate, finalizeMigration } from '../db/migrate.js';

// Le schéma v2 réel, appliqué entre preMigrate et finalizeMigration (comme initDb).
const SCHEMA_V2 = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf-8');

// Schéma v1 (single-tenant) : tokens.id PK, pas de user_id ; feedback/exclusions sans user_id.
const SCHEMA_V1 = `
  CREATE TABLE tokens (id INTEGER PRIMARY KEY, access_token TEXT NOT NULL, refresh_token TEXT, expires_at INTEGER NOT NULL);
  CREATE TABLE feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, track_id TEXT NOT NULL, track_name TEXT, artist_name TEXT, artist_id TEXT, rating INTEGER NOT NULL, comment TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
  CREATE TABLE exclusions (type TEXT NOT NULL, value TEXT NOT NULL, label TEXT);
`;

function newDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

let db: Database.Database;

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  db?.close();
});

describe('preMigrate — cas no-op', () => {
  it('DB fraîche (aucune table) → retourne null', async () => {
    db = newDb();
    expect(await preMigrate(db)).toBeNull();
  });

  it('déjà v2 (tokens.user_id présent) → retourne null', async () => {
    db = newDb();
    db.exec(SCHEMA_V2);
    expect(await preMigrate(db)).toBeNull();
  });

  it('v1 sans ligne de token → drop les tables v1, retourne null', async () => {
    db = newDb();
    db.exec(SCHEMA_V1); // tables créées mais vides (pas de token id=1)
    expect(await preMigrate(db)).toBeNull();
  });
});

describe('migration v1 → v2 avec données (happy path)', () => {
  it('backfill users/tokens/feedback/exclusions sous user 1 et drop les tables _v1', async () => {
    db = newDb();
    db.exec(SCHEMA_V1);
    db.prepare('INSERT INTO tokens (id, access_token, refresh_token, expires_at) VALUES (1, ?, ?, ?)')
      .run('atok', 'rtok', Math.floor(Date.now() / 1000) + 3600); // non expiré → pas de refresh
    db.prepare('INSERT INTO feedback (track_id, track_name, artist_name, artist_id, rating, comment, created_at) VALUES (?,?,?,?,?,?,?)')
      .run('t1', 'Song', 'Artist', 'a1', 1, null, 0);
    db.prepare('INSERT INTO exclusions (type, value, label) VALUES (?,?,?)')
      .run('artist', 'a1', 'Artist');

    // Mock Spotify /me (seul appel réseau attendu, tokens non expirés).
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/v1/me')) {
        return new Response(JSON.stringify({ id: 'spot_legacy', display_name: 'Legacy', email: 'x@y.z' }), { status: 200 });
      }
      throw new Error(`appel réseau inattendu: ${url}`);
    }));

    // Séquence identique à initDb : preMigrate → schema v2 → finalizeMigration.
    const ctx = await preMigrate(db);
    expect(ctx).not.toBeNull();
    expect(ctx!.apiKey.length).toBeGreaterThan(0);
    db.exec(SCHEMA_V2);
    finalizeMigration(db, ctx!);

    const user = db.prepare('SELECT * FROM users').get() as any;
    expect(user.id).toBe(1);
    expect(user.spotify_user_id).toBe('spot_legacy');
    expect(user.api_key_hash).toBe(ctx!.apiKeyHash);

    const tok = db.prepare('SELECT * FROM tokens WHERE user_id = 1').get() as any;
    expect(tok.access_token).toBe('atok');

    const fb = db.prepare('SELECT * FROM feedback WHERE user_id = 1').get() as any;
    expect(fb.track_id).toBe('t1');

    const ex = db.prepare('SELECT * FROM exclusions WHERE user_id = 1').get() as any;
    expect(ex.value).toBe('a1');

    // Les tables v1 renommées ont été droppées.
    expect(() => db.prepare('SELECT * FROM tokens_v1').all()).toThrow();
    expect(() => db.prepare('SELECT * FROM feedback_v1').all()).toThrow();
  });
});

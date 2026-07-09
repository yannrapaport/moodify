import type Database from 'better-sqlite3';
import { generateApiKey, hashApiKey } from '../auth/api-key.js';

interface V1Tokens {
  access_token: string;
  refresh_token: string | null;
  expires_at: number;
}

interface SpotifyMe {
  id: string;
  display_name: string | null;
  email: string | null;
}

/**
 * Single-tenant → multi-tenant migration. Called BEFORE schema.sql runs.
 *
 * Detects v1 by inspecting the `tokens` table: if it exists with an `id`
 * column but no `user_id`, we're on v1. We capture the existing tokens (so we
 * can fetch /me to identify the legacy user), then rename the v1 tables. The
 * caller then runs schema.sql to create the v2 tables, then calls
 * `finalizeMigration()` to backfill them and drop the renamed v1 tables.
 *
 * If the v1 detection fails or there's nothing to migrate, this is a no-op.
 *
 * Returns a `MigrationContext` if a migration is in progress, or null.
 */
export interface MigrationContext {
  legacyUser: SpotifyMe;
  legacyTokens: V1Tokens;
  apiKey: string;
  apiKeyHash: string;
}

export async function preMigrate(db: Database.Database): Promise<MigrationContext | null> {
  const tokensCols = db.prepare("PRAGMA table_info(tokens)").all() as Array<{ name: string }>;
  if (tokensCols.length === 0) return null; // fresh DB, nothing to migrate
  if (tokensCols.some((c) => c.name === 'user_id')) return null; // already v2

  // v1 schema detected.
  console.log('[migrate] v1 schema detected — preparing multi-tenant upgrade…');

  const oldTokens = db
    .prepare('SELECT access_token, refresh_token, expires_at FROM tokens WHERE id = 1')
    .get() as V1Tokens | undefined;

  if (!oldTokens) {
    // No data to preserve — just drop v1 tables and let schema.sql build fresh.
    db.exec(`
      DROP TABLE IF EXISTS tokens;
      DROP TABLE IF EXISTS feedback;
      DROP TABLE IF EXISTS exclusions;
    `);
    return null;
  }

  // Fetch /me using existing tokens, refreshing if needed.
  const me = await fetchSpotifyMe(oldTokens);

  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);

  // Rename v1 tables out of the way so schema.sql can create v2 tables.
  // (Caches stay as-is — same shape in v1 and v2.)
  db.exec(`
    ALTER TABLE tokens RENAME TO tokens_v1;
    ALTER TABLE feedback RENAME TO feedback_v1;
    ALTER TABLE exclusions RENAME TO exclusions_v1;
  `);

  return { legacyUser: me, legacyTokens: oldTokens, apiKey, apiKeyHash };
}

export function finalizeMigration(db: Database.Database, ctx: MigrationContext): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, spotify_user_id, display_name, email, api_key_hash)
       VALUES (1, ?, ?, ?, ?)`,
    ).run(ctx.legacyUser.id, ctx.legacyUser.display_name, ctx.legacyUser.email, ctx.apiKeyHash);

    db.prepare(
      `INSERT INTO tokens (user_id, access_token, refresh_token, expires_at)
       VALUES (1, ?, ?, ?)`,
    ).run(ctx.legacyTokens.access_token, ctx.legacyTokens.refresh_token, ctx.legacyTokens.expires_at);

    db.exec(`
      INSERT INTO feedback (user_id, track_id, track_name, artist_name, artist_id, rating, comment, created_at)
      SELECT 1, track_id, track_name, artist_name, artist_id, rating, comment, created_at FROM feedback_v1;

      INSERT INTO exclusions (user_id, type, value, label)
      SELECT 1, type, value, label FROM exclusions_v1;

      DROP TABLE tokens_v1;
      DROP TABLE feedback_v1;
      DROP TABLE exclusions_v1;
    `);
  })();

  const banner = '='.repeat(72);
  console.log(banner);
  console.log('[migrate] v1 → v2 migration complete.');
  console.log(`[migrate] Legacy user: ${ctx.legacyUser.display_name ?? ctx.legacyUser.id}`);
  console.log('[migrate] API key (only the hash is stored — save this NOW):');
  console.log(`[migrate]   ${ctx.apiKey}`);
  console.log(banner);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchSpotifyMe(tokens: V1Tokens): Promise<SpotifyMe> {
  let accessToken = tokens.access_token;
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (tokens.expires_at <= nowSeconds + 60) {
    if (!tokens.refresh_token) {
      throw new Error('[migrate] Legacy tokens are expired and no refresh_token is stored.');
    }
    accessToken = await refreshAccessToken(tokens.refresh_token);
  }

  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`[migrate] /me lookup failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { id: string; display_name?: string; email?: string };
  return {
    id: body.id,
    display_name: body.display_name ?? null,
    email: body.email ?? null,
  };
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    throw new Error('[migrate] SPOTIFY_CLIENT_ID not set — cannot refresh legacy tokens.');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`[migrate] token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

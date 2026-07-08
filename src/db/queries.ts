import { getDb } from './index.js';
import { hashApiKey } from '../auth/api-key.js';
import type { SpotifyTokens, User, Feedback, AudioFeatures, Exclusion } from '../types.js';

// ── Users ─────────────────────────────────────────────────────────────────────

interface UserRow {
  id: number;
  spotify_user_id: string;
  display_name: string | null;
  email: string | null;
  api_key_hash: string;
  created_at: number;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    spotifyUserId: row.spotify_user_id,
    displayName: row.display_name,
    email: row.email,
    apiKeyHash: row.api_key_hash,
    createdAt: row.created_at,
  };
}

export interface UpsertUserInput {
  spotifyUserId: string;
  displayName: string | null;
  email: string | null;
  apiKeyHash: string;
}

/**
 * Inserts a user keyed on spotify_user_id. If the row already exists, refreshes
 * display_name/email but PRESERVES the existing api_key_hash (re-auth must not
 * rotate the user's API key — they'd lose access from devices that have the
 * old key).
 */
export function upsertUserBySpotifyId(input: UpsertUserInput): User {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM users WHERE spotify_user_id = ?')
    .get(input.spotifyUserId) as UserRow | undefined;

  if (existing) {
    db.prepare(
      `UPDATE users SET display_name = ?, email = ? WHERE id = ?`,
    ).run(input.displayName, input.email, existing.id);
    const updated = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(existing.id) as UserRow;
    return rowToUser(updated);
  }

  const result = db
    .prepare(
      `INSERT INTO users (spotify_user_id, display_name, email, api_key_hash)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.spotifyUserId, input.displayName, input.email, input.apiKeyHash);
  const inserted = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(result.lastInsertRowid) as UserRow;
  return rowToUser(inserted);
}

export function getUserById(userId: number): User | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserBySpotifyId(spotifyUserId: string): User | null {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE spotify_user_id = ?')
    .get(spotifyUserId) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

/**
 * Look up a user by their API key. We hash the supplied key and compare against
 * the stored hash. Returns null if no match — callers should respond with 401.
 */
export function getUserByApiKey(apiKey: string): User | null {
  const hash = hashApiKey(apiKey);
  const row = getDb()
    .prepare('SELECT * FROM users WHERE api_key_hash = ?')
    .get(hash) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function updateUserApiKeyHash(userId: number, apiKeyHash: string): void {
  getDb().prepare('UPDATE users SET api_key_hash = ? WHERE id = ?').run(apiKeyHash, userId);
}

export function deleteUser(userId: number): void {
  // Cascades to tokens/feedback/exclusions via FK.
  getDb().prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// ── Tokens ────────────────────────────────────────────────────────────────────

export function saveTokens(userId: number, tokens: SpotifyTokens): void {
  getDb().prepare(`
    INSERT INTO tokens (user_id, access_token, refresh_token, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at
  `).run(userId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
}

export function getTokens(userId: number): SpotifyTokens | null {
  const row = getDb()
    .prepare('SELECT access_token, refresh_token, expires_at FROM tokens WHERE user_id = ?')
    .get(userId) as { access_token: string; refresh_token: string | null; expires_at: number } | undefined;
  if (!row) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
  };
}

export function clearTokens(userId: number): void {
  getDb().prepare('DELETE FROM tokens WHERE user_id = ?').run(userId);
}

// ── Feedback ──────────────────────────────────────────────────────────────────

export function upsertFeedback(userId: number, feedback: Feedback): void {
  getDb().prepare(`
    INSERT INTO feedback (user_id, track_id, track_name, artist_name, artist_id, rating, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id, track_id) DO UPDATE SET
      rating = excluded.rating,
      comment = excluded.comment,
      track_name = excluded.track_name,
      artist_name = excluded.artist_name,
      artist_id = excluded.artist_id,
      created_at = unixepoch()
  `).run(
    userId,
    feedback.trackId,
    feedback.trackName,
    feedback.artistName,
    feedback.artistId,
    feedback.rating,
    feedback.comment,
  );
}

export function getFeedbackByRating(userId: number, rating: 1 | -1): Feedback[] {
  const rows = getDb()
    .prepare('SELECT * FROM feedback WHERE user_id = ? AND rating = ? ORDER BY created_at DESC')
    .all(userId, rating) as any[];
  return rows.map(rowToFeedback);
}

export function getAllFeedback(userId: number, limit = 20, ratingFilter?: 1 | -1): Feedback[] {
  const db = getDb();
  if (ratingFilter !== undefined) {
    const rows = db
      .prepare('SELECT * FROM feedback WHERE user_id = ? AND rating = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, ratingFilter, limit) as any[];
    return rows.map(rowToFeedback);
  }
  const rows = db
    .prepare('SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit) as any[];
  return rows.map(rowToFeedback);
}

export function getFeedbackCount(userId: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM feedback WHERE user_id = ?')
    .get(userId) as any;
  return row.count;
}

function rowToFeedback(row: any): Feedback {
  return {
    trackId: row.track_id,
    trackName: row.track_name,
    artistName: row.artist_name,
    artistId: row.artist_id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

// ── Audio Features Cache (global, no user scope) ──────────────────────────────

export function upsertAudioFeatures(features: AudioFeatures): void {
  getDb().prepare(`
    INSERT INTO audio_features_cache
      (track_id, energy, valence, danceability, acousticness, instrumentalness, tempo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(track_id) DO UPDATE SET
      energy = excluded.energy,
      valence = excluded.valence,
      danceability = excluded.danceability,
      acousticness = excluded.acousticness,
      instrumentalness = excluded.instrumentalness,
      tempo = excluded.tempo,
      cached_at = unixepoch()
  `).run(
    features.trackId,
    features.energy,
    features.valence,
    features.danceability,
    features.acousticness,
    features.instrumentalness,
    features.tempo,
  );
}

export function getAudioFeatures(trackId: string): AudioFeatures | null {
  const row = getDb()
    .prepare('SELECT * FROM audio_features_cache WHERE track_id = ?')
    .get(trackId) as any;
  if (!row) return null;
  return rowToAudioFeatures(row);
}

export function getAudioFeaturesForIds(ids: string[]): AudioFeatures[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT * FROM audio_features_cache WHERE track_id IN (${placeholders})`)
    .all(...ids) as any[];
  return rows.map(rowToAudioFeatures);
}

function rowToAudioFeatures(row: any): AudioFeatures {
  return {
    trackId: row.track_id,
    energy: row.energy,
    valence: row.valence,
    danceability: row.danceability,
    acousticness: row.acousticness,
    instrumentalness: row.instrumentalness,
    tempo: row.tempo,
  };
}

// ── Artist Genres Cache (global, no user scope) ───────────────────────────────

export function upsertArtistGenres(artistId: string, genres: string[]): void {
  getDb().prepare(`
    INSERT INTO artist_genres_cache (artist_id, genres)
    VALUES (?, ?)
    ON CONFLICT(artist_id) DO UPDATE SET
      genres = excluded.genres,
      cached_at = unixepoch()
  `).run(artistId, JSON.stringify(genres));
}

export function getArtistGenres(artistId: string): string[] | null {
  const row = getDb()
    .prepare('SELECT genres FROM artist_genres_cache WHERE artist_id = ?')
    .get(artistId) as any;
  if (!row) return null;
  return JSON.parse(row.genres);
}

// ── Exclusions ────────────────────────────────────────────────────────────────

export function insertExclusion(userId: number, exclusion: Exclusion): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO exclusions (user_id, type, value, label) VALUES (?, ?, ?, ?)
  `).run(userId, exclusion.type, exclusion.value, exclusion.label);
}

export function deleteExclusion(userId: number, type: string, value: string): void {
  getDb()
    .prepare('DELETE FROM exclusions WHERE user_id = ? AND type = ? AND value = ?')
    .run(userId, type, value);
}

export function getAllExclusions(userId: number): Exclusion[] {
  const rows = getDb()
    .prepare('SELECT * FROM exclusions WHERE user_id = ?')
    .all(userId) as any[];
  return rows.map((r) => ({ type: r.type, value: r.value, label: r.label }));
}

import { getDb } from './index.js';
import type { SpotifyTokens, Feedback, AudioFeatures, Exclusion } from '../types.js';

// ── Tokens ────────────────────────────────────────────────────────────────────

export function saveTokens(tokens: SpotifyTokens): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO tokens (id, access_token, refresh_token, expires_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at
  `).run(tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
}

export function getTokens(): SpotifyTokens | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tokens WHERE id = 1').get() as any;
  if (!row) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
  };
}

export function clearTokens(): void {
  getDb().prepare('DELETE FROM tokens WHERE id = 1').run();
}

// ── Feedback ──────────────────────────────────────────────────────────────────

export function upsertFeedback(feedback: Feedback): void {
  getDb().prepare(`
    INSERT INTO feedback (track_id, track_name, artist_name, artist_id, rating, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(track_id) DO UPDATE SET
      rating = excluded.rating,
      comment = excluded.comment,
      track_name = excluded.track_name,
      artist_name = excluded.artist_name,
      artist_id = excluded.artist_id,
      created_at = unixepoch()
  `).run(
    feedback.trackId,
    feedback.trackName,
    feedback.artistName,
    feedback.artistId,
    feedback.rating,
    feedback.comment,
  );
}

export function getFeedbackByRating(rating: 1 | -1): Feedback[] {
  const rows = getDb()
    .prepare('SELECT * FROM feedback WHERE rating = ? ORDER BY created_at DESC')
    .all(rating) as any[];
  return rows.map(rowToFeedback);
}

export function getAllFeedback(limit = 20, ratingFilter?: 1 | -1): Feedback[] {
  const db = getDb();
  if (ratingFilter !== undefined) {
    const rows = db
      .prepare('SELECT * FROM feedback WHERE rating = ? ORDER BY created_at DESC LIMIT ?')
      .all(ratingFilter, limit) as any[];
    return rows.map(rowToFeedback);
  }
  const rows = db
    .prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?')
    .all(limit) as any[];
  return rows.map(rowToFeedback);
}

export function getFeedbackCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM feedback').get() as any;
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

// ── Audio Features Cache ──────────────────────────────────────────────────────

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

// ── Artist Genres Cache ───────────────────────────────────────────────────────

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

export function insertExclusion(exclusion: Exclusion): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO exclusions (type, value, label) VALUES (?, ?, ?)
  `).run(exclusion.type, exclusion.value, exclusion.label);
}

export function deleteExclusion(type: string, value: string): void {
  getDb().prepare('DELETE FROM exclusions WHERE type = ? AND value = ?').run(type, value);
}

export function getAllExclusions(): Exclusion[] {
  const rows = getDb().prepare('SELECT * FROM exclusions').all() as any[];
  return rows.map((r) => ({ type: r.type, value: r.value, label: r.label }));
}

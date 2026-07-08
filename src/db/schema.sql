-- Multi-tenant schema. See src/db/migrate.ts for the v1 → v2 upgrade path.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spotify_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  email TEXT,
  api_key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  track_name TEXT,
  artist_name TEXT,
  artist_id TEXT,
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS exclusions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT,
  PRIMARY KEY (user_id, type, value)
);

-- Spotify metadata caches stay global — same audio features for everyone.
CREATE TABLE IF NOT EXISTS audio_features_cache (
  track_id TEXT PRIMARY KEY,
  energy REAL,
  valence REAL,
  danceability REAL,
  acousticness REAL,
  instrumentalness REAL,
  tempo REAL,
  cached_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS artist_genres_cache (
  artist_id TEXT PRIMARY KEY,
  genres TEXT NOT NULL,
  cached_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_feedback_user_rating ON feedback(user_id, rating);
CREATE INDEX IF NOT EXISTS idx_feedback_user_created ON feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exclusions_user_type ON exclusions(user_id, type);

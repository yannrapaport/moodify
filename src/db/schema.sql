CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY DEFAULT 1,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER NOT NULL
);

-- UNIQUE on track_id: duplicate ratings upsert (most recent rating wins)
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL UNIQUE,
  track_name TEXT,
  artist_name TEXT,
  artist_id TEXT,
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

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

-- Populated when rating a track; used by filterExclusions without live API calls
CREATE TABLE IF NOT EXISTS artist_genres_cache (
  artist_id TEXT PRIMARY KEY,
  genres TEXT NOT NULL, -- JSON array
  cached_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS exclusions (
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT,
  PRIMARY KEY (type, value)
);

-- Indexes for hot query paths
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(rating);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exclusions_type ON exclusions(type);

CREATE TABLE IF NOT EXISTS album_dates (
  album_id TEXT PRIMARY KEY,
  date TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

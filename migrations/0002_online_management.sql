CREATE TABLE IF NOT EXISTS hidden_albums (
  album_id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hidden_photos (
  item_id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS album_covers (
  album_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

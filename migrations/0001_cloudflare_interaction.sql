CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notes (
  item_id TEXT PRIMARY KEY,
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

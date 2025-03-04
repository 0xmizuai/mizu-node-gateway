CREATE TABLE IF NOT EXISTS tg_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  photo_url TEXT,
  auth_date INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tg_users_user_id ON tg_users(user_id);
CREATE INDEX IF NOT EXISTS idx_tg_users_tg_id ON tg_users(tg_id);
CREATE TABLE IF NOT EXISTS wallet_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL UNIQUE,
  chain TEXT,
  nonce TEXT,
  nonce_expired_at INTEGER,
  created_at INTEGER DEFAULT CURRENT_TIMESTAMP,
  updated_at INTEGER DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wallet_users_user_id ON wallet_users(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_users_address ON wallet_users(address);
CREATE TABLE IF NOT EXISTS user_balance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_key TEXT NOT NULL,
  token_address TEXT NOT NULL,
  token_balance INTEGER DEFAULT 0,
  is_calculate INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT CURRENT_TIMESTAMP,
  updated_at INTEGER DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_key, token_address)
);

CREATE INDEX IF NOT EXISTS idx_user_balance_user_key ON user_balance(user_key);
CREATE INDEX IF NOT EXISTS idx_user_balance_token_address ON user_balance(token_address);
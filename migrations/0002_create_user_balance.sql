DROP TABLE IF EXISTS user_balance;

CREATE TABLE IF NOT EXISTS user_balance (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  user_key TEXT NOT NULL,
  token_balance INTEGER DEFAULT 0 NOT NULL,
  token_address TEXT DEFAULT '',
  token_chain TEXT DEFAULT '',
  token_protocol TEXT DEFAULT '',
  token_decimals INTEGER DEFAULT 18,
  claimed_balance INTEGER DEFAULT 0,
  is_calculate INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT CURRENT_TIMESTAMP,
  updated_at INTEGER DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS user_balance_idx ON user_balance (user_key, token_address, token_chain);
CREATE INDEX IF NOT EXISTS user_key_idx ON user_balance (user_key);
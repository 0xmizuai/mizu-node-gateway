CREATE TABLE IF NOT EXISTS user_reward_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_key TEXT NOT NULL,
  user_key_type TEXT DEFAULT '',
  claimed_point INTEGER,
  latest_claim_timestamp INTEGER,
  referral_reward_point INTEGER,
  job_reward_count INTEGER DEFAULT 0,
  continous_check_in_days INTEGER DEFAULT 0,
  latest_check_in_timestamp INTEGER DEFAULT 0,
  user_photo_url TEXT DEFAULT '',
  username TEXT DEFAULT '',
  tg_handle_username TEXT DEFAULT '',
  lastest_activity_timestamp INTEGER,
  reject_airdrop INTEGER DEFAULT 0,
  min_airdrop_value INTEGER DEFAULT 0,
  channel_user_status INTEGER DEFAULT 0,
  channel_update_timestamp INTEGER DEFAULT 0,
  first_top_100 INTEGER DEFAULT 0,
  is_calculate INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT CURRENT_TIMESTAMP,
  updated_at INTEGER DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_key, user_key_type)
);

CREATE INDEX IF NOT EXISTS idx_user_reward_points_user_key ON user_reward_points(user_key);
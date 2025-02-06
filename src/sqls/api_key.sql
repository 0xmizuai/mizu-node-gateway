CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY,
    api_key TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    status INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER,
    updatedAt INTEGER
);

CREATE INDEX idx_api_key_api_key_user_id ON api_keys (api_key, user_id);
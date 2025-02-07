CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    user TEXT NOT NULL,
    status INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER,
    updatedAt INTEGER
);

CREATE INDEX idx_api_key_api_key_user ON api_keys (api_key, user);
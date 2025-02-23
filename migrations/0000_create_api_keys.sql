CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    user TEXT NOT NULL,
    status INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
    updatedAt INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE (api_key, user)
);

CREATE UNIQUE INDEX idx_api_key_user_key ON api_keys (user, api_key);
CREATE INDEX idx_api_key_user ON api_keys (user);
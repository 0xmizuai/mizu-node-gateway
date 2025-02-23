CREATE TABLE users (
    id TEXT PRIMARY KEY,
    deposit BIGINT NOT NULL DEFAULT 0,
    earnings BIGINT NOT NULL DEFAULT 0,
    lockedSpending BIGINT NOT NULL DEFAULT 0,
    spending BIGINT NOT NULL DEFAULT 0,
    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
    updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
);

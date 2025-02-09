CREATE TABLE users (
    id TEXT PRIMARY KEY,
    deposit BIGINT NOT NULL,
    earnings BIGINT NOT NULL,
    lockedSpending BIGINT NOT NULL,
    spending BIGINT NOT NULL,
    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
    updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
);

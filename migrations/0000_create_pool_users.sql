DROP TABLE IF EXISTS pool_users;

CREATE TABLE pool_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poolId INTEGER NOT NULL,
    userId TEXT NOT NULL,
    userKey TEXT NOT NULL,
    --  0: pending, 1: approved, 2: rejected, 3: removed
    status INTEGER NOT NULL,
    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
    updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE UNIQUE INDEX idx_pool_id_user_id ON pool_users (poolId, userId);


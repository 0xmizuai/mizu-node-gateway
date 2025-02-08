CREATE TABLE users (
    id TEXT PRIMARY KEY,
    deposit INTEGER NOT NULL,
    earnings INTEGER NOT NULL,
    pendingCost INTEGER NOT NULL,
    finalizedCost INTEGER NOT NULL,
    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
    updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
);

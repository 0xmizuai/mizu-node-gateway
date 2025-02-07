CREATE TABLE users (
    id TEXT PRIMARY KEY,
    deposit INTEGER NOT NULL,
    earnings INTEGER NOT NULL,
    pendingCost INTEGER NOT NULL,
    finalizedCost INTEGER NOT NULL,
    createdAt INTEGER,
    updatedAt INTEGER
);

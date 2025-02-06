CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    user TEXT UNIQUE NOT NULL,
    platform TEXT NOT NULL,
    deposit INTEGER NOT NULL,
    earnings INTEGER NOT NULL,
    pendingCost INTEGER NOT NULL,
    finalizedCost INTEGER NOT NULL,
    createdAt INTEGER,
    updatedAt INTEGER
);

CREATE INDEX idx_users_user ON users (user);

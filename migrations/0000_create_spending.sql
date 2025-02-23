CREATE TABLE spending (
    id INTEGER PRIMARY KEY,
    publisher TEXT NOT NULL,
    pool_id INTEGER NOT NULL,
    inputTokens BIGINT NOT NULL DEFAULT 0,
    outputTokens BIGINT NOT NULL DEFAULT 0,
    spending BIGINT NOT NULL DEFAULT 0,
    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
    updatedAt INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE (publisher, pool_id)
);

CREATE INDEX idx_spending_publisher ON spending (publisher);
CREATE INDEX idx_spending_pool_id ON spending (pool_id);

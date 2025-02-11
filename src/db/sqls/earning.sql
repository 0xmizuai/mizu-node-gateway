CREATE TABLE earnings (
    id INTEGER PRIMARY KEY,
    worker TEXT NOT NULL,
    pool_id INTEGER NOT NULL,
    nday integer NOT NULL,
    inputTokens BIGINT NOT NULL DEFAULT 0,
    outputTokens BIGINT NOT NULL DEFAULT 0,
    earnings BIGINT NOT NULL DEFAULT 0,
    settled INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
    updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_earnings_worker ON earnings (worker);
CREATE INDEX idx_earnings_pool_id ON earnings (pool_id);
CREATE UNIQUE INDEX idx_earnings_worker_pool_id_nday ON earnings (worker, pool_id, nday);

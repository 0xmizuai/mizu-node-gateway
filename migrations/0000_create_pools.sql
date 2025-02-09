DROP TABLE IF EXISTS pools;

CREATE TABLE pools (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    owner TEXT NOT NULL,
    prices JSONB NOT NULL,
    contextLength INTEGER NOT NULL,
    maxOutput INTEGER NOT NULL,
    feeRatio INTEGER NOT NULL DEFAULT 0,
    inputTokens BIGINT NOT NULL DEFAULT 0,
    outputTokens BIGINT NOT NULL DEFAULT 0,
    earnings BIGINT NOT NULL DEFAULT 0,
    settledEarnings BIGINT NOT NULL DEFAULT 0,
    lastSettledDay INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
    updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_pools_name ON pools (name);
CREATE INDEX idx_pools_owner ON pools (owner);
CREATE INDEX idx_pools_model ON pools (model);


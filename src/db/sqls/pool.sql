CREATE TABLE pools (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    owner TEXT NOT NULL,
    prices JSONB NOT NULL,
    contextLength INTEGER NOT NULL,
    maxOutput INTEGER NOT NULL,
    feeRatio INTEGER NOT NULL DEFAULT 0,
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

INSERT INTO pools (name, model, owner, prices, contextLength, maxOutput, createdAt, updatedAt)
VALUES 
  ('mizu-deepseek-r1:1.5b', 'deepseek-r1:1.5b', 'admin.mizu', '{"input": 2, "output": 4}', 131072, 4096, 1738570131, 1738570131),
  ('mizu-deepseek-r1:8b', 'deepseek-r1:8b', 'admin.mizu', '{"input": 5, "output": 10}', 131072, 4096, 1738570131, 1738570131),
  ('mizu-deepseek-r1:14b', 'deepseek-r1:14b', 'admin.mizu', '{"input": 10, "output": 20}', 131072, 4096, 1738570131, 1738570131);

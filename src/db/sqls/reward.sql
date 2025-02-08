CREATE TABLE pool_rewards (
    id INTEGER PRIMARY KEY,
    worker TEXT NOT NULL,
    pool_id INTEGER NOT NULL,
    nday integer NOT NULL, -- per day stats
    earnings INTEGER NOT NULL DEFAULT 0,
    settled INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
    updatedAt INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE (worker, pool_id, nday)
);

CREATE INDEX idx_rewards_worker ON rewards (worker);
CREATE INDEX idx_rewards_pool_id ON rewards (pool_id);
CREATE UNIQUE INDEX idx_rewards_worker_pool_id_nday ON rewards (worker, pool_id, nday);

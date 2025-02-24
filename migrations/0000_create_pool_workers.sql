DROP TABLE IF EXISTS pool_workers;

CREATE TABLE pool_workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poolId INTEGER NOT NULL,
    workerId TEXT NOT NULL,
    workerKey TEXT NOT NULL,
    --  0: pending, 1: approved, 2: rejected, 3: removed
    status INTEGER NOT NULL,
    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
    updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE UNIQUE INDEX idx_pool_id_worker_id ON pool_workers (poolId, workerId);


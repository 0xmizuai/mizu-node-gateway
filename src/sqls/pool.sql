CREATE TABLE pools (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    owner TEXT NOT NULL,
    prices JSONB NOT NULL,
    contextLength INTEGER NOT NULL,
    status INTEGER NOT NULL,
    databaseId INTEGER NOT NULL,
    createdAt INTEGER,
    updatedAt INTEGER
);

CREATE INDEX idx_pools_name ON pools (name);
CREATE INDEX idx_pools_owner ON pools (owner);
CREATE INDEX idx_pools_model ON pools (model);

INSERT INTO pools (name, model, owner, prices, contextLength, createdAt, updatedAt)
VALUES 
  ('mizu-deepseek-r1:1.5b', 'deepseek-r1:1.5b', '0x14301d0Ff94D5405aA4FE7B8AC1ac54231d1bD93', '{"input": 2, "output": 4}', 131072, 1738570131, 1738570131),
  ('mizu-deepseek-r1:8b', 'deepseek-r1:8b', '0x14301d0Ff94D5405aA4FE7B8AC1ac54231d1bD93', '{"input": 5, "output": 10}', 131072, 1738570131, 1738570131),
  ('mizu-deepseek-r1:14b', 'deepseek-r1:14b', '0x14301d0Ff94D5405aA4FE7B8AC1ac54231d1bD93', '{"input": 10, "output": 20}', 131072, 1738570131, 1738570131);
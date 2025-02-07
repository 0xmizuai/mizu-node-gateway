import { PoolConfig, GatewayServiceError, PoolConfigInput } from '../types';

export async function getPools(env: Env): Promise<PoolConfig[]> {
  const stmt = env.DB.prepare('SELECT * FROM pools');
  const result = await stmt.all();
  return result.results.map(row => ({
    id: Number(row.id),
    name: row.name as string,
    model: row.model as string,
    owner: row.owner as string,
    prices: row.prices as { input: number; output: number },
    contextLength: Number(row.context_length),
    status: Number(row.status),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
}

export async function getPool(env: Env, id: number): Promise<PoolConfig> {
  const stmt = env.DB.prepare('SELECT * FROM pools WHERE id = ?');
  const result = await stmt.bind(id).first();
  if (result === null) {
    throw new GatewayServiceError(404, 'Pool not found');
  }
  return {
    id: Number(result.id),
    name: result.name as string,
    model: result.model as string,
    owner: result.owner as string,
    prices: result.prices as { input: number; output: number },
    contextLength: Number(result.context_length),
    status: Number(result.status),
    createdAt: Number(result.created_at),
    updatedAt: Number(result.updated_at),
  } as PoolConfig;
}

export async function createPool(env: Env, user: string, pool: PoolConfigInput): Promise<number> {
  if (await poolNameExists(env, pool.name)) {
    throw new GatewayServiceError(409, 'Pool name already exists');
  }

  const stmt = env.DB.prepare(
    'INSERT INTO pools (name, model, owner, prices, ' +
      'contextLength, createdAt, updatedAt) VALUES ' +
      '(?, ?, ?, ?, ?, ?, ?) RETURNING id',
  );
  const now = Math.floor(Date.now() / 1000);
  const result = await stmt
    .bind(pool.name, pool.model, user, JSON.stringify(pool.prices), pool.contextLength, now, now)
    .run()
    .catch((err: any) => {
      if (err.code === 2067) {
        // SQLITE_CONSTRAINT_UNIQUE
        throw new GatewayServiceError(409, 'Pool name already exists');
      }
      throw new GatewayServiceError(500, `Database error: ${err.message}`);
    });
  if (!result.success || result.results.length === 0) {
    throw new GatewayServiceError(500, 'Failed to create pool');
  }
  return Number(result.results[0].id);
}

export async function updatePool(
  env: Env,
  existingPool: PoolConfig,
  pool: Partial<PoolConfig>,
): Promise<PoolConfig> {
  if (pool.prices === undefined && pool.status === undefined) {
    throw new GatewayServiceError(400, 'Prices or status are required');
  }

  const stmt = env.DB.prepare(
    'UPDATE pools SET prices = ?, status = ?, updatedAt = ? WHERE id = ?',
  );
  const now = Math.floor(Date.now() / 1000);
  const result = await stmt
    .bind(
      JSON.stringify(pool.prices ?? existingPool.prices),
      pool.status ?? existingPool.status,
      now,
      existingPool.id,
    )
    .run();
  if (!result.success) {
    throw new GatewayServiceError(500, 'Failed to update pool');
  }
  return {
    id: existingPool.id,
    name: existingPool.name,
    model: existingPool.model,
    owner: existingPool.owner,
    prices: pool.prices ?? existingPool.prices,
    contextLength: existingPool.contextLength,
    status: pool.status ?? existingPool.status,
    createdAt: existingPool.createdAt,
    updatedAt: now,
  };
}

export async function poolNameExists(env: Env, name: string): Promise<boolean> {
  const stmt = env.DB.prepare('SELECT id FROM pools WHERE name = ?');
  const result = await stmt.bind(name).first();
  return result !== null;
}

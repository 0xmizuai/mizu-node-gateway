import { Client } from '@upstash/qstash';

import { PoolConfig, GatewayServiceError, PoolConfigInput, PoolStatus } from '../types';
import { createPoolCacheDB } from './job_cache';

export function toPoolConfigPublic(pool: PoolConfig): Partial<PoolConfig> {
  return {
    id: Number(pool.id),
    name: pool.name as string,
    model: pool.model as string,
    status: pool.status as PoolStatus,
    prices: pool.prices as { input: number; output: number },
    contextLength: Number(pool.contextLength),
    maxOutput: Number(pool.maxOutput),
    feeRatio: Number(pool.feeRatio),
    inputTokens: Number(pool.inputTokens),
    outputTokens: Number(pool.outputTokens),
    earnings: Number(pool.earnings),
    settledEarnings: Number(pool.settledEarnings),
    lastSettledDay: Number(pool.lastSettledDay),
    createdAt: Number(pool.createdAt),
    updatedAt: Number(pool.updatedAt),
  };
}

function toPoolConfig(row: any): PoolConfig {
  return {
    id: Number(row.id),
    name: row.name as string,
    model: row.model as string,
    owner: row.owner as string,
    prices: JSON.parse(row.prices) as { input: number; output: number },
    contextLength: Number(row.contextLength),
    maxOutput: Number(row.maxOutput),
    status: Number(row.status) as PoolStatus,
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    earnings: Number(row.earnings),
    settledEarnings: Number(row.settledEarnings),
    lastSettledDay: Number(row.lastSettledDay),
    feeRatio: Number(row.feeRatio),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    cleanedAt: Number(row.cleanedAt),
    scheduleId: row.scheduleId as string,
  } as PoolConfig;
}

export async function scheduleCleanup(env: Env, poolId: number): Promise<string> {
  const client = new Client({
    token: env.QSTASH_TOKEN,
  });
  const { scheduleId } = await client.schedules.create({
    destination: `https://node.mizuai.io/cleanup_pool/${poolId}`,
    headers: {
      'X-API-KEY': env.INTERNAL_SERVICE_API_KEY,
    },
    cron: '*/5 * * * *', // every 5 minutes
  });
  await env.DB.prepare('UPDATE pools SET scheduleId = ? WHERE id = ?')
    .bind(scheduleId, poolId)
    .run();
  return scheduleId;
}

export async function getTotalPoolCount(env: Env): Promise<number> {
  const stmt = env.DB.prepare('SELECT COUNT(*) FROM pools');
  const result = await stmt.first();
  return Number(result?.count);
}

export async function getPools(env: Env, page: number, pageSize: number): Promise<PoolConfig[]> {
  const stmt = env.DB.prepare('SELECT * FROM pools LIMIT ? OFFSET ?');
  const result = await stmt.bind(pageSize, (page - 1) * pageSize).all();
  return result.results.map(toPoolConfig);
}

export async function getPoolsByIds(env: Env, poolIds: number[]): Promise<PoolConfig[]> {
  const stmt = env.DB.prepare(
    'SELECT * FROM pools WHERE id IN (' + poolIds.map(() => '?').join(',') + ')',
  );
  const result = await stmt.bind(...poolIds).all();
  return result.results.map(toPoolConfig);
}

export async function getUserPools(env: Env, userId: string): Promise<PoolConfig[]> {
  const stmt = env.DB.prepare('SELECT * FROM pools WHERE owner = ?');
  const result = await stmt.bind(userId).all();
  return result.results.map(toPoolConfig);
}

export async function getPool(env: Env, id: number): Promise<PoolConfig> {
  const stmt = env.DB.prepare('SELECT * FROM pools WHERE id = ?');
  const result = await stmt.bind(id).first();
  if (result === null) {
    throw new GatewayServiceError(404, 'Pool not found');
  }
  const config = toPoolConfig(result);
  if (config.scheduleId == '') {
    config.scheduleId = await scheduleCleanup(env, config.id);
  }
  return config;
}

export async function createPool(env: Env, user: string, pool: PoolConfigInput): Promise<number> {
  if (await poolNameExists(env, pool.name)) {
    throw new GatewayServiceError(409, 'Pool name already exists');
  }

  const now = Math.floor(Date.now() / 1000);
  const prices = JSON.stringify(pool.prices);
  const database_id = await createPoolCacheDB(env, pool.name);
  const stmt = env.DB.prepare(
    'INSERT INTO pools (name, model, owner, prices, ' +
      'contextLength, maxOutput, createdAt, updatedAt, databaseId) VALUES ' +
      '(?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
  );
  const result = await stmt
    .bind(
      pool.name,
      pool.model,
      user,
      prices,
      pool.contextLength,
      pool.maxOutput,
      now,
      now,
      database_id,
    )
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
  const poolId = Number(result.results[0].id);
  await scheduleCleanup(env, poolId);
  return poolId;
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
    'UPDATE pools SET prices = ?, status = ?, feeRatio = ?, updatedAt = ? WHERE id = ?',
  );
  const selectStmt = env.DB.prepare('SELECT * FROM pools where id = ?');
  const now = Math.floor(Date.now() / 1000);
  const results = await env.DB.batch([
    stmt.bind(
      JSON.stringify(pool.prices ?? existingPool.prices),
      pool.status ?? existingPool.status,
      pool.feeRatio ?? existingPool.feeRatio,
      now,
      existingPool.id,
    ),
    selectStmt.bind(existingPool.id),
  ]);
  if (!results[0].success || !results[1].success) {
    throw new GatewayServiceError(500, 'Failed to update pool');
  }
  return toPoolConfig(results[1].results[0]);
}

export async function poolNameExists(env: Env, name: string): Promise<boolean> {
  const stmt = env.DB.prepare('SELECT id FROM pools WHERE name = ?');
  const result = await stmt.bind(name).first();
  return result !== null;
}

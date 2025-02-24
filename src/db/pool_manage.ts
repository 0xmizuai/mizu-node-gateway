import { Client } from '@upstash/qstash';

import {
  PoolConfig,
  GatewayServiceError,
  PoolConfigInput,
  PoolStatus,
  PoolWorker,
  PoolWorkerStatus,
} from '../types';
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

function toPoolWorker(row: any): PoolWorker {
  return {
    id: Number(row.id),
    poolId: Number(row.poolId),
    workerId: row.workerId as string,
    workerKey: row.workerKey as string,
    status: Number(row.status) as PoolWorkerStatus,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
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

export async function getTotalPoolWorkerCount(
  env: Env,
  scene: 'all' | 'active' | 'waiting' | 'rejected',
  poolId: number,
): Promise<number> {
  if (scene === 'all') {
    const stmt = env.DB.prepare('SELECT COUNT(*) FROM pool_workers WHERE poolId = ?');
    const result = await stmt.bind(poolId).first();
    return Number(result?.['COUNT(*)']);
  } else {
    const stmt = env.DB.prepare(
      'SELECT COUNT(*) FROM pool_workers WHERE poolId = ? AND status = ?',
    );
    const result = await stmt
      .bind(poolId, scene === 'rejected' ? 2 : scene === 'waiting' ? 0 : 1)
      .first();
    return Number(result?.['COUNT(*)']);
  }
}

export async function getPoolWorkers(
  env: Env,
  scene: 'all' | 'active' | 'waiting' | 'rejected',
  poolId: number,
  page: number,
  pageSize: number,
): Promise<PoolWorker[]> {
  if (scene === 'all') {
    const stmt = env.DB.prepare('SELECT * FROM pool_workers WHERE poolId = ? LIMIT ? OFFSET ?');
    const result = await stmt.bind(poolId, pageSize, (page - 1) * pageSize).all();
    return result.results.map(toPoolWorker);
  } else {
    const stmt = env.DB.prepare(
      'SELECT * FROM pool_workers WHERE poolId = ? AND status = ? LIMIT ? OFFSET ?',
    );
    const result = await stmt
      .bind(
        poolId,
        scene === 'rejected' ? 2 : scene === 'waiting' ? 0 : 1,
        pageSize,
        (page - 1) * pageSize,
      )
      .all();
    return result.results.map(toPoolWorker);
  }
}

export async function getPoolWorker(env: Env, poolWorkerId: number): Promise<PoolWorker> {
  const stmt = env.DB.prepare('SELECT * FROM pool_workers WHERE id = ?');
  const result = await stmt.bind(poolWorkerId).first();
  return toPoolWorker(result);
}

export async function getPoolWorkerByWorkerId(
  env: Env,
  poolId: number,
  workerId: string,
): Promise<PoolWorker | null> {
  const stmt = env.DB.prepare('SELECT * FROM pool_workers WHERE poolId = ? AND workerId = ?');
  const result = await stmt.bind(poolId, workerId).first();
  if (!result) {
    return null;
  }
  return toPoolWorker(result);
}

export async function applyPoolWorker(
  env: Env,
  poolId: number,
  workerId: string,
  workerKey: string,
): Promise<void> {
  // First try to update existing record
  const updateStmt = env.DB.prepare(
    'UPDATE pool_workers SET status = 0 WHERE poolId = ? AND workerId = ?',
  );
  const result = await updateStmt.bind(poolId, workerId).run();

  // If no rows were updated, insert new record
  if (result.success && result.meta.changes === 0) {
    const insertStmt = env.DB.prepare(
      'INSERT INTO pool_workers (poolId, workerId, workerKey, status) VALUES (?, ?, ?, ?)',
    );
    await insertStmt.bind(poolId, workerId, workerKey, 0).run();
  }
}

export async function updatePoolWorkerStatus(
  env: Env,
  poolWorkerId: number,
  status: PoolWorkerStatus,
): Promise<void> {
  const stmt = env.DB.prepare('UPDATE pool_workers SET status = ? WHERE id = ?');
  await stmt.bind(status, poolWorkerId).run();
}

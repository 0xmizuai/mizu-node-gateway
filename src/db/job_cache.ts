import { Redis } from '@upstash/redis/cloudflare';

import {
  InferenceContext,
  JobOutput,
  JobResult,
  JobResultDB,
  JobStatus,
  JobType,
  PoolConfig,
  WorkerJob,
} from '../types';
import { GatewayServiceError } from '../types';
import { getPool } from './pool';

const MAX_JOB_TTL = 60 * 60 * 24 * 7; // 7 days

const MAX_JOB_PROCESSING_TIME = 600; // 10 mins

const JOB_DATA_TABLE_NAME = 'job_data';
const CREATE_JOB_DATA_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ${JOB_DATA_TABLE_NAME} (
  id INTEGER PRIMARY KEY,
  input JSONB NOT NULL DEFAULT '{}',
  outputs JSONB NOT NULL DEFAULT '[]',
  estimatedCost INTEGER NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  publisher TEXT NOT NULL,
  assigner TEXT,
  assignedAt INTEGER NOT NULL DEFAULT 0,
  expiredAt INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
  updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
);
`;

function jobQueuekey(poolId: number) {
  return `pool_cache_${poolId}`;
}

interface QueryResult {
  results: any[];
  success: boolean;
}

async function query(env: Env, dbId: string, sql: string, params: any[]): Promise<QueryResult[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${dbId}/query`;
  console.log('databaseId: ', dbId);
  console.log('Generated SQL:', sql);
  console.log('Params:', params);
  const result = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
    },
    body: JSON.stringify({ sql: sql, params: params }),
  });
  if (result.status !== 200) {
    console.error(`Failed to query: ${result.status}, ${await result.text()}`);
    throw new GatewayServiceError(500, 'Failed to query');
  }
  const data: {
    result: QueryResult[];
    success: boolean;
  } = await result.json();
  console.log('Query result:', data);
  if (!data.success) {
    throw new GatewayServiceError(500, 'Failed to query');
  }
  return data.result;
}

export async function createPoolCacheDB(env: Env, poolName: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database`;
  const result = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
    },
    body: JSON.stringify({
      name: `pool_cache_${poolName}_${now}`,
    }),
  });
  if (result.status !== 200) {
    console.error(`Failed to create job cache database: ${result.status}, ${await result.text()}`);
    throw new GatewayServiceError(500, 'Failed to create job cache database');
  }
  const data: { result: { uuid: string }; success: boolean } = await result.json();
  if (!data.success) {
    console.error(`Failed to insert jobs: ${JSON.stringify(data)}`);
    throw new GatewayServiceError(500, 'Failed to create job cache database');
  }
  const dbId = data.result.uuid;
  if (!dbId) {
    throw new GatewayServiceError(500, 'Failed to create job cache database');
  }
  await query(env, dbId, CREATE_JOB_DATA_TABLE_SQL, []);
  return dbId;
}

export async function insertJobs(
  env: Env,
  pool: PoolConfig,
  publisher: string,
  inputData: {
    context: InferenceContext;
    estimatedCost: number;
  }[],
): Promise<number[]> {
  const now = Math.floor(Date.now() / 1000);
  const values = await Promise.all(
    inputData.map(async input => {
      return [publisher, input.estimatedCost, JSON.stringify(input.context), now + MAX_JOB_TTL];
    }),
  );
  const fields = [
    'publisher',
    'estimatedCost',
    'input', // JSONB
    'expiredAt',
  ];
  const sql = `
      INSERT INTO ${JOB_DATA_TABLE_NAME} (${fields.join(', ')}) VALUES ${values
    .map(() => `(?, ?, ?, ?)`)
    .join(',')}
      RETURNING id
    `;
  const result: QueryResult[] = await query(env, pool.databaseId, sql, values.flat());
  const rows = result[0].results;
  const jobIds = rows.map(row => row.id);
  const redis = Redis.fromEnv(env);
  await redis.rpush(jobQueuekey(pool.id), ...jobIds);
  return jobIds;
}

export async function takeJob(
  env: Env,
  pool: PoolConfig,
  worker: string,
): Promise<WorkerJob | null> {
  const redis = Redis.fromEnv(env);
  const rawId = await redis.lpop(jobQueuekey(pool.id));
  if (!rawId) {
    return null;
  }
  const jobId = parseInt(rawId as string);
  const now = Math.floor(Date.now() / 1000);
  const sql = `
      UPDATE ${JOB_DATA_TABLE_NAME} 
      SET assigner = ?, status = ?, assignedAt = ?, updatedAt = ?
      WHERE id = ?
      RETURNING input`;
  const results: QueryResult[] = await query(env, pool.databaseId, sql, [
    worker,
    JobStatus.ASSIGNED,
    now,
    now,
    jobId,
  ]);
  if (results.length === 0 || results[0].results.length === 0) {
    return null;
  }
  const row = results[0].results[0];
  return {
    jobId: jobId,
    jobType: JobType.INFERENCE,
    referenceId: pool.id,
    jobCtx: row.input,
  };
}

export async function getJob(
  env: Env,
  pool: PoolConfig,
  jobId: number,
): Promise<{
  assigner: string;
  status: number;
} | null> {
  const sql = `
      SELECT assigner, status FROM ${JOB_DATA_TABLE_NAME} WHERE id = ?
    `;
  const results: QueryResult[] = await query(env, pool.databaseId, sql, [jobId]);
  if (results.length === 0 || results[0].results.length === 0) {
    return null;
  }
  return {
    assigner: results[0].results[0].assigner,
    status: results[0].results[0].status,
  };
}

export async function submitJobOutputs(
  env: Env,
  pool: PoolConfig,
  jobId: number,
  status: number,
  jobOutputs: JobOutput[],
): Promise<{ publisher: string; estimatedCost: number; outputs: JobOutput[] }> {
  const now = Math.floor(Date.now() / 1000);
  const sql = `
      UPDATE ${JOB_DATA_TABLE_NAME} 
      SET outputs = json_patch(
        COALESCE(outputs, json_array()),
        json(?)
      ),
      status = ?,
      updatedAt = ?
      WHERE id = ?
      RETURNING publisher, estimatedCost, json(outputs)
    `;
  const results: QueryResult[] = await query(env, pool.databaseId, sql, [
    jobOutputs,
    status,
    now,
    jobId,
  ]);
  return results[0].results[0];
}

export async function getJobResultsMap(
  env: Env,
  jobIds: number[],
  pool: PoolConfig,
): Promise<Record<number, JobResult>> {
  const sql = `
      SELECT id, status, COALESCE(json(outputs), json_array()) as outputs 
      FROM ${JOB_DATA_TABLE_NAME} 
      WHERE id IN (${jobIds.map(() => '?').join(',')})
    `;
  const results: QueryResult[] = await query(env, pool.databaseId, sql, jobIds);
  const rows = results[0].results;
  return rows.reduce((acc, row) => {
    acc[row.id] = {
      jobOutputs: row.outputs,
      status: row.status,
    };
    return acc;
  }, {} as Record<number, JobResult>);
}

export async function getJobResult(
  env: Env,
  pool: PoolConfig,
  jobId: number,
  startIndex = 0,
): Promise<JobResultDB> {
  const sql = `
      SELECT json(
        json_extract(
          COALESCE(json(outputs), json_array()),
          '$[' || CAST(? AS INTEGER) || ':]'
        )
      ) as outputs, status 
      FROM ${JOB_DATA_TABLE_NAME} 
      WHERE id = ?
    `;
  const results: QueryResult[] = await query(env, pool.databaseId, sql, [startIndex, jobId]);
  if (results.length === 0 || results[0].results.length === 0) {
    return {
      outputs: [],
      status: 0,
    };
  }
  const row = results[0].results[0];
  return {
    outputs: row.outputs,
    status: row.status,
  };
}

export async function queryPoolStats(env: Env, pool: PoolConfig): Promise<Record<number, number>> {
  const sql = `
      SELECT status, COUNT(*) FROM ${JOB_DATA_TABLE_NAME} GROUP BY status
    `;
  const results: QueryResult[] = await query(env, pool.databaseId, sql, []);
  const rows = results[0].results;
  return rows.reduce((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {} as Record<number, number>);
}

export async function getPoolStats(
  env: Env,
  pools: PoolConfig[],
): Promise<Record<number, Record<number, number>>> {
  const stats = await Promise.all(
    pools.map(async pool => {
      return {
        [pool.id]: await queryPoolStats(env, pool),
      };
    }),
  );

  return stats.reduce((acc, stat) => {
    Object.keys(stat).forEach(poolId => {
      acc[parseInt(poolId)] = stat[parseInt(poolId)];
    });
    return acc;
  }, {} as Record<number, Record<number, number>>);
}

export async function cleanUpPool(env: Env, poolId: number) {
  const pool = await getPool(env, poolId);
  if (!pool) {
    throw new GatewayServiceError(404, 'Pool not found');
  }
  const now = Math.floor(Date.now() / 1000);

  // Delete finished jobs
  const deleteFinishedJobsSql = `
      DELETE FROM ${JOB_DATA_TABLE_NAME} 
      WHERE expiredAt < ? AND status IN (?, ?)
    `;
  await query(env, pool.databaseId, deleteFinishedJobsSql, [
    now,
    JobStatus.FAILED,
    JobStatus.COMPLETED,
  ]);

  // Reset expired jobs
  const resetExpiredJobsSql = `
        UPDATE ${JOB_DATA_TABLE_NAME}
        SET status = ?, assigner = ?, assignedAt = ?, updatedAt = ?
        WHERE status = ? AND assignedAt < ?
        RETURNING id
    `;
  const redis = Redis.fromEnv(env);
  const results2: QueryResult[] = await query(env, pool.databaseId, resetExpiredJobsSql, [
    JobStatus.PENDING,
    null,
    0,
    now,
    JobStatus.ASSIGNED,
    now - MAX_JOB_PROCESSING_TIME,
  ]);
  const rows = results2[0].results;
  if (rows.length > 0) {
    const jobIds = rows.map(row => row.id);
    await redis.lpush(jobQueuekey(pool.id), ...jobIds.map(id => id.toString()));
  }

  // update pool cleanedAt
  await env.DB.prepare('UPDATE pools SET cleanedAt = ? WHERE id = ?').bind(now, poolId).run();
}

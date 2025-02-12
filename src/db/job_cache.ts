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

const MAX_JOB_TTL = 60 * 60 * 24 * 7; // 7 days

const JOB_DATA_TABLE_NAME = 'job_data';
const CREATE_JOB_DATA_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ${JOB_DATA_TABLE_NAME} (
  id INTEGER PRIMARY KEY,
  input JSONB NOT NULL DEFAULT '{}',
  outputs JSONB NOT NULL DEFAULT '[]',
  status INTEGER NOT NULL DEFAULT 0,
  publisher TEXT NOT NULL,
  assigner TEXT NOT NULL,
  estimatedCost INTEGER NOT NULL,
  expiredAt INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_job_data_expiredAt ON job_data (expiredAt);
`;

function jobQueuekey(poolId: number) {
  return `pool_cache_${poolId}`;
}

async function query(env: Env, dbId: string, sql: string, params: any[]): Promise<any[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${dbId}/query`;
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
    result: { results: any[] };
    success: boolean;
  } = await result.json();
  if (!data.success) {
    throw new GatewayServiceError(500, 'Failed to query');
  }
  return data.result.results;
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
    'jobCtx', // JSONB
    'expiredAt',
  ];
  const sql = `
      INSERT INTO ${JOB_DATA_TABLE_NAME} (${fields.join(', ')}) VALUES ${values
    .map(() => `(?, ?, ?, ?)`)
    .join(',')}
      RETURNING id
    `;
  const result: { id: number }[] = await query(env, pool.databaseId, sql, values.flat());
  const jobIds = result.map(result => result.id);
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
  const jobId = await redis.lpop(jobQueuekey(pool.id));
  if (!jobId) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const sql = `
      UPDATE ${JOB_DATA_TABLE_NAME} 
      SET assigner = ?, status = ?, updatedAt = ?
      WHERE id = ?
      RETURNING input`;
  const results: { input: InferenceContext }[] = await query(env, pool.databaseId, sql, [
    worker,
    JobStatus.ASSIGNED,
    now,
    jobId,
  ]);
  if (results.length === 0) {
    return null;
  }
  return {
    jobId: parseInt(jobId),
    jobType: JobType.INFERENCE,
    referenceId: pool.id,
    jobCtx: results[0].input,
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
  const results: { assigner: string; status: number }[] = await query(env, pool.databaseId, sql, [
    jobId,
  ]);
  if (results.length === 0) {
    return null;
  }
  return {
    assigner: results[0].assigner,
    status: results[0].status,
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
  const results: { publisher: string; estimatedCost: number; outputs: JobOutput[] }[] = await query(
    env,
    pool.databaseId,
    sql,
    [jobOutputs, status, now, jobId],
  );
  return results[0];
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
  const results: { id: number; status: number; outputs: JobOutput[] }[] = await query(
    env,
    pool.databaseId,
    sql,
    jobIds,
  );
  return results.reduce((acc, result) => {
    acc[result.id] = {
      jobOutputs: result.outputs,
      status: result.status,
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
          '$[' || ? || ':]'
        )
      ) as outputs, status 
      FROM ${JOB_DATA_TABLE_NAME} 
      WHERE id = ?
    `;
  const results: { outputs: JobOutput[]; status: number }[] = await query(
    env,
    pool.databaseId,
    sql,
    [startIndex, jobId],
  );
  if (results.length === 0) {
    return {
      outputs: [],
      status: 0,
    };
  }
  const result = results[0];
  return {
    outputs: result.outputs,
    status: result.status,
  };
}

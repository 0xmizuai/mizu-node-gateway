import { InferenceContext, JobOutput, JobResult, JobResultDB, PoolConfig } from '../types';
import { GatewayServiceError } from '../types';

const MAX_JOB_TTL = 60 * 60 * 24 * 7; // 7 days

const JOB_DATA_TABLE_NAME = 'job_data';
const CREATE_JOB_DATA_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ${JOB_DATA_TABLE_NAME} (
  id INTEGER PRIMARY KEY,
  jobId INTEGER UNIQUE,
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

export async function createPoolCacheDB(env: Env, pool_name: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database`;
  const result = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
    },
    body: JSON.stringify({
      name: `pool_cache_${pool_name}_${now}`,
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
  const db_id = data.result.uuid;
  if (!db_id) {
    throw new GatewayServiceError(500, 'Failed to create job cache database');
  }
  await query(env, db_id, CREATE_JOB_DATA_TABLE_SQL, []);
  return db_id;
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
  const result: { id: number }[] = await query(env, pool.datasetId, sql, values.flat());
  return result.map(result => result.id);
}

export async function updateJobIds(
  env: Env,
  pool: PoolConfig,
  jobIds: number[],
  dataIds: number[],
): Promise<void> {
  if (jobIds.length !== dataIds.length) {
    throw new GatewayServiceError(400, 'jobIds and dataIds must have the same length');
  }
  const values = jobIds.map((jobId, index) => [jobId, dataIds[index]]).flat();
  const sql = `
        UPDATE ${JOB_DATA_TABLE_NAME} 
        SET jobId = CASE id 
            ${dataIds.map(() => `WHEN ? THEN ?`).join('\n            ')}
        END
        WHERE id IN (${dataIds.map(() => '?').join(', ')})
    `;
  const params = [...values, ...dataIds];
  await query(env, pool.datasetId, sql, params);
}

export async function storeJobOutputs(
  env: Env,
  pool: PoolConfig,
  jobId: number,
  status: number,
  jobOutputs: JobOutput[],
): Promise<{ publisher: string; estimatedCost: number }> {
  const now = Math.floor(Date.now() / 1000);
  const sql = `
      UPDATE ${JOB_DATA_TABLE_NAME} 
      SET outputs = json_patch(
        COALESCE(outputs, json_array()),
        json(?)
      ),
      status = ?,
      updatedAt = ?
      WHERE jobId = ?
      RETURNING publisher, estimatedCost
    `;
  const results: { publisher: string; estimatedCost: number }[] = await query(
    env,
    pool.datasetId,
    sql,
    [jobOutputs, status, now, jobId],
  );
  return results[0];
}

export async function getJobContext(
  env: Env,
  dbId: string,
  jobId: number,
): Promise<InferenceContext> {
  const sql = `
      SELECT COALESCE(json(input), json_object()) as input 
      FROM ${JOB_DATA_TABLE_NAME} 
      WHERE jobId = ?
    `;
  const params = [jobId];
  const results: InferenceContext[] = await query(env, dbId, sql, params);
  if (results.length === 0) {
    throw new GatewayServiceError(404, 'Job not found');
  }
  return results[0];
}

export async function getJobResultsMap(
  env: Env,
  jobIds: number[],
  pool: PoolConfig,
): Promise<Record<number, JobResult>> {
  const sql = `
      SELECT jobId, status, COALESCE(json(outputs), json_array()) as outputs 
      FROM ${JOB_DATA_TABLE_NAME} 
      WHERE jobId IN (${jobIds.map(() => '?').join(',')})
    `;
  const results: { jobId: number; status: number; outputs: JobOutput[] }[] = await query(
    env,
    pool.datasetId,
    sql,
    jobIds,
  );
  return results.reduce((acc, result) => {
    acc[result.jobId] = {
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
      WHERE jobId = ?
    `;
  const results: { outputs: JobOutput[]; status: number }[] = await query(
    env,
    pool.datasetId,
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

export async function updateAssigner(
  env: Env,
  pool: PoolConfig,
  jobId: number,
  assigner: string,
): Promise<void> {
  const sql = `
      UPDATE ${JOB_DATA_TABLE_NAME} 
      SET assigner = ?
      WHERE jobId = ?`;
  await query(env, pool.datasetId, sql, [assigner, jobId]);
}

import { InferenceJobInput, PoolConfig } from "./types";
import { GatewayServiceError } from "./types";

const MAX_JOB_TTL = 60 * 60 * 24 * 7; // 7 days

export async function createPoolCacheDB(
  env: Env,
  pool_id: number
): Promise<void> {
  // create database for each pool
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database`;
  const result = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
    },
    body: JSON.stringify({
      name: `pool_job_cache_${pool_id}`,
    }),
  });
  if (result.status !== 200) {
    console.error(
      `Failed to create job cache database: ${
        result.status
      }, ${await result.text()}`
    );
    throw new GatewayServiceError(500, "Failed to create job cache database");
  }
  const data: { result: { uuid: string }; success: boolean } =
    await result.json();
  if (!data.success) {
    console.error(`Failed to insert jobs: ${JSON.stringify(data)}`);
    throw new GatewayServiceError(500, "Failed to create job cache database");
  }
  const db_id = data.result.uuid;
  if (!db_id) {
    throw new GatewayServiceError(500, "Failed to create job cache database");
  }
  // create job_data table
  const queryUrl = url + `/${db_id}/query`;
  const createTableSql = `
      CREATE TABLE job_data (
        jobId INTEGER PRIMARY KEY,
        jobType INTEGER NOT NULL,
        referenceId INTEGER NOT NULL,
        jobCtx JSONB NOT NULL,
        jobOutput TEXT,
        jobStatus INTEGER NOT NULL DEFAULT 0,
        publisher TEXT NOT NULL,
        estimatedCost INTEGER NOT NULL,
        expiredAt INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL DEFAULT 0,
        updatedAt INTEGER NOT NULL DEFAULT 0
      );
  
      CREATE INDEX idx_job_data_jobId ON job_data (jobId);
      CREATE INDEX idx_job_data_jobType ON job_data (jobType);
      CREATE INDEX idx_job_data_referenceId ON job_data (referenceId);
      CREATE INDEX idx_job_data_publisher ON job_data (publisher);
      CREATE INDEX idx_job_data_expiredAt ON job_data (expiredAt);
    `;
  const queryResult = await fetch(queryUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
    },
    body: JSON.stringify({
      sql: createTableSql,
    }),
  });
  if (queryResult.status !== 200) {
    console.error(
      `Failed to create job data table: ${
        queryResult.status
      }, ${await queryResult.text()}`
    );
    throw new GatewayServiceError(500, "Failed to create job data table");
  }
  const queryData: { success: boolean } = await queryResult.json();
  if (!queryData.success) {
    throw new GatewayServiceError(500, "Failed to create job data table");
  }
  // update pool with database_id
  const stmt = env.DB.prepare("UPDATE pools SET database_id = ? WHERE id = ?");
  await stmt.bind(db_id, pool_id).run();
}

export async function insertJobs(
  env: Env,
  jobType: number,
  pool: PoolConfig,
  inputs: InferenceJobInput[]
): Promise<number[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${pool.databaseId}/query`;
  const now = Math.floor(Date.now() / 1000);
  const values = await Promise.all(
    inputs.map(async (input) => {
      return [
        jobType,
        pool.id,
        input.publisher,
        input.estimatedCost,
        JSON.stringify(input.context),
        now + MAX_JOB_TTL,
        now,
        now,
      ];
    })
  );
  const fields = [
    "jobType",
    "referenceId",
    "publisher",
    "estimatedCost",
    "jobCtx",
    "expiredAt",
    "createdAt",
    "updatedAt",
  ];
  const sql = `
      INSERT INTO job_data (${fields.join(", ")}) VALUES ${values
    .map(() => `(?, ?, ?, ?, ?, ?, ?, ?)})`)
    .join(",")}
      RETURNING id
    `;
  const result = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
    },
    body: JSON.stringify({ sql: sql, params: values.flat() }),
  });
  if (result.status !== 200) {
    console.error(
      `Failed to insert jobs: ${result.status}, ${await result.text()}`
    );
    throw new GatewayServiceError(500, "Failed to insert jobs");
  }
  const data: { result: { id: number }[]; success: boolean } =
    await result.json();
  if (!data.success) {
    throw new GatewayServiceError(500, "Failed to insert jobs");
  }
  return data.result.map((result) => result.id);
}

export async function storeJobOutput(
  env: Env,
  dataId: number,
  pool: PoolConfig,
  jobOutput: { errorResult?: object }
): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${pool.databaseId}/query`;
  const now = Math.floor(Date.now() / 1000);
  const status = jobOutput.errorResult ? 2 : 1;
  const sql = `
      UPDATE job_data SET jobOutput = ?, jobStatus = ?, updatedAt = ? WHERE id = ?
    `;
  const params = [JSON.stringify(jobOutput), status, now, dataId];
  const result = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
    },
    body: JSON.stringify({ sql: sql, params: params }),
  });
  if (result.status !== 200) {
    console.error(
      `Failed to insert jobs: ${result.status}, ${await result.text()}`
    );
    throw new GatewayServiceError(500, "Failed to insert jobs");
  }
  const data: { success: boolean } = await result.json();
  if (!data.success) {
    throw new GatewayServiceError(500, "Failed to insert jobs");
  }
}

export async function getJobInput(
  env: Env,
  dataId: number,
  pool: PoolConfig
): Promise<InferenceJobInput> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${pool.databaseId}/query`;
  const sql = `
      SELECT jobCtx FROM job_data WHERE id = ?
    `;
  const params = [dataId];
  const result = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
    },
    body: JSON.stringify({ sql: sql, params: params }),
  });
  if (result.status !== 200) {
    console.error(
      `Failed to get job input: ${result.status}, ${await result.text()}`
    );
    throw new GatewayServiceError(500, "Failed to get job input");
  }
  const data: { result: { results: { jobCtx: string }[] }; success: boolean } =
    await result.json();
  if (!data.success) {
    throw new GatewayServiceError(500, "Failed to get job input");
  }
  return JSON.parse(data.result.results[0].jobCtx) as InferenceJobInput;
}

export async function getJobOutputs(
  env: Env,
  dataIds: number[],
  pool: PoolConfig
): Promise<Record<string, object | null>> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${pool.databaseId}/query`;
  const sql = `
      SELECT id, jobOutput FROM job_data WHERE id IN (${dataIds
        .map(() => "?")
        .join(",")})
    `;
  const params = dataIds;
  const result = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
    },
    body: JSON.stringify({ sql: sql, params: params }),
  });
  if (result.status !== 200) {
    console.error(
      `Failed to get job input: ${result.status}, ${await result.text()}`
    );
    throw new GatewayServiceError(500, "Failed to get job input");
  }
  const data: {
    result: { results: { id: number; jobOutput: string }[] };
    success: boolean;
  } = await result.json();
  if (!data.success) {
    throw new GatewayServiceError(500, "Failed to get job input");
  }
  return data.result.results.reduce((acc, result) => {
    acc[result.id] = result.jobOutput ? JSON.parse(result.jobOutput) : null;
    return acc;
  }, {} as Record<string, object>);
}

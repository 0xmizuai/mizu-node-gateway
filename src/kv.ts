import { md5 } from 'hono/utils/crypto';
import { GatewayServiceContext, GatewayServiceError, InferenceJobInput } from './types';

const MAX_JOB_TTL = 60 * 60 * 24 * 7; // 7 days

export async function insertJobs(
  c: GatewayServiceContext,
  inputs: InferenceJobInput[],
  bulk_write: boolean,
): Promise<string[]> {
  const now = Math.floor(Date.now() / 1000);
  const kvPairs = await Promise.all(
    inputs.map(async input => {
      const value = JSON.stringify(input);
      const inputKey = await md5(value);
      return { key: inputKey as string, value, expiration: now + MAX_JOB_TTL };
    }),
  );

  if (bulk_write) {
    return insertJobsBulk(c, kvPairs);
  } else {
    return insertJobsSingle(c, kvPairs);
  }
}

async function insertJobsBulk(
  c: GatewayServiceContext,
  kvPairs: { key: string; value: string; expiration: number }[],
): Promise<string[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${c.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${c.env.CF_KV_NAMESPACE_ID}/bulk`;
  const result = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.env.CF_API_TOKEN}`,
    },
    body: JSON.stringify(kvPairs),
  });
  if (result.status !== 200) {
    console.error(`Failed to insert jobs: ${result.status}, ${await result.text()}`);
    throw new GatewayServiceError(500, 'Failed to insert jobs');
  }
  const data: { error?: object[] | null; success: boolean } = await result.json();
  if (!data.success) {
    console.error(`Failed to insert jobs: ${JSON.stringify(data)}`);
    throw new GatewayServiceError(500, 'Failed to insert jobs');
  }
  return kvPairs.map(pair => pair.key);
}

async function insertJobsSingle(
  c: GatewayServiceContext,
  kvPairs: { key: string; value: string; expiration: number }[],
): Promise<string[]> {
  if (kvPairs.length != 1) {
    throw new GatewayServiceError(500, 'Failed to insert jobs: invalid kv pairs');
  }
  try {
    await c.env.KV.put(kvPairs[0].key, kvPairs[0].value, { expiration: kvPairs[0].expiration });
    return [kvPairs[0].key];
  } catch (e) {
    throw new GatewayServiceError(500, 'Failed to insert jobs: kv put failed');
  }
}

export async function getJobInput(
  c: GatewayServiceContext,
  inputKey: string,
): Promise<InferenceJobInput> {
  const jobCtx = await c.env.KV.get(inputKey);
  if (!jobCtx) {
    throw new GatewayServiceError(500, 'Job data not found');
  }
  return JSON.parse(jobCtx as string) as InferenceJobInput;
}

export interface JobOutput {
  inferenceResult?: any | null;
  errorResult?: any | null;
}

export interface JobResult {
  jobId: number;
  status: string;
  jobOutputs: JobOutput[] | null;
}

export interface JobResultDB {
  value: JobOutput[];
  finished: boolean;
  updatedAt: number;
}

export async function storeJobOutputs(
  c: GatewayServiceContext,
  jobOutputKey: string,
  jobOutputs: JobOutput[],
  finished: boolean,
): Promise<JobOutput[]> {
  const output = await c.env.KV.get(jobOutputKey);
  let value: JobResultDB = {
    value: [],
    finished: false,
    updatedAt: 0,
  };
  if (output) {
    value = JSON.parse(output as string);
  }
  const now = Math.floor(Date.now() / 1000);
  value.value.push(...jobOutputs);
  value.updatedAt = now;
  value.finished = finished;
  await c.env.KV.put(jobOutputKey as string, JSON.stringify(value), {
    expiration: now + MAX_JOB_TTL,
  });
  return value.value;
}

export async function getJobOutputsMap(
  c: GatewayServiceContext,
  outputKeys: string[],
): Promise<Record<string, JobOutput[]>> {
  const pairs = await Promise.all(
    outputKeys.map(async outputKey => {
      const value = await c.env.KV.get(outputKey);
      if (!value) {
        return { outputKey, value: [] };
      }
      const parsed = JSON.parse(value) as {
        value: JobOutput[];
        updatedAt: number;
      };
      if (parsed.updatedAt > 0) {
        return { outputKey, value: parsed.value };
      }
      return { outputKey, value: [] };
    }),
  );
  return pairs.reduce((acc, pair) => {
    acc[pair.outputKey] = pair.value as JobOutput[];
    return acc;
  }, {} as Record<string, JobOutput[]>);
}

export async function getJobResult(
  c: GatewayServiceContext,
  outputKey: string,
): Promise<JobResultDB | null> {
  const value = await c.env.KV.get(outputKey);
  if (!value) {
    return null;
  }
  return JSON.parse(value) as JobResultDB;
}

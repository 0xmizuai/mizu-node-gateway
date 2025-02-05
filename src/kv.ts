import { md5 } from "hono/utils/crypto";
import { GatewayServiceContext, GatewayServiceError, InferenceJobInput } from "./types";

const MAX_JOB_TTL = 60 * 60 * 24 * 7; // 7 days

export async function insertJobs(
  c: GatewayServiceContext,
  inputs: InferenceJobInput[]
): Promise<string[]> {
  const now = Math.floor(Date.now() / 1000);
  const kvPairs = await Promise.all(
    inputs.map(async (input) => {
      const value = JSON.stringify(input);
      const inputKey = await md5(value);
      return { key: inputKey as string, value, expiration: now + MAX_JOB_TTL };
    })
  );
  const url = `https://api.cloudflare.com/client/v4/accounts/${c.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${c.env.CF_KV_NAMESPACE_ID}/bulk`;
  const result = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.env.CF_API_TOKEN}`,
    },
    body: JSON.stringify(kvPairs),
  });
  if (result.status !== 200) {
    console.error(`Failed to insert jobs: ${result.status}, ${await result.text()}`);
    throw new GatewayServiceError(500, "Failed to insert jobs");
  }
  const data: { error?: object[] | null; success: boolean } = await result.json();
  if (!data.success) {
    console.error(`Failed to insert jobs: ${JSON.stringify(data)}`);
    throw new GatewayServiceError(500, "Failed to insert jobs");
  }
  return kvPairs.map((pair) => pair.key);
}

export async function getJobInput(
  c: GatewayServiceContext,
  inputKey: string
): Promise<InferenceJobInput> {
  const jobCtx = await c.env.KV.get(inputKey);
  if (!jobCtx) {
    throw new GatewayServiceError(500, "Job data not found");
  }
  return JSON.parse(jobCtx as string) as InferenceJobInput;
}

export async function storeJobOutput(c: GatewayServiceContext, jobOutput: object): Promise<string> {
  const value = JSON.stringify(jobOutput);
  const jobDataKey = await md5(value);
  const now = Math.floor(Date.now() / 1000);
  await c.env.KV.put(jobDataKey as string, value, {
    expiration: now + MAX_JOB_TTL,
  });
  return jobDataKey as string;
}

export async function getJobOutputs(
  c: GatewayServiceContext,
  outputKeys: string[]
): Promise<Record<string, object | null>> {
  const pairs = await Promise.all(
    outputKeys.map(async (outputKey) => {
      const value = await c.env.KV.get(outputKey);
      if (!value) {
        return { outputKey, value: null };
      }
      return { outputKey, value: JSON.parse(value) };
    })
  );
  return pairs.reduce((acc, pair) => {
    acc[pair.outputKey] = pair.value;
    return acc;
  }, {} as Record<string, object | null>);
}

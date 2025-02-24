import { Context } from 'hono';
import { ContentfulStatusCode } from 'hono/utils/http-status';

export type PoolStatus = 0 | 1 | 2;
export const PoolStatus = {
  ACTIVE: 0,
  INACTIVE: 1,
  DELETED: 2,
} as const;

export const JobStatus = {
  PENDING: 0,
  ASSIGNED: 1,
  COMPLETED: 2,
  FAILED: 3,
  ABORTED: 4,
} as const;

export const JobType = {
  INFERENCE: 4,
} as const;

export class GatewayServiceError extends Error {
  code: ContentfulStatusCode;

  constructor(code: ContentfulStatusCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'GatewayServiceError';
  }
}

export type GatewayServiceContext = Context<{
  Bindings: {
    KV: KVNamespace;
    DB: D1Database;
    JWT_PUB_KEY: string;
    INTERNAL_SERVICE_API_KEY: string;
    UPSTASH_REDIS_REST_URL: string;
    UPSTASH_REDIS_REST_TOKEN: string;
    QSTASH_TOKEN: string;
    QSTASH_URL: string;
    QSTASH_CURRENT_SIGNING_KEY: string;
    QSTASH_NEXT_SIGNING_KEY: string;
    CF_ACCOUNT_ID: string;
    CF_KV_NAMESPACE_ID: string;
    CF_API_TOKEN: string;
  };
  Variables: {
    userId: string;
    userKey: string;
  };
}>;

export interface WorkerJob {
  jobId: number;
  jobType: number;
  referenceId: number;
  jobCtx: InferenceContext;
}

export interface InferenceMessages {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InferenceContext {
  model: string;
  messages: InferenceMessages[];
  temperature: number;
  maxTokens: number;
  estimatedCost?: number;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface PoolConfigInput {
  name: string;
  model: string;
  prices: {
    input: number;
    output: number;
  };
  contextLength: number;
  maxOutput: number;
  feeRatio: number;
}

export interface PoolConfig extends PoolConfigInput {
  id: number;
  owner: string;
  databaseId: string;
  status: PoolStatus;
  earnings: number;
  settledEarnings: number;
  lastSettledDay: number;
  createdAt?: number;
  updatedAt?: number;
  inputTokens: number;
  outputTokens: number;
  cleanedAt: number;
  scheduleId: string;
}

export interface Balance {
  balance: number;
  deposit: number;
  earnings: number;
  lockedSpending: number;
  spending: number;
}

export type ApiKeyStatus = 0 | 1 | 2;
export const ApiKeyStatus = {
  ACTIVE: 0,
  INACTIVE: 1,
  DELETED: 2,
} as const;

export interface ApiKey {
  id: number;
  name: string;
  apiKey: `mizu-${string}`;
  status: ApiKeyStatus;
  createdAt: number;
  updatedAt?: number;
}

export interface JobResult {
  status: number;
  jobOutputs: string[] | null;
}

export interface JobResultDB {
  outputs: string[];
  status: number;
}

// 0: pending, 1: approved, 2: rejected, 3: removed
export type PoolWorkerStatus = 0 | 1 | 2 | 3;

export interface PoolWorker {
  id: number;
  poolId: number;
  workerId: string;
  workerKey: string;
  status: PoolWorkerStatus;
  createdAt: number;
  updatedAt: number;
}

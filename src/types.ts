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
    NODE_SERVICE_URL: string;
    INTERNAL_SERVICE_API_KEY: string;
    CF_ACCOUNT_ID: string;
    CF_KV_NAMESPACE_ID: string;
    CF_API_TOKEN: string;
  };
  Variables: {
    userId: string;
  };
}>;

export interface WorkerJob {
  jobId: number;
  jobType: number;
  referenceId: number;
  jobCtx: InferenceContext;
}

export interface NodeTakeJobResponse {
  data: {
    job: WorkerJob;
  };
}

export interface NodeFinishJobRequest {
  user: string;
  jobId: number;
  jobType: number;
}

export interface NodeFinishJobResponse {
  data: {
    referenceId: number;
    publisher: string;
    status: number;
  };
}

export interface NodePublishJobsRequest {
  user: string;
  jobType: number;
  referenceId: number;
}

export interface NodePublishJobsResponse {
  data: {
    jobIds: number[];
  };
}

export interface NodeGetJobResultsResponse {
  data: {
    results: {
      jobId: number;
      jobOutputKey: string;
      status: string;
    }[];
  };
}

export interface NodeGetQueueStatsResponse {
  message: string;
  data: {
    stats: {
      [referenceId: number]: {
        queueSize: number;
      };
    };
  };
}

export interface UpdatePublisherStatusResponse {
  message: string;
  data: {
    success: boolean;
  };
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

export interface JobOutput {
  inferenceResult?: any | null;
  errorResult?: any | null;
}

export interface JobResult {
  status: number;
  jobOutputs: JobOutput[] | null;
}

export interface JobResultDB {
  outputs: JobOutput[];
  status: number;
}

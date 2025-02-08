import { Context } from 'hono';
import { ContentfulStatusCode } from 'hono/utils/http-status';

export enum PoolStatus {
  ACTIVE = 0,
  INACTIVE = 1,
  DELETED = 2,
}

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
  jobCtxKey: string;
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
  jobCtxKey: string;
  jobOutputKey: string;
  jobCtx: object | null;
  jobOutput: object | null;
}

export interface NodeFinishJobResponse {
  data: {
    referenceId: number;
    publisher: string;
    success: boolean;
  };
}

export interface NodeJobInput {
  jobCtxKey: string;
}

export interface NodePublishJobsRequest {
  user: string;
  jobType: number;
  referenceId: number;
  jobs: NodeJobInput[];
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

export interface InferenceJobInput {
  publisher: string;
  estimatedCost: number;
  context: InferenceContext;
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
  status: PoolStatus;
  earnings: number;
  settledEarnings: number;
  lastSettledDay: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface Balance {
  balance: number;
  deposit: number;
  earnings: number;
  pendingCost: number;
  finalizedCost: number;
}

export enum ApiKeyStatus {
  ACTIVE = 0,
  INACTIVE = 1,
  DELETED = 2,
}

export interface ApiKey {
  id: number;
  name: string;
  apiKey: string;
  status: ApiKeyStatus;
  createdAt: number;
  updatedAt?: number;
}

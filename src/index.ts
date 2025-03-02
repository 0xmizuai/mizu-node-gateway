import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { fromHono } from 'chanfana';
import { jwtAuthMiddleware, jwtOrApiKeyAuthMiddleware, serviceApiKeyAuthMiddleware } from './auth';
import { CreateApiKey, DeleteApiKey, ListApiKeys } from './handlers/api_key';
import { Deposit, GetBalance, InitUser, UpdateClaimed } from './handlers/credit';
import {
  ChatCompletions,
  FinishJob,
  FinishJobStream,
  GetJobResults,
  PublishInferenceJobs,
  TakeJob,
} from './handlers/job';
import {
  CleanUpPool,
  CreatePool,
  GetPool,
  GetPools,
  GetPoolStats,
  GetUserPools,
  SettlePoolRewards,
  UpdatePool,
} from './handlers/pool';
import {
  ApplyPoolUser,
  ApplyPoolWorker,
  GetPoolUsers,
  GetPoolUserStatus,
  GetPoolWorkers,
  GetPoolWorkerStatus,
  GetUserCounts,
  GetWorkerCounts,
  ManagePoolUser,
  ManagePoolWorker,
  WorkerStart,
} from './handlers/pool_manage';
import { GatewayServiceError } from './types';
import { CalculateCredits, UpdateClaimedStatus } from './handlers/balance_points';

const app = new Hono<{
  Bindings: {
    KV: KVNamespace;
    D1: D1Database;
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
}>();

// CORS middleware
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Apply jwtAuthMiddleware only to specific routes
app.use('/take_job', jwtOrApiKeyAuthMiddleware);
app.use('/finish_job_stream', jwtOrApiKeyAuthMiddleware);
app.use('/finish_job', jwtOrApiKeyAuthMiddleware);
app.use('/publish_inference_jobs', jwtOrApiKeyAuthMiddleware);
app.use('/job_results', jwtOrApiKeyAuthMiddleware);

// OpenAI API
app.use('/v1/chat/completions', jwtOrApiKeyAuthMiddleware);

app.use('/pool_stats', jwtAuthMiddleware);
app.use('/new_pool', jwtAuthMiddleware);
app.use('/user_pools', jwtAuthMiddleware);
app.use('/update_pool/:id', jwtAuthMiddleware);
app.use('/settle_pool', jwtAuthMiddleware);
app.use('/cleanup_pool/:id', serviceApiKeyAuthMiddleware);

app.use('/user/init', jwtAuthMiddleware);
app.use('/user/deposit', jwtAuthMiddleware);
app.use('/user/balance', jwtAuthMiddleware);

app.use('/api_key/new', jwtAuthMiddleware);
app.use('/api_key/delete/:id', jwtAuthMiddleware);
app.use('/api_key/list', jwtAuthMiddleware);
app.use('/updateClaimed', jwtAuthMiddleware);

app.use('/worker_start', jwtAuthMiddleware);

app.use('/pool_manage/workers', jwtAuthMiddleware);
app.use('/pool_manage/worker_status', jwtAuthMiddleware);
app.use('/pool_manage/apply_worker', jwtAuthMiddleware);
app.use('/pool_manage/manage_worker', jwtAuthMiddleware);

app.use('/pool_manage/users', jwtAuthMiddleware);
app.use('/pool_manage/user_status', jwtAuthMiddleware);
app.use('/pool_manage/apply_user', jwtAuthMiddleware);
app.use('/pool_manage/manage_user', jwtAuthMiddleware);

app.use('/user_points/calculate-credits', jwtAuthMiddleware);
app.use('/user_points/update-claimed-status', jwtAuthMiddleware);
// Error handling middleware
app.onError(async (err, c) => {
  if (err instanceof GatewayServiceError) {
    return c.text(err.message, err.code);
  }
  console.error(err);
  return c.text('Internal Server Error', 500);
});

const openapi = fromHono(app, {
  schema: {
    info: {
      title: 'Mizu Node Gateway',
      version: '0.0.1',
    },
    security: [
      {
        BearerAuth: [],
      },
    ],
  },
});

openapi.registry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
});

// Define routes
openapi.get('/take_job', TakeJob);
openapi.post('/finish_job_stream', FinishJobStream);
openapi.post('/finish_job', FinishJob);
openapi.post('/publish_inference_jobs', PublishInferenceJobs);
openapi.get('/job_results', GetJobResults);

// OpenAI API
openapi.post('/v1/chat/completions', ChatCompletions);

openapi.get('/pool_stats', GetPoolStats);
openapi.post('/new_pool', CreatePool);
openapi.get('/user_pools', GetUserPools);
openapi.get('/pool/:id', GetPool);
openapi.post('/update_pool/:id', UpdatePool);
openapi.post('/settle_pool', SettlePoolRewards);
openapi.post('/cleanup_pool/:id', CleanUpPool);

openapi.post('/user/init', InitUser);
openapi.post('/user/deposit', Deposit);
openapi.get('/user/balance', GetBalance);

openapi.post('/api_key/new', CreateApiKey);
openapi.post('/api_key/delete', DeleteApiKey);
openapi.get('/api_key/list', ListApiKeys);
openapi.post('/updateClaimed', UpdateClaimed);

openapi.post('/worker_start', WorkerStart);

openapi.get('/pool_manage/worker_status', GetPoolWorkerStatus);
openapi.get('/pool_manage/workers', GetPoolWorkers);
openapi.get('/pool_manage/worker_status', GetPoolWorkerStatus);
openapi.post('/pool_manage/apply_worker', ApplyPoolWorker);
openapi.post('/pool_manage/manage_worker', ManagePoolWorker);
openapi.get('/pool_manage/worker_counts', GetWorkerCounts);

openapi.get('/pool_manage/users', GetPoolUsers);
openapi.get('/pool_manage/user_status', GetPoolUserStatus);
openapi.post('/pool_manage/apply_user', ApplyPoolUser);
openapi.post('/pool_manage/manage_user', ManagePoolUser);
openapi.get('/pool_manage/user_counts', GetUserCounts);

openapi.post('/user_points/calculate-credits', CalculateCredits);
openapi.post('/user_points/update-claimed-status', UpdateClaimedStatus);

// Add unauthenticated routes
app.get('/', c => c.text(''));
app.get('/health', c => c.json({ status: 'OK' }));
openapi.get('/pools', GetPools);

export default app;

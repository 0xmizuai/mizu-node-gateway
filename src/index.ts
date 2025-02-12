import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { GatewayServiceError } from './types';
import { fromHono } from 'chanfana';
import { jwtAuthMiddleware, jwtOrApiKeyAuthMiddleware } from './auth';
import { CreateApiKey, DeleteApiKey, ListApiKeys } from './handlers/api_key';
import { Deposit, GetBalance, InitUser } from './handlers/credit';
import {
  TakeJob,
  FinishJob,
  PublishInferenceJobs,
  GetJobResults,
  ChatCompletions,
  SubmitJobOutput,
} from './handlers/job';
import {
  GetPoolStats,
  CreatePool,
  GetPools,
  GetPool,
  UpdatePool,
  SettlePoolRewards,
  GetUserPools,
} from './handlers/pool';

const app = new Hono<{
  Bindings: {
    KV: KVNamespace;
    D1: D1Database;
    JWT_PUB_KEY: string;
    NODE_SERVICE_URL: string;
    INTERNAL_SERVICE_API_KEY: string;
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
app.use('/finish_job', jwtOrApiKeyAuthMiddleware);
app.use('/publish_inference_jobs', jwtOrApiKeyAuthMiddleware);
app.use('/job_results', jwtOrApiKeyAuthMiddleware);
app.use('/pool/:id/chat/completions', jwtOrApiKeyAuthMiddleware);

app.use('/user_pools', jwtAuthMiddleware);
app.use('/pool_stats', jwtAuthMiddleware);
app.use('/new_pool', jwtAuthMiddleware);
app.use('/update_pool/:id', jwtAuthMiddleware);
app.use('/settle_pool', jwtAuthMiddleware);

app.use('/user/init', jwtAuthMiddleware);
app.use('/user/deposit', jwtAuthMiddleware);
app.use('/user/balance', jwtAuthMiddleware);

app.use('/api_key/new', jwtAuthMiddleware);
app.use('/api_key/delete/:id', jwtAuthMiddleware);
app.use('/api_key/list', jwtAuthMiddleware);

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
openapi.post('/finish_job', FinishJob);
openapi.post('/publish_inference_jobs', PublishInferenceJobs);
openapi.get('/job_results', GetJobResults);
openapi.post('/pool/:id/chat/completions', ChatCompletions);

openapi.get('/pool_stats', GetPoolStats);
openapi.post('/new_pool', CreatePool);
openapi.get('/user_pools', GetUserPools);
openapi.get('/pool/:id', GetPool);
openapi.post('/update_pool/:id', UpdatePool);
openapi.post('/settle_pool', SettlePoolRewards);

openapi.post('/user/init', InitUser);
openapi.post('/user/deposit', Deposit);
openapi.get('/user/balance', GetBalance);

openapi.post('/api_key/new', CreateApiKey);
openapi.post('/api_key/delete', DeleteApiKey);
openapi.get('/api_key/list', ListApiKeys);

// Add unauthenticated routes
app.get('/', c => c.text(''));
app.get('/health', c => c.json({ status: 'OK' }));
openapi.get('/pools', GetPools);

export default app;

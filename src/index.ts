import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { GatewayServiceError } from './types';
import { fromHono } from 'chanfana';
import {
  CreatePool,
  Deposit,
  FinishJob,
  GetBalance,
  GetJobResults,
  GetPool,
  GetPools,
  GetPoolStats,
  PublishInferenceJobs,
  TakeJob,
  UpdatePool,
  CreateApiKey,
  DeleteApiKey,
  ListApiKeys,
} from './handlers';
import { authMiddleware } from './auth';

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

// Apply authMiddleware only to specific routes
app.use('/take_job', authMiddleware);
app.use('/finish_job', authMiddleware);
app.use('/publish_inference_jobs', authMiddleware);
app.use('/job_results', authMiddleware);

app.use('/pool_stats', authMiddleware);
app.use('/pools', authMiddleware);
app.use('/pool/:id', authMiddleware);
app.use('/new_pool', authMiddleware);
app.use('/update_pool/:id', authMiddleware);

app.use('/deposit', authMiddleware);
app.use('/balance', authMiddleware);

app.use('/api_key/new', authMiddleware);
app.use('/api_key/delete/:id', authMiddleware);
app.use('/api_key/list', authMiddleware);

// Error handling middleware
app.onError(async (err, c) => {
  if (err instanceof GatewayServiceError) {
    return c.text(err.message, err.code);
  }
  return c.text('Internal Server Error', 500);
});

const openapi = fromHono(app, {
  schema: {
    info: {
      title: 'Mizu Node Gateway',
      version: '0.0.1',
    },
  },
});

// Define routes
openapi.get('/take_job', TakeJob);
openapi.post('/finish_job', FinishJob);
openapi.post('/publish_inference_jobs', PublishInferenceJobs);
openapi.get('/job_results', GetJobResults);

openapi.get('/pool_stats', GetPoolStats);
openapi.post('/new_pool', CreatePool);
openapi.get('/pools', GetPools);
openapi.get('/pool/:id', GetPool);
openapi.post('/update_pool/:id', UpdatePool);

openapi.post('/deposit', Deposit);
openapi.get('/balance', GetBalance);

openapi.post('/api_key/new', CreateApiKey);
openapi.post('/api_key/delete/:id', DeleteApiKey);
openapi.get('/api_key/list', ListApiKeys);

// Add unauthenticated routes
app.get('/', c => c.text(''));
app.get('/health', c => c.json({ status: 'OK' }));

export default app;

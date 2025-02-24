import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { getBalance, lockSpending, settleJobRewards } from '../db/credit';
import {
  abortJob,
  getJob,
  getJobResult,
  getJobResultsMap,
  insertJobs,
  submitJobOutputs,
  takeJob,
} from '../db/job_cache';
import { getPool } from '../db/pool';
import {
  getPoolUserByUserId,
  getPoolWorkerByWorkerId,
  increasePoolWorkerAssignedTasks,
} from '../db/pool_manage';
import { GatewayServiceContext, GatewayServiceError, JobStatus, PoolConfig } from '../types';
import { estimateCost } from '../utils';

const DEFAULT_TIMEOUT_MS = 600000;
const MAX_JOB_TTL = 3600 * 24 * 3; // 3 days

export class TakeJob extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        jobType: z.number().int().min(0).max(4),
        poolId: z.number().int(),
      }),
    },
    responses: {
      '200': {
        description: 'Job',
        content: {
          'application/json': {
            schema: z.object({
              message: z.string(),
              data: z.object({
                job: z
                  .object({
                    jobId: z.string().or(z.number().int()),
                    jobType: z.number().int(),
                    jobCtx: z.any(),
                  })
                  .optional(),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const user = c.get('userId');
    const pool = await getPool(c.env, data.query.poolId);
    const currentPoolWorker = await getPoolWorkerByWorkerId(c.env, pool.id, user);
    if (pool.isPublic === 0) {
      if (currentPoolWorker?.status !== 1) {
        throw new GatewayServiceError(400, 'You have not been approved to work for this pool');
      }
    }

    const job = await takeJob(c.env, pool, user);
    // Increase worker assigned tasks count
    if (job && currentPoolWorker) {
      await increasePoolWorkerAssignedTasks(c.env, currentPoolWorker.id);
    }
    return c.json({
      message: 'ok',
      data: { job },
    });
  }
}

async function validateFinishJobRequest(
  c: GatewayServiceContext,
  worker: string,
  metadata: {
    jobId: number;
    poolId: number;
    jobType: number;
  },
): Promise<PoolConfig> {
  const pool = await getPool(c.env, metadata.poolId);
  const job = await getJob(c.env, pool, metadata.jobId);
  if (!job) {
    throw new GatewayServiceError(404, 'Job not found');
  }
  if (job.assigner !== worker) {
    throw new GatewayServiceError(403, 'Job not assigned to this worker');
  }
  if (job.status == JobStatus.ABORTED) {
    throw new GatewayServiceError(410, 'Job aborted');
  }
  if (job.status != JobStatus.ASSIGNED) {
    throw new GatewayServiceError(400, 'Job already finished');
  }
  return pool;
}

function getTokenUsageFromStream(data: string) {
  const lines = data.split('\n').filter(line => line.trim() !== '');

  // each data should at least have 3 lines
  // 1. metadata
  // 2. data with token usage
  // 3. data: [DONE]
  if (lines.length < 3) {
    throw new GatewayServiceError(400, 'Invalid data');
  }

  const lastLine = lines[lines.length - 2];
  const jsonData = lastLine.slice(6); // Remove 'data: ' prefix
  if (jsonData === '[DONE]') {
    throw new GatewayServiceError(400, 'Invalid data');
  }
  try {
    const parsed = JSON.parse(jsonData);
    if (parsed.usage && typeof parsed.usage.total_tokens === 'number') {
      return parsed.usage;
    }
  } catch (e) {
    console.error('Failed to parse chunk:', e);
  }
  return null;
}

export class FinishJobStream extends OpenAPIRoute {
  schema = {
    responses: {
      '200': {
        description: 'Job completion response',
        content: {
          'application/json': {
            schema: z.object({
              message: z.string().default('ok'),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const stream = c.req.raw.body;
    if (!stream) {
      throw new GatewayServiceError(400, 'Missing request body');
    }

    const reader = stream.getReader();
    const worker = c.get('userId');
    let metadata = null;
    let pool: PoolConfig | null = null;
    let firstChunk = '';
    let data = '';
    try {
      let shouldContinue = true;
      while (shouldContinue) {
        const { done, value } = await reader.read();
        if (done) {
          shouldContinue = false;
          break;
        }

        if (metadata == null) {
          firstChunk = firstChunk + new TextDecoder().decode(value);
          data += firstChunk;
          // metadata line is completed
          if (firstChunk.includes('\n')) {
            const lines = firstChunk.split('\n');
            metadata = JSON.parse(lines[0].replace('metadata: ', ''));
            pool = await validateFinishJobRequest(c, worker, metadata);
            await submitJobOutputs(c.env, pool, metadata.jobId, JobStatus.ASSIGNED, [
              lines.slice(1).join('\n'),
            ]);
          } else {
            // first chunk too short, wait for more data
            continue;
          }
        } else if (pool) {
          const chunk = new TextDecoder().decode(value);
          data += chunk;
          await submitJobOutputs(c.env, pool, metadata.jobId, JobStatus.ASSIGNED, [chunk]);
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!pool || !metadata) {
      throw new GatewayServiceError(404, 'Pool or job not found');
    }

    const { publisher, estimatedCost } = await submitJobOutputs(
      c.env,
      pool,
      metadata.jobId,
      JobStatus.COMPLETED,
      [],
    );
    const tokenUsage = getTokenUsageFromStream(data);
    if (tokenUsage) {
      await settleJobRewards(c.env, publisher, estimatedCost, pool, tokenUsage, worker);
    }

    return c.json({ message: 'ok' });
  }
}

export class FinishJob extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              jobId: z.number().int(),
              poolId: z.number().int(),
              jobType: z.number().int().min(0).max(4),
              jobOutput: z
                .object({
                  usage: z.object({
                    prompt_tokens: z.number().int(),
                    completion_tokens: z.number().int(),
                    total_tokens: z.number().int(),
                  }),
                  choices: z.array(
                    z.object({
                      message: z.object({
                        role: z.string(),
                        content: z.string(),
                      }),
                    }),
                  ),
                })
                .passthrough(),
            }),
          },
        },
      },
    },
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              message: z.string().default('ok'),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const worker = c.get('userId');
    const pool = await validateFinishJobRequest(c, worker, data.body);
    const { publisher, estimatedCost } = await submitJobOutputs(
      c.env,
      pool,
      data.body.jobId,
      JobStatus.COMPLETED,
      [JSON.stringify(data.body.jobOutput)],
    );
    await settleJobRewards(
      c.env,
      publisher,
      estimatedCost,
      pool,
      data.body.jobOutput.usage,
      worker,
    );
    return c.json({ message: 'ok' });
  }
}

const openAiInputSchema = z
  .object({
    model: z.string(),
    messages: z.array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
      }),
    ),
    temperature: z.number().min(0).max(2).default(1),
    maxTokens: z.number().int().min(1).max(8192).default(4096),
    stream: z.boolean().default(false),
  })
  .passthrough();

type OpenAiInput = z.infer<typeof openAiInputSchema>;

async function handleJobRequest(
  c: GatewayServiceContext,
  pool: PoolConfig,
  contexts: OpenAiInput[],
  ttl: number,
): Promise<number[]> {
  const user = c.get('userId');
  const inputData = contexts.map(context => {
    return {
      context,
      estimatedCost: estimateCost(pool, context),
    };
  });

  const totalCost = inputData.reduce((acc, input) => acc + input.estimatedCost, 0);
  const balance = await getBalance(c.env, user);
  if (balance.balance < totalCost) {
    throw new GatewayServiceError(400, 'Insufficient balance');
  }

  const jobIds = await insertJobs(c.env, pool, user, inputData, ttl);
  await lockSpending(c.env, user, totalCost);
  return jobIds;
}

export class PublishInferenceJobs extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              poolId: z.number().int(),
              contexts: z.array(openAiInputSchema),
            }),
          },
        },
      },
    },
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              data: z.object({
                jobIds: z.array(z.number().int()),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const pool = await getPool(c.env, data.body.poolId);
    if (!pool) {
      throw new GatewayServiceError(404, 'Pool not found');
    }
    const jobIds = await handleJobRequest(c, pool, data.body.contexts, MAX_JOB_TTL);
    return c.json({
      data: {
        jobIds: jobIds,
      },
    });
  }
}

const getJobResultRequestSchema = z.object({
  poolId: z.number().int(),
  jobIds: z.string(),
});

export class GetJobResults extends OpenAPIRoute {
  schema = {
    request: {
      query: getJobResultRequestSchema,
    },
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              results: z.array(
                z.object({
                  jobId: z.number().int(),
                  status: z.string(),
                  jobOutputs: z.array(z.string()),
                }),
              ),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const pool = await getPool(c.env, data.query.poolId);
    const jobIds = data.query.jobIds.split(',').map(id => parseInt(id));
    const results = await getJobResultsMap(c.env, jobIds, pool);
    return c.json({ results });
  }
}

export class ChatCompletions extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: openAiInputSchema,
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Chat completion response',
        content: {
          'application/json': {
            schema: z.any(),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    // expected format pool/:id/model
    const [, poolId, model] = data.body.model.split('/', 3);
    const pool = await getPool(c.env, parseInt(poolId));
    if (!pool) {
      throw new GatewayServiceError(404, 'Pool not found');
    }
    // Check if user is approved to use this pool
    if (pool.isPublic === 0) {
      const poolUser = await getPoolUserByUserId(c.env, pool.id, c.get('userId'));
      if (!poolUser || poolUser.status !== 1) {
        throw new GatewayServiceError(403, 'You are not approved to use this pool');
      }
    }

    const jobIds = await handleJobRequest(
      c,
      pool,
      [
        {
          ...data.body,
          model,
        },
      ],
      1800,
    );
    if (jobIds.length !== 1) {
      throw new GatewayServiceError(500, 'Failed to publish jobs');
    }

    const jobId = jobIds[0];
    const startTime = Date.now();
    if (data.body.stream) {
      const signal = c.req.raw.signal; // Access signal from raw Request
      return new Response(
        new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            let processed = 0;

            // Add abort signal listener
            signal.addEventListener('abort', async () => {
              console.log('Client disconnected');
              await abortJob(c.env, pool, jobId);
              controller.close();
            });

            while (Date.now() - startTime <= DEFAULT_TIMEOUT_MS) {
              // Check if client disconnected
              if (signal.aborted) {
                return;
              }

              try {
                const { outputs, status } = await getJobResult(c.env, pool, jobId, processed);
                for (const output of outputs) {
                  controller.enqueue(encoder.encode(output));
                }
                processed += outputs.length;
                if (status === JobStatus.COMPLETED) {
                  controller.close();
                  return;
                }
                await new Promise(resolve => setTimeout(resolve, 500));
              } catch (e) {
                console.log('error: ', e);
                if (e instanceof GatewayServiceError && e.code === 408) {
                  throw e;
                }
                await new Promise(resolve => setTimeout(resolve, 500));
              }
            }
            await abortJob(c.env, pool, jobId);
            controller.close();
            throw new GatewayServiceError(408, 'Request timed out');
          },
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        },
      );
    } else {
      while (Date.now() - startTime <= DEFAULT_TIMEOUT_MS) {
        try {
          const { outputs } = await getJobResult(c.env, pool, jobId);
          if (outputs.length > 0) {
            const result = JSON.parse(outputs[0]);
            return c.json(result);
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
          console.log('error: ', e);
          if (e instanceof GatewayServiceError && e.code === 408) {
            throw e;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  }
}

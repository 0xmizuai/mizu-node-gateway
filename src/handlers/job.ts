import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { getPool } from '../db/pool';
import { settleJobRewards, getBalance, lockSpending } from '../db/credit';
import {
  insertJobs,
  getJobResult,
  getJobResultsMap,
  takeJob,
  submitJobOutputs,
  getJob,
} from '../db/job_cache';
import { GatewayServiceContext, GatewayServiceError, JobStatus } from '../types';
import { estimateCost } from '../utils';

const DEFAULT_TIMEOUT_MS = 30000;

export class TakeJob extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        jobType: z.number().int().min(0).max(4),
        referenceId: z.number().int(),
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
    const pool = await getPool(c.env, data.query.referenceId);
    const job = await takeJob(c.env, pool, user);
    return c.json({
      message: 'ok',
      data: { job },
    });
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
              referenceId: z.number().int(),
              jobType: z.number().int().min(0).max(4),
              jobOutputs: z.array(jobOutputSchema),
              finished: z.boolean().default(true),
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
              message: z.string(),
              data: z.any(),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const worker = c.get('userId');
    const pool = await getPool(c.env, data.body.referenceId);
    const job = await getJob(c.env, pool, data.body.jobId);
    if (!job) {
      throw new GatewayServiceError(404, 'Job not found');
    }
    if (job.assigner !== worker) {
      throw new GatewayServiceError(403, 'Job not assigned to this worker');
    }
    if (job.status != JobStatus.ASSIGNED) {
      throw new GatewayServiceError(400, 'Job already finished');
    }

    let status: number = JobStatus.ASSIGNED;
    if (data.body.finished) {
      if (data.body.jobOutputs.some(output => output.errorResult)) {
        status = JobStatus.FAILED;
      } else {
        status = JobStatus.COMPLETED;
      }
    }
    const { publisher, estimatedCost, outputs } = await submitJobOutputs(
      c.env,
      pool,
      data.body.jobId,
      status,
      data.body.jobOutputs,
    );
    if (data.body.finished) {
      const usages = outputs
        .map(output => output.inferenceResult?.usage || null)
        .filter(usage => usage !== null);
      if (usages.length == 0) {
        throw new GatewayServiceError(400, 'No usage data');
      }
      await settleJobRewards(c.env, publisher, estimatedCost, pool, usages, worker);
    }
    return c.json({
      message: 'ok',
    });
  }
}

const ollamaInputSchema = z
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

const jobRequestSchema = z.object({
  pool: z.number().int(),
  contexts: z.array(ollamaInputSchema),
});

type JobValidatedData = z.infer<typeof jobRequestSchema>;

async function handleJobRequest(
  c: GatewayServiceContext,
  jobs: JobValidatedData,
): Promise<number[]> {
  const poolConfig = await getPool(c.env, jobs.pool);
  if (!poolConfig) {
    throw new GatewayServiceError(404, 'Pool not found');
  }

  const user = c.get('userId');
  const inputData = jobs.contexts.map(context => {
    return {
      context,
      estimatedCost: estimateCost(poolConfig, context),
    };
  });

  const totalCost = inputData.reduce((acc, input) => acc + input.estimatedCost, 0);
  const balance = await getBalance(c.env, user);
  if (balance.balance < totalCost) {
    throw new GatewayServiceError(400, 'Insufficient balance');
  }

  const jobIds = await insertJobs(c.env, poolConfig, user, inputData);
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
              jobs: jobRequestSchema,
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
    const jobIds = await handleJobRequest(c, data.body.jobs);
    return c.json({
      data: {
        jobIds: jobIds,
      },
    });
  }
}

const getJobResultRequestSchema = z.object({
  referenceId: z.number().int(),
  jobIds: z.string(),
});

const jobOutputSchema = z.object({
  inferenceResult: z.any().optional(),
  errorResult: z.any().optional(),
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
                  jobOutputs: z.array(jobOutputSchema),
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
    const pool = await getPool(c.env, data.query.referenceId);
    const jobIds = data.query.jobIds.split(',').map(id => parseInt(id));
    const results = await getJobResultsMap(c.env, jobIds, pool);
    return c.json({ results });
  }
}

export class ChatCompletions extends OpenAPIRoute {
  schema = {
    request: {
      params: z.object({
        id: z.number().int(),
      }),
      body: {
        content: {
          'application/json': {
            schema: ollamaInputSchema,
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
    const poolId = data.params.id;

    const pool = await getPool(c.env, poolId);
    if (!pool) {
      throw new GatewayServiceError(404, 'Pool not found');
    }
    const new_data: JobValidatedData = {
      pool: poolId,
      contexts: [data.body],
    };
    const jobIds = await handleJobRequest(c, new_data);
    if (jobIds.length !== 1) {
      throw new GatewayServiceError(500, 'Failed to publish jobs');
    }

    const jobId = jobIds[0];
    const startTime = Date.now();
    if (data.body.stream) {
      return new Response(
        new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            let processed = 0;

            while (Date.now() - startTime <= DEFAULT_TIMEOUT_MS) {
              try {
                const { outputs, status } = await getJobResult(c.env, pool, jobId, processed);
                for (const output of outputs) {
                  controller.enqueue(encoder.encode(JSON.stringify(output.inferenceResult)));
                }
                processed += outputs.length;
                if (status !== 0) {
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
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
            throw new GatewayServiceError(408, 'Request timed out');
          },
        }),
      );
    } else {
      while (Date.now() - startTime <= DEFAULT_TIMEOUT_MS) {
        try {
          const { outputs } = await getJobResult(c.env, pool, jobId);
          if (outputs.length > 0) {
            const result = outputs[0].inferenceResult;
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

import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { getPool } from '../db/pool';
import { settleJobRewards, getBalance, lockSpending } from '../db/credit';
import {
  getJobInput,
  storeJobOutputs,
  insertJobs,
  getJobResult,
  getJobResultsMap,
  updateJobIds,
  updateAssigner,
} from '../db/job_cache';
import {
  GatewayServiceContext,
  GatewayServiceError,
  NodeTakeJobResponse,
  NodeFinishJobRequest,
  NodeFinishJobResponse,
  NodePublishJobsRequest,
  NodePublishJobsResponse,
} from '../types';
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
    const params = new URLSearchParams({
      user: user,
      jobType: data.query.jobType.toString(),
      referenceIds: data.query.referenceId.toString(),
    });
    const resp = await fetch(`${c.env.NODE_SERVICE_URL}/v3/take_job?${params.toString()}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.env.INTERNAL_SERVICE_API_KEY}`,
      },
    });
    if (resp.status !== 200) {
      throw new GatewayServiceError(500, `Failed to take job with response: ${await resp.text()}`);
    }
    const result: NodeTakeJobResponse = await resp.json();
    if (!result.data.job) {
      throw new GatewayServiceError(404, 'No job available');
    }
    const pool = await getPool(c.env, result.data.job.referenceId);
    const jobInput = await getJobInput(c.env, pool.datasetId, result.data.job.jobId);
    await updateAssigner(c.env, pool, result.data.job.jobId, user);
    return c.json({
      message: 'ok',
      data: {
        job: {
          jobId: result.data.job.jobId,
          jobType: result.data.job.jobType,
          referenceId: result.data.job.referenceId,
          jobCtx: jobInput.context,
        },
      },
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
              jobType: z.number().int().min(0).max(4),
              jobOutputs: z.array(jobOutputSchema),
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
    const nodeRequestData: NodeFinishJobRequest = {
      user: worker,
      jobId: data.body.jobId,
      jobType: data.body.jobType,
    };
    const resp = await fetch(`${c.env.NODE_SERVICE_URL}/v3/finish_job`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.env.INTERNAL_SERVICE_API_KEY}`,
      },
      body: JSON.stringify(nodeRequestData),
    });
    if (resp.status !== 200) {
      throw new GatewayServiceError(500, 'Failed to finish job');
    }
    const result: NodeFinishJobResponse = await resp.json();
    const pool = await getPool(c.env, result.data.referenceId);
    const { publisher, estimatedCost } = await storeJobOutputs(
      c.env,
      pool,
      data.body.jobId,
      result.data.status,
      data.body.jobOutputs,
    );
    const usages = data.body.jobOutputs.map(output => output.inferenceResult?.usage || 0);
    await settleJobRewards(c.env, publisher, estimatedCost, pool, usages, worker);
    return c.json(result);
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
): Promise<NodePublishJobsResponse> {
  const poolConfig = await getPool(c.env, jobs.pool);
  if (!poolConfig) {
    throw new GatewayServiceError(404, 'Pool not found');
  }

  const user = c.get('userId');
  const inputData: InferenceJobInput[] = jobs.contexts.map(context => {
    return {
      context,
      publisher: user,
      estimatedCost: estimateCost(poolConfig, context),
    };
  });

  const totalCost = inputData.reduce((acc, input) => acc + input.estimatedCost, 0);
  const balance = await getBalance(c.env, user);
  if (balance.balance < totalCost) {
    throw new GatewayServiceError(400, 'Insufficient balance');
  }

  const dataIds = await insertJobs(c.env, poolConfig, inputData);
  const resp = await fetch(`${c.env.NODE_SERVICE_URL}/v3/publish_inference_jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.env.INTERNAL_SERVICE_API_KEY}`,
    },
    body: JSON.stringify({
      user: user,
      jobType: 4,
      referenceId: jobs.pool,
    } as NodePublishJobsRequest),
  });
  if (resp.status !== 200) {
    console.log('failed to publish jobs', await resp.text());
    throw new GatewayServiceError(500, 'Failed to publish jobs');
  }
  const result: NodePublishJobsResponse = await resp.json();
  const jobIds = result.data.jobIds;
  await updateJobIds(c.env, poolConfig, jobIds, dataIds);
  await lockSpending(c.env, user, totalCost);
  return result;
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
    const resp = await handleJobRequest(c, data.body.jobs);
    return c.json(resp);
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
    const response = await handleJobRequest(c, new_data);
    if (response.data.jobIds.length !== 1) {
      throw new GatewayServiceError(500, 'Failed to publish jobs');
    }

    const jobId = response.data.jobIds[0];
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

export class SubmitJobOutput extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              jobId: z.number().int(),
              jobOutputs: z.array(jobOutputSchema),
            }),
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Job result submitted successfully',
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
    const pool = await getPool(c.env, data.body.jobId);
    await storeJobOutputs(c.env, pool, data.body.jobId, 0, data.body.jobOutputs);
    return c.json({ message: 'ok' });
  }
}

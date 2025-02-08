import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { getPool } from '../db/pool';
import { settleJobRewards, getBalance, recordPendingCost } from '../db/credit';
import { getJobInput, storeJobOutput, insertJobs, getJobOutputs } from '../kv';
import {
  GatewayServiceContext,
  GatewayServiceError,
  NodeTakeJobResponse,
  NodeFinishJobRequest,
  NodeFinishJobResponse,
  InferenceJobInput,
  NodePublishJobsRequest,
  NodePublishJobsResponse,
  NodeGetJobResultsResponse,
} from '../types';
import { estimateCost } from '../utils';

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
                    jobCtxKey: z.string(),
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
      referenceId: data.query.referenceId.toString(),
    });
    const resp = await fetch(`${c.env.NODE_SERVICE_URL}/v3/take_job?${params.toString()}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.env.INTERNAL_SERVICE_API_KEY}`,
      },
    });
    if (resp.status !== 200) {
      throw new GatewayServiceError(500, 'Failed to take job');
    }
    const result: NodeTakeJobResponse = await resp.json();
    if (!result.data.job) {
      throw new GatewayServiceError(404, 'No job available');
    }
    const jobInput = await getJobInput(c, result.data.job.jobCtxKey);
    return c.json({
      message: 'ok',
      data: {
        job: {
          jobId: result.data.job.jobId,
          jobType: result.data.job.jobType,
          jobCtxKey: result.data.job.jobCtxKey,
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
              jobCtxKey: z.string(),
              jobOutput: z.object({
                rewardResult: z.any().optional(),
                powResult: z.any().optional(),
                inferenceResult: z.any().optional(),
                errorResult: z.any().optional(),
              }),
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
    const jobOutputKey = await storeJobOutput(c, data.body.jobOutput);

    const worker = c.get('userId');
    const nodeRequestData: NodeFinishJobRequest = {
      user: worker,
      jobId: data.body.jobId,
      jobType: data.body.jobType,
      jobCtxKey: data.body.jobCtxKey,
      jobOutputKey: jobOutputKey,
      jobCtx: null,
      jobOutput: null,
    };

    const jobInput = await getJobInput(c, data.body.jobCtxKey);
    if (data.body.jobType !== 4) {
      nodeRequestData.jobCtx = jobInput.context;
      nodeRequestData.jobOutput = data.body.jobOutput;
    }

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
    if (data.body.jobType === 4) {
      const pool = await getPool(c.env, result.data.referenceId);
      const inferenceOutput = data.body.jobOutput.inferenceResult;
      await settleJobRewards(c.env, jobInput, pool, inferenceOutput.usage, worker);
    }
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
  })
  .passthrough();

const jobRequestSchema = z.object({
  jobs: z.object({
    pool: z.number().int(),
    contexts: z.array(ollamaInputSchema),
  }),
});

type JobValidatedData = {
  body: z.infer<typeof jobRequestSchema>;
};

async function handleJobRequest(c: GatewayServiceContext, data: JobValidatedData) {
  const poolConfig = await getPool(c.env, data.body.jobs.pool);
  if (!poolConfig) {
    throw new GatewayServiceError(404, 'Pool not found');
  }

  const inputData = await Promise.all(
    data.body.jobs.contexts.map(async context => {
      return {
        context,
        publisher: c.get('userId'),
        estimatedCost: await estimateCost(poolConfig, context),
      } as InferenceJobInput;
    }),
  );
  const totalCost = inputData.reduce((acc, input) => acc + input.estimatedCost, 0);
  const balance = await getBalance(c.env, c.get('userId'));
  if (balance.balance < totalCost) {
    throw new GatewayServiceError(400, 'Insufficient balance');
  }

  const inputKeys = await insertJobs(c, inputData);
  const resp = await fetch(`${c.env.NODE_SERVICE_URL}/v3/publish_inference_jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.env.INTERNAL_SERVICE_API_KEY}`,
    },
    body: JSON.stringify({
      user: c.get('userId'),
      jobType: 4,
      referenceId: data.body.jobs.pool,
      jobs: inputKeys.map(inputKey => ({
        jobCtxKey: inputKey,
      })),
    } as NodePublishJobsRequest),
  });
  if (resp.status !== 200) {
    console.log('failed to publish jobs', await resp.text());
    throw new GatewayServiceError(500, 'Failed to publish jobs');
  }
  await recordPendingCost(c.env, c.get('userId'), totalCost);
  const result: NodePublishJobsResponse = await resp.json();
  return c.json(result);
}

export class PublishInferenceJobs extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: jobRequestSchema,
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
    return handleJobRequest(c, data);
  }
}

const getJobResultRequestSchema = z.object({
  jobIds: z.string(),
});

type JobResultValidatedData = {
  query: z.infer<typeof getJobResultRequestSchema>;
};

async function handleGetJobResults(c: GatewayServiceContext, data: JobResultValidatedData) {
  const queryParams = new URLSearchParams({
    jobIds: data.query.jobIds,
  });
  const resp = await fetch(`${c.env.NODE_SERVICE_URL}/v3/job_results?${queryParams.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.env.INTERNAL_SERVICE_API_KEY}`,
    },
  });
  if (resp.status !== 200) {
    throw new GatewayServiceError(500, 'Failed to get job results');
  }
  const result: NodeGetJobResultsResponse = await resp.json();
  const outputKeys = result.data.results
    .map(result => result.jobOutputKey)
    .filter(key => key != null);
  const jobOutputs = await getJobOutputs(c, outputKeys);
  return c.json({
    results: result.data.results.map(result => ({
      jobId: result.jobId,
      status: result.status,
      jobOutput: jobOutputs[result.jobOutputKey] || null,
    })),
  });
}

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
                  jobOutput: z
                    .object({
                      rewardResult: z.any().optional(),
                      powResult: z.any().optional(),
                      inferenceResult: z.any().optional(),
                      errorResult: z.any().optional(),
                    })
                    .optional(),
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
    return handleGetJobResults(c, data);
  }
}

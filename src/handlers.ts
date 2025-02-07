import { OpenAPIRoute } from 'chanfana';
import {
  GatewayServiceContext,
  GatewayServiceError,
  InferenceJobInput,
  NodeFinishJobRequest,
  NodeFinishJobResponse,
  NodeGetJobResultsResponse,
  NodeGetQueueStatsResponse,
  NodePublishJobsRequest,
  NodePublishJobsResponse,
  NodeTakeJobResponse,
} from './types';
import { z } from 'zod';
import { storeJobOutput, insertJobs, getJobOutputs, getJobInput } from './kv';
import { deposit, getBalance, recordPendingCost, settleTokenUsage } from './db/token';
import { estimateCost } from './utils';
import { createApiKey, deleteApiKey, getApiKeys } from './db/api_key';
import { createPool, getPool, getPools, updatePool } from './db/pool';

const MIZU_ADMIN_USER = 'admin.mizu';

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

    const nodeRequestData: NodeFinishJobRequest = {
      user: c.get('userId'),
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
      await settleTokenUsage(c.env, jobInput, pool, inferenceOutput.usage);
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

export class PublishInferenceJobs extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              jobs: z.object({
                pool: z.number().int(),
                contexts: z.array(ollamaInputSchema),
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
}

export class GetJobResults extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        jobIds: z.string(),
      }),
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
}

export class GetPoolStats extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        pools: z.string(),
      }),
    },
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              data: z.record(
                z.number(),
                z.object({
                  queueSize: z.number().int(),
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
    const queryParams = new URLSearchParams({
      jobType: '4',
      referenceIds: data.query.pools,
    });
    const resp = await fetch(`${c.env.NODE_SERVICE_URL}/v3/queue_stats?${queryParams.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.env.INTERNAL_SERVICE_API_KEY}`,
      },
    });
    if (resp.status !== 200) {
      throw new GatewayServiceError(500, await resp.text());
    }
    const result: NodeGetQueueStatsResponse = await resp.json();
    return c.json(result);
  }
}

const poolSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  model: z.string(),
  owner: z.string(),
  prices: z.object({
    input: z.number().int(),
    output: z.number().int(),
  }),
  contextLength: z.number().int(),
  maxOutput: z.number().int(),
  status: z.number().int().min(0).max(2),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export class GetPools extends OpenAPIRoute {
  schema = {
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(poolSchema),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const pools = await getPools(c.env);
    return c.json({
      data: pools,
    });
  }
}

export class CreatePool extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              name: z.string(),
              model: z.string(),
              prices: z.object({
                input: z.number().int(),
                output: z.number().int(),
              }),
              contextLength: z.number().int(),
              maxOutput: z.number().int(),
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
              data: z.object({
                id: z.number().int(),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const pool = await createPool(c.env, c.get('userId'), data.body);
    return c.json({ data: { id: pool } });
  }
}

export class GetPool extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        id: z.number().int(),
      }),
    },
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              data: poolSchema,
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const pool = await getPool(c.env, data.query.id);
    return c.json({ data: pool });
  }
}

export class Deposit extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              user: z.string(),
              amount: z.number().int(),
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
              data: z.object({
                deposit: z.number().int(),
                earnings: z.number().int(),
                pendingCost: z.number().int(),
                finalizedCost: z.number().int(),
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
    if (user != MIZU_ADMIN_USER) {
      throw new GatewayServiceError(403, 'Forbidden');
    }
    const balance = await deposit(c.env, data.body.user, data.body.amount);
    return c.json({ message: 'ok', data: balance });
  }
}

export class GetBalance extends OpenAPIRoute {
  schema = {
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              message: z.string().default('ok'),
              data: z.object({
                deposit: z.number().int(),
                earnings: z.number().int(),
                pendingCost: z.number().int(),
                finalizedCost: z.number().int(),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const user = c.get('userId');
    const balance = await getBalance(c.env, user);
    return c.json({ message: 'ok', data: balance });
  }
}

export class UpdatePool extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              id: z.number().int(),
              status: z.number().int().min(0).max(2).optional(),
              prices: z
                .object({
                  input: z.number().int(),
                  output: z.number().int(),
                })
                .optional(),
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
              data: z.object({
                id: z.number().int(),
                name: z.string(),
                model: z.string(),
                owner: z.string(),
                prices: z.object({
                  input: z.number().int(),
                  output: z.number().int(),
                }),
                contextLength: z.number().int(),
                status: z.number().int().min(0).max(2),
                createdAt: z.number().int(),
                updatedAt: z.number().int(),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const existingPool = await getPool(c.env, data.body.id);
    const user = c.get('userId');
    if (user != existingPool.owner) {
      throw new GatewayServiceError(403, 'Forbidden');
    }
    const pool = await updatePool(c.env, existingPool, data.body);
    return c.json({ message: 'ok', data: pool });
  }
}

const apiKeySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  apiKey: z.string(),
  status: z.number().int().min(0).max(2),
  createdAt: z.number().int(),
  updatedAt: z.number().int().optional(),
});

export class CreateApiKey extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              name: z.string(),
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
              data: apiKeySchema,
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const apiKey = await createApiKey(c.env, c.get('userId'), data.body.name);
    return c.json({ message: 'ok', data: apiKey });
  }
}

export class DeleteApiKey extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        id: z.number().int(),
      }),
    },
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              message: z.string().default('ok'),
              success: z.boolean(),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    await deleteApiKey(c.env, data.query.id);
    return c.json({ message: 'ok', success: true });
  }
}

export class ListApiKeys extends OpenAPIRoute {
  schema = {
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              message: z.string().default('ok'),
              data: z.array(apiKeySchema),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const apiKeys = await getApiKeys(c.env, c.get('userId'));
    return c.json({ message: 'ok', data: apiKeys });
  }
}

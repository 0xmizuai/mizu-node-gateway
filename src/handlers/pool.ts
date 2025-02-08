import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
<<<<<<< HEAD
import { getPools, createPool, getPool, updatePool, getUserPools } from '../db/pool';
import { GatewayServiceContext, GatewayServiceError, NodeGetQueueStatsResponse } from '../types';
=======
import { getPools, createPool, getPool, updatePool } from '../db/pool';
import {
  GatewayServiceContext,
  GatewayServiceError,
  NodeGetQueueStatsResponse,
  PoolStatus,
} from '../types';
>>>>>>> 0bfaaa7 (finish chat_completion endpoint)
import { settlePoolRewards } from '../db/credit';

const poolInputSchema = z.object({
  name: z.string(),
  model: z.string(),
  prices: z.object({
    input: z.number(),
    output: z.number(),
  }),
  contextLength: z.number().int(),
  maxOutput: z.number().int(),
  feeRatio: z.number().int().min(0).max(100),
});

const poolSchema = poolInputSchema.extend({
  id: z.number().int(),
  owner: z.string(),
  status: z.number().int().min(0).max(2),
  earnings: z.number().int(),
  settledEarnings: z.number().int(),
  settledAt: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

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
              message: z.string().default('ok'),
              data: z.object({
                stats: z.record(
                  z.number(),
                  z.object({
                    queueSize: z.number().int(),
                  }),
                ),
              }),
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

export class GetUserPools extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        userId: z.string(),
      }),
    },
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
    const data = await this.getValidatedData<typeof this.schema>();
    const pools = await getUserPools(c.env, data.query.userId);
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
            schema: poolInputSchema,
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
      params: z.object({
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
    const pool = await getPool(c.env, data.params.id);
    return c.json({ data: pool });
  }
}

export class UpdatePool extends OpenAPIRoute {
  schema = {
    request: {
      params: z.object({
        id: z.number().int(),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              status: z
                .number()
                .int()
                .min(0)
                .max(2)
                .optional()
                .transform((val): PoolStatus | undefined => val as PoolStatus),
              feeRatio: z.number().int().min(0).max(100).optional(),
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
              data: poolSchema,
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const existingPool = await getPool(c.env, data.params.id);
    const user = c.get('userId');
    if (user != existingPool.owner) {
      throw new GatewayServiceError(403, 'Forbidden');
    }
    const pool = await updatePool(c.env, existingPool, data.body);
    return c.json({ message: 'ok', data: pool });
  }
}

export class SettlePoolRewards extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              id: z.number().int(),
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
    const pool = await getPool(c.env, data.body.id);
    if (pool.owner != c.get('userId')) {
      throw new GatewayServiceError(403, 'Forbidden');
    }
    await settlePoolRewards(c.env, pool);
    return c.json({ message: 'ok' });
  }
}

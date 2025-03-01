import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import {
  getPools,
  createPool,
  getPool,
  updatePool,
  getUserPools,
  getPoolsByIds,
  getTotalPoolCount,
  getUserPoolCount,
} from '../db/pool';
import { GatewayServiceContext, GatewayServiceError, PoolStatus } from '../types';
import { settlePoolRewards } from '../db/credit';
import { cleanUpPool, getPoolStats } from '../db/job_cache';
import { bindPoolWorkerForOwner } from '../db/pool_manage';

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
  isPublic: z.number().int().min(0).max(1),
});

const poolSchema = poolInputSchema.extend({
  id: z.number().int(),
  owner: z.string(),
  status: z.number().int().min(0).max(2),
  earnings: z.number().int(),
  settledEarnings: z.number().int(),
  settledAt: z.number().int(),
  isPublic: z.number().int().min(0).max(1),
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
                    status: z.number().int(),
                    count: z.number().int(),
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
    const poolIds = data.query.pools.split(',').map(id => parseInt(id));
    const pools = await getPoolsByIds(c.env, poolIds);
    const stats = await getPoolStats(c.env, pools);
    return c.json({ data: { stats } });
  }
}

export class GetUserPools extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        pageSize: z.number().int().min(1).max(200).default(50).optional(),
        page: z.number().int().min(0).default(1).optional(),
      }),
    },
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(poolSchema),
              totalPools: z.number().int(),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const userId = c.get('userId');
    const data = await this.getValidatedData<typeof this.schema>();
    const pageSize = data.query.pageSize ?? 50;
    const page = data.query.page ?? 1;
    const totalPools = await getUserPoolCount(c.env, userId);
    const pools = await getUserPools(c.env, userId, page, pageSize);
    return c.json({
      data: pools,
      totalPools,
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
    console.log('pool', pool);
    await bindPoolWorkerForOwner(c.env, pool, c.get('userId'), c.get('userKey'));
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

export class GetPools extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        pageSize: z.number().int().min(1).max(200).default(50).optional(),
        page: z.number().int().min(0).default(1).optional(),
      }),
    },
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(poolSchema),
              totalPages: z.number().int(),
              totalPools: z.number().int(),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const pageSize = data.query.pageSize ?? 50;
    const page = data.query.page ?? 1;
    const totalPools = await getTotalPoolCount(c.env);
    const totalPages = Math.ceil(totalPools / pageSize);
    if (page > totalPages) {
      throw new GatewayServiceError(400, 'Invalid page');
    }
    const pools = await getPools(c.env, page, pageSize);
    return c.json({
      totalPages,
      totalPools,
      data: pools,
    });
  }
}

export class CleanUpPool extends OpenAPIRoute {
  schema = {
    request: {
      params: z.object({
        id: z.number().int(),
      }),
    },
    responses: {
      '200': {
        description: '',
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    await cleanUpPool(c.env, data.params.id);
    return c.json({ message: 'ok' });
  }
}

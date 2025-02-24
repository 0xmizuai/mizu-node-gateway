import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import {
  applyPoolUser,
  applyPoolWorker,
  createPoolWorkerForPublicPool,
  getPoolUser,
  getPoolUserByUserId,
  getPoolUsers,
  getPoolWorker,
  getPoolWorkerByWorkerId,
  getPoolWorkers,
  getTotalPoolUserCount,
  getTotalPoolWorkerCount,
  updatePoolUserStatus,
  updatePoolWorkerStatus,
} from '../db/pool_manage';
import { GatewayServiceContext, GatewayServiceError } from '../types';
import { getPool } from '../db/pool';

const applyPoolWorkerInputSchema = z.object({
  poolId: z.number().int(),
});

const poolWorkerSchema = z.object({
  id: z.number().int(),
  poolId: z.number().int(),
  workerId: z.string(),
  workerKey: z.string(),
  status: z.number().int(),
});

const poolUserSchema = z.object({
  id: z.number().int(),
  poolId: z.number().int(),
  userId: z.string(),
  userKey: z.string(),
  status: z.number().int(),
});

export class WorkerStart extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              poolId: z.number().int(),
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
              data: z.object({}),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const poolId = data.body.poolId;

    const pool = await getPool(c.env, poolId);
    if (!pool) {
      throw new GatewayServiceError(400, 'Pool not found');
    }

    console.log(pool);

    // Private pool
    if (pool.isPublic === 0) {
      const currentPoolWorker = await getPoolWorkerByWorkerId(c.env, poolId, c.get('userId'));
      if (currentPoolWorker?.status !== 1) {
        throw new GatewayServiceError(400, 'You are not approved to work for this pool');
      }

      return c.json({ data: {} });
    } else {
      // Public pool

      const poolWorker = await createPoolWorkerForPublicPool(
        c.env,
        poolId,
        c.get('userId'),
        c.get('userKey'),
      );
      return c.json({ data: {} });
    }
  }
}

export class GetPoolWorkers extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        poolId: z.number().int(),
        scene: z.enum(['active', 'waiting', 'rejected']).default('active').optional(),
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
              data: z.array(poolWorkerSchema),
              totalPages: z.number().int(),
              totalCount: z.number().int(),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const poolId = data.query.poolId;
    const pageSize = data.query.pageSize ?? 50;
    const page = data.query.page ?? 1;
    const scene = data.query.scene ?? 'active';
    const totalCount = await getTotalPoolWorkerCount(c.env, scene, poolId);
    const totalPages = Math.ceil(totalCount / pageSize);
    const poolWorkers = await getPoolWorkers(c.env, scene, poolId, page, pageSize);
    return c.json({
      totalPages,
      totalCount,
      data: poolWorkers,
    });
  }
}

export class GetWorkerCounts extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        poolId: z.number().int(),
      }),
    },
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              activeTotalCount: z.number().int(),
              waitingTotalCount: z.number().int(),
              rejectedTotalCount: z.number().int(),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const poolId = data.query.poolId;
    const activeTotalCount = await getTotalPoolWorkerCount(c.env, 'active', poolId);
    const waitingTotalCount = await getTotalPoolWorkerCount(c.env, 'waiting', poolId);
    const rejectedTotalCount = await getTotalPoolWorkerCount(c.env, 'rejected', poolId);
    return c.json({
      activeTotalCount,
      waitingTotalCount,
      rejectedTotalCount,
    });
  }
}

export class GetPoolWorkerStatus extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        poolId: z.number().int(),
      }),
    },
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              data: z.object({}),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const poolId = data.query.poolId;
    const poolWorker = await getPoolWorkerByWorkerId(c.env, poolId, c.get('userId'));
    return c.json({
      data: poolWorker,
    });
  }
}

export class ApplyPoolWorker extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: applyPoolWorkerInputSchema,
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
              data: z.object({}),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const poolId = data.body.poolId;

    const currentPoolWorker = await getPoolWorkerByWorkerId(c.env, poolId, c.get('userId'));
    if (currentPoolWorker?.status === 2) {
      throw new GatewayServiceError(400, 'You are rejected from this pool');
    }

    const poolWorker = await applyPoolWorker(c.env, poolId, c.get('userId'), c.get('userKey'));
    return c.json({ data: {} });
  }
}

export class ManagePoolWorker extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              recordId: z.number().int(),
              operation: z.enum(['approve', 'reject', 'remove', 'removeRejected']),
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
              data: z.object({}),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const recordId = data.body.recordId;
    const operation = data.body.operation;

    const poolWorker = await getPoolWorker(c.env, recordId);
    if (!poolWorker) {
      throw new GatewayServiceError(400, 'Pool worker not found');
    }
    const pool = await getPool(c.env, poolWorker.poolId);
    if (!pool) {
      throw new GatewayServiceError(400, 'Pool not found');
    }
    if (pool.owner !== c.get('userId')) {
      throw new GatewayServiceError(400, 'You are not the owner of this pool');
    }

    const newStatus =
      operation === 'approve'
        ? 1
        : operation === 'reject'
        ? 2
        : operation === 'removeRejected'
        ? 3
        : 0;
    await updatePoolWorkerStatus(c.env, recordId, newStatus);
    return c.json({ data: {} });
  }
}

export class GetPoolUsers extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        poolId: z.number().int(),
        scene: z.enum(['active', 'waiting', 'rejected']).default('active').optional(),
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
              data: z.array(poolUserSchema),
              totalPages: z.number().int(),
              totalCount: z.number().int(),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const poolId = data.query.poolId;
    const pageSize = data.query.pageSize ?? 50;
    const page = data.query.page ?? 1;
    const scene = data.query.scene ?? 'active';
    const totalCount = await getTotalPoolUserCount(c.env, scene, poolId);
    const totalPages = Math.ceil(totalCount / pageSize);
    const poolUsers = await getPoolUsers(c.env, scene, poolId, page, pageSize);
    return c.json({
      totalPages,
      totalCount,
      data: poolUsers,
    });
  }
}

export class GetPoolUserStatus extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        poolId: z.number().int(),
      }),
    },
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              data: z.object({}),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const poolId = data.query.poolId;
    const poolUser = await getPoolUserByUserId(c.env, poolId, c.get('userId'));
    return c.json({
      data: poolUser,
    });
  }
}

export class ApplyPoolUser extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              poolId: z.number().int(),
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
              data: z.object({}),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const poolId = data.body.poolId;

    const currentPoolUser = await getPoolUserByUserId(c.env, poolId, c.get('userId'));
    if (currentPoolUser?.status === 2) {
      throw new GatewayServiceError(400, 'You are rejected from this pool');
    }

    const poolUser = await applyPoolUser(c.env, poolId, c.get('userId'), c.get('userKey'));
    return c.json({ data: {} });
  }
}

export class ManagePoolUser extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              recordId: z.number().int(),
              operation: z.enum(['approve', 'reject', 'remove', 'removeRejected']),
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
              data: z.object({}),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const recordId = data.body.recordId;
    const operation = data.body.operation;

    const poolUser = await getPoolUser(c.env, recordId);
    if (!poolUser) {
      throw new GatewayServiceError(400, 'Pool user not found');
    }
    const pool = await getPool(c.env, poolUser.poolId);
    if (!pool) {
      throw new GatewayServiceError(400, 'Pool not found');
    }
    if (pool.owner !== c.get('userId')) {
      throw new GatewayServiceError(400, 'You are not the owner of this pool');
    }

    const newStatus =
      operation === 'approve'
        ? 1
        : operation === 'reject'
        ? 2
        : operation === 'removeRejected'
        ? 3
        : 0;
    await updatePoolUserStatus(c.env, recordId, newStatus);
    return c.json({ data: {} });
  }
}

export class GetUserCounts extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({
        poolId: z.number().int(),
      }),
    },
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              activeTotalCount: z.number().int(),
              waitingTotalCount: z.number().int(),
              rejectedTotalCount: z.number().int(),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const poolId = data.query.poolId;
    const activeTotalCount = await getTotalPoolUserCount(c.env, 'active', poolId);
    const waitingTotalCount = await getTotalPoolUserCount(c.env, 'waiting', poolId);
    const rejectedTotalCount = await getTotalPoolUserCount(c.env, 'rejected', poolId);
    return c.json({
      activeTotalCount,
      waitingTotalCount,
      rejectedTotalCount,
    });
  }
}

import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import {
  applyPoolWorker,
  getPoolWorker,
  getPoolWorkerByWorkerId,
  getPoolWorkers,
  getTotalPoolWorkerCount,
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

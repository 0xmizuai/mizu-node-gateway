import { OpenAPIRoute } from 'chanfana';
import { GatewayServiceContext, GatewayServiceError } from '../types';
import { z } from 'zod';
import { deposit, getBalance, initUser } from '../db/credit';

const MIZU_ADMIN_USER = 'admin.mizu';

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
              data: balanceSchema,
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

const balanceSchema = z.object({
  balance: z.number().int().optional(),
  deposit: z.number().int(),
  earnings: z.number().int(),
  lockedSpending: z.number().int(),
  spending: z.number().int(),
});

export class GetBalance extends OpenAPIRoute {
  schema = {
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              message: z.string().default('ok'),
              data: balanceSchema,
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

export class InitUser extends OpenAPIRoute {
  schema = {
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
    const user = c.get('userId');
    await initUser(c.env, user);
    return c.json({ message: 'ok' });
  }
}

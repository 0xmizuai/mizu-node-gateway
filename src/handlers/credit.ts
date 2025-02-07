import { OpenAPIRoute } from 'chanfana';
import { GatewayServiceContext, GatewayServiceError } from '../types';
import { z } from 'zod';
import { deposit, getBalance } from '../db/token';

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

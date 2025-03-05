import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { GatewayServiceContext } from '../types';
import { calculateUserCredits, updateUserClaimedStatus } from '../db/balance_points';
import { updateCredits } from '../db/credit';

export class CalculateCredits extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              isNew: z.boolean(),
            }),
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              code: z.number(),
              data: z.object({
                totalCredits: z.number(),
                details: z.object({
                  emailBalance: z.number(),
                  tgBalance: z.number(),
                  emailPoints: z.number(),
                  tgPoints: z.number(),
                }),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { isNew } = data.body;
    const userKey = c.get('userKey');
    const userId = c.get('userId');

    if (!userKey || !userId || typeof isNew !== 'boolean') {
      return c.json({
        code: 1,
        message: 'Invalid parameters',
        data: {
          totalCredits: 0,
          details: {
            emailBalance: 0,
            tgBalance: 0,
            emailPoints: 0,
            tgPoints: 0,
          },
        },
      });
    }

    try {
      const result = await calculateUserCredits(c.env, userKey, userId);

      if (!result) {
        throw new Error('Failed to calculate credits');
      }

      const calculateCredits = (items: any[] = [], multiplier: number) => {
        console.log('Calculating items:', items);
        return Math.floor(
          items.reduce((sum: number, item: any) => {
            if (item?.isCalculate === 0) {
              if (item?.tokenBalance) {
                const balance = BigInt(item.tokenBalance);
                const calculated = (Number(balance) / Math.pow(10, 18)) * multiplier;
                return sum + calculated;
              } else if (typeof item?.claimedPoint === 'number') {
                const calculated = item.claimedPoint * multiplier;
                return sum + calculated;
              }
            }
            return sum;
          }, 0),
        );
      };

      const emailBalance = calculateCredits(result.emailBalance, 1000000);
      const tgBalance = calculateCredits(result.tgBalance, 1000000);
      const emailPoints = calculateCredits(result.emailPoints, 100);
      const tgPoints = calculateCredits(result.tgPoints, 100);

      const totalCredits = Math.floor(
        emailPoints + tgPoints + emailBalance + tgBalance + (isNew ? 1000000 : 0),
      );

      return c.json({
        code: 0,
        data: {
          totalCredits,
          details: {
            emailBalance,
            tgBalance,
            emailPoints,
            tgPoints,
          },
        },
      });
    } catch (error) {
      console.error('Calculate credits error:', error);
      return c.json(
        {
          code: 1,
          message: error || 'Failed to calculate credits',
          data: null,
        },
        500,
      );
    }
  }
}

export class UpdateClaimedStatus extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              claimedCount: z.number().int(),
            }),
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              code: z.number(),
              data: z.boolean(),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      const { claimedCount } = data.body;
      const userKey = c.get('userKey');
      const userId = c.get('userId');

      await updateCredits(c.env, userId, claimedCount);
      await updateUserClaimedStatus(c.env, userKey, userId);

      return c.json({
        code: 0,
        data: true,
      });
    } catch (error) {
      console.error('Update claimed status error:', error);
      return c.json(
        {
          code: 1,
          message: error || 'Failed to update claimed status',
          data: null,
        },
        500,
      );
    }
  }
}

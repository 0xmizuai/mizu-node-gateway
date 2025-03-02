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

    const result = await calculateUserCredits(c.env, userKey, userId, isNew);

    // 计算积分
    const calculateCredits = (items: any[], multiplier: number) => {
      return Math.floor(
        (items || []).reduce((sum: number, item: any) => {
          if (!item.is_calculate) {
            const value = Number(item.claimed_point || item.token_balance) || 0;
            return sum + value * multiplier;
          }
          return sum;
        }, 0),
      );
    };

    const balanceCredits = calculateCredits(
      [...(result.emailBalance || []), ...(result.tgBalance || [])],
      1000000,
    );
    const pointCredits = calculateCredits(
      [...(result.emailPoints || []), ...(result.tgPoints || [])],
      100,
    );

    // 计算各项明细
    const emailBalance = calculateCredits(result.emailBalance || [], 1000000);
    const tgBalance = calculateCredits(result.tgBalance || [], 1000000);
    const emailPoints = calculateCredits(result.emailPoints || [], 100);
    const tgPoints = calculateCredits(result.tgPoints || [], 100);

    const totalCredits = Math.floor(pointCredits + balanceCredits + (result.isNew ? 1000000 : 0));

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
    const { claimedCount } = data.body;
    const userKey = c.get('userKey');
    const userId = c.get('userId');

    // 1. 先更新积分数据
    await updateCredits(c.env, userId, claimedCount);

    // 2. 再标记状态为已计算
    await updateUserClaimedStatus(c.env, userKey, userId);

    return c.json({
      code: 0,
      data: true,
    });
  }
}

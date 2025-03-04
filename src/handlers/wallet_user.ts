import { OpenAPIRoute } from 'chanfana';
import { GatewayServiceContext } from '../types';
import { getWalletByUser, updateWalletAddressByUser } from '../db/wallet_user';
import { z } from 'zod';

export class WalletAddress extends OpenAPIRoute {
  schema = {
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: {
              code: {
                type: 'number',
              },
              data: {
                address: {
                  type: 'string',
                },
                userId: {
                  type: 'string',
                },
              },
            },
          },
        },
      },
    },
  };
  async handle(c: GatewayServiceContext) {
    const userId = c.get('userId');
    try {
      if (!userId) {
        return new Response(
          JSON.stringify({
            code: -1,
            message: 'Auth failed',
          }),
          {
            status: 200,
          },
        );
      }
      const walletUser = await getWalletByUser(c.env, userId);
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            ...walletUser,
          },
        }),
        {
          status: 200,
        },
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          code: -1,
          message: 'Internal server error',
        }),
        {
          status: 500,
        },
      );
    }
  }
}

export class UpdateWalletAddress extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              address: z.string(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: {
              code: {
                type: 'number',
              },
              data: {
                address: {
                  type: 'string',
                },
                userId: {
                  type: 'string',
                },
              },
            },
          },
        },
      },
    },
  };
  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { address } = data.body;
    const userId = c.get('userId');

    try {
      if (!userId) {
        return new Response(
          JSON.stringify({
            code: -1,
            message: 'Auth failed',
          }),
          {
            status: 200,
          },
        );
      }
      if (!address) {
        return new Response(
          JSON.stringify({
            code: -1,
            message: 'Invalid address',
          }),
          {
            status: 200,
          },
        );
      }

      const walletUser = await updateWalletAddressByUser(c.env, userId, address);
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            ...walletUser,
          },
        }),
        {
          status: 200,
        },
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          code: -1,
          message: 'Internal server error',
        }),
        {
          status: 500,
        },
      );
    }
  }
}

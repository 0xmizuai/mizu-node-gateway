import { OpenAPIRoute } from 'chanfana';
import { createTgUser, getTgUser } from '../db/tg_user';
import { GatewayServiceContext } from '../types';
import { z } from 'zod';

export interface TgAuthRequest {
  body: {
    authData: {
      auth_date: number;
      first_name: string;
      hash: string;
      id: number;
      last_name?: string;
      photo_url?: string;
      username?: string;
    };
  };
}

export class TgVerify extends OpenAPIRoute {
  schema = {
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: {
              code: {
                type: 'number',
              },
              data: {
                type: 'boolean',
              },
            },
          },
        },
      },
    },
  };
  async handle(c: GatewayServiceContext) {
    const userId = c.get('userId');
    if (!userId) {
      return new Response(JSON.stringify({ code: -1, success: false }), { status: 400 });
    }

    const tgUser = await getTgUser(c.env, userId);
    return new Response(
      JSON.stringify({
        code: 0,
        data: {
          ...tgUser,
        },
      }),
      {
        status: 200,
      },
    );
  }
}

export class TgLink extends OpenAPIRoute {
  static schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              authData: z.object({
                auth_date: z.number(),
                first_name: z.string(),
                hash: z.string(),
                id: z.number(),
                last_name: z.string().optional(),
                photo_url: z.string().optional(),
                username: z.string(),
              }),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: {
              code: { type: 'number' },
              data: { type: 'object' },
            },
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const userId = c.get('userId');
    const userKey = c.get('userKey');

    if (!userId || !userKey) {
      return c.json({ code: -1, message: 'Unauthorized' }, 401);
    }

    try {
      const data = await this.getValidatedData();
      if (!data?.body?.authData) {
        return c.json({ code: -1, message: 'Invalid auth data' }, 400);
      }
      const { authData } = data.body;
      const newTgUser = await createTgUser(c.env, {
        userId,
        tgId: authData.id.toString(),
        photoUrl: authData.photo_url || '',
        firstName: authData.first_name || '',
        username: authData.username || '',
        lastName: authData.last_name || '',
        authDate: authData.auth_date,
      });

      return c.json({
        code: 0,
        data: {
          ...newTgUser,
        },
      });
    } catch (error) {
      console.error('TG link error:', error);
      return c.json({
        code: -1,
        message: error instanceof Error ? error.message : 'Failed to link Telegram',
      });
    }
  }
}

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
            schema: {
              type: 'object',
              properties: {
                authData: {
                  type: 'object',
                  properties: {
                    auth_date: {
                      type: 'number',
                    },
                    first_name: {
                      type: 'string',
                    },
                    hash: {
                      type: 'string',
                    },
                    id: {
                      type: 'number',
                    },
                    last_name: {
                      type: 'string',
                    },
                    photo_url: {
                      type: 'string',
                    },
                    username: {
                      type: 'string',
                    },
                  },
                  required: ['auth_date', 'first_name', 'hash', 'id'],
                },
              },
              required: ['authData'],
            },
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
      const rawData = await c.req.json();
      if (!rawData?.authData) {
        return c.json({ code: -1, message: 'Invalid auth data' }, 400);
      }
      const { authData } = rawData;
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
      return c.json(
        {
          code: -1,
          message: error instanceof Error ? error.message : 'Failed to link Telegram',
        },
        500,
      );
    }
  }
}

import { OpenAPIRoute } from 'chanfana';
import { createTgUser, getTgUser } from '../db/tg_user';
import { GatewayServiceContext } from '../types';
import { Itguser } from '../types/tgUser';
import { AuthDataValidator, urlStrToAuthDataMap } from '@telegram-auth/server';

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

const validateTelegramUser = async (
  authData: Record<string, string | number>,
  BOT_TOKEN: string,
): Promise<Itguser> => {
  const url = 'https://oauth.telegram.org/auth';
  const queryString = Object.keys(authData)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(authData[key])}`)
    .join('&');
  const serializedUrl = `${url}?${queryString}`;

  const validator = new AuthDataValidator({
    botToken: BOT_TOKEN || '',
    inValidateDataAfter: 3600 * 24 * 7,
  });
  const data = urlStrToAuthDataMap(serializedUrl);
  const validatedData = await validator.validate(data);
  return {
    tgId: validatedData.id.toString(),
    username: validatedData.username || '',
    firstName: validatedData.first_name || '',
    lastName: validatedData.last_name || '',
    photoUrl: validatedData.photo_url || '',
  };
};

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
                  additionalProperties: true,
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
      const data: any = await this.getValidatedData<typeof this.schema>();
      const { authData } = data.body;
      const telegramUser = await validateTelegramUser(authData, c.env.BOT_TOKEN);
      const newTgUser = await createTgUser(c.env, {
        userId,
        tgId: telegramUser.tgId.toString(),
        photoUrl: telegramUser.photoUrl || '',
        firstName: telegramUser.firstName || '',
        username: telegramUser.username || '',
        lastName: telegramUser.lastName || '',
        authDate: telegramUser.authDate,
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

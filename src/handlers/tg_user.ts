import { OpenAPIRoute } from 'chanfana';
import { getTgUser } from '../db/tg_user';
import { GatewayServiceContext } from '../types';

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
                type: 'object',
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
    return new Response(JSON.stringify({ code: 0, data: tgUser }), {
      status: 200,
    });
  }
}

import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { createApiKey, deleteApiKey, getApiKeys } from '../db/api_key';
import { GatewayServiceContext } from '../types';

const apiKeySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  apiKey: z.string(),
  status: z.number().int().min(0).max(2),
  createdAt: z.number().int(),
  updatedAt: z.number().int().optional(),
});

export class CreateApiKey extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              name: z.string(),
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
              data: apiKeySchema,
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const apiKey = await createApiKey(c.env, c.get('userId'), data.body.name);
    return c.json({ message: 'ok', data: apiKey });
  }
}

export class DeleteApiKey extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              id: z.number().int(),
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
              success: z.boolean(),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    await deleteApiKey(c.env, data.body.id);
    return c.json({ message: 'ok', success: true });
  }
}

export class ListApiKeys extends OpenAPIRoute {
  schema = {
    responses: {
      '200': {
        description: '',
        content: {
          'application/json': {
            schema: z.object({
              message: z.string().default('ok'),
              data: z.array(apiKeySchema),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    const apiKeys = await getApiKeys(c.env, c.get('userId'));
    return c.json({ message: 'ok', data: apiKeys });
  }
}

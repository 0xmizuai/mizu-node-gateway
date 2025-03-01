import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { getPools } from '../db/pool';
import { GatewayServiceContext } from '../types';

export class CleanDatabase extends OpenAPIRoute {
  schema = {
    request: {
      query: z.object({}),
    },
    responses: {
      '200': {
        description: 'Job',
        content: {
          'application/json': {
            schema: z.object({
              message: z.string(),
              data: z.object({
                job: z
                  .object({
                    jobId: z.string().or(z.number().int()),
                    jobType: z.number().int(),
                    jobCtx: z.any(),
                  })
                  .optional(),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: GatewayServiceContext) {
    // Delete all database
    const res = await listDatabases(c.env);
    const databases = res.result;

    for (const database of databases) {
      if (database.name.startsWith('pool_cache_')) {
        await deleteDatabase(c.env, database.uuid);
      }
    }

    return c.json({
      message: 'ok',
      data: {},
    });

    while (true) {
      const pools = await getPools(c.env, 1, 100);
      if (pools.length === 0) {
        break;
      }
      for (const pool of pools) {
        // Delete pool_cache_* d1 database
        await deleteDatabase(c.env, pool.databaseId);
      }
    }

    await c.env.DB.exec('DROP TABLE IF EXISTS api_keys');
    await c.env.DB.exec('DROP TABLE IF EXISTS earnings');
    await c.env.DB.exec('DROP TABLE IF EXISTS pool_users');
    await c.env.DB.exec('DROP TABLE IF EXISTS pool_workers');
    await c.env.DB.exec('DROP TABLE IF EXISTS pools');
    await c.env.DB.exec('DROP TABLE IF EXISTS spending');
    await c.env.DB.exec('DROP TABLE IF EXISTS users');

    // Delete pool_cache_* databases

    return c.json({
      message: 'ok',
      data: {},
    });
  }
}

interface D1Database {
  uuid: string;
  name: string;
}

async function listDatabases(env: Env): Promise<{ result: D1Database[] }> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database`;
  const result = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
    },
  });

  return result.json();
}

async function deleteDatabase(env: Env, dbId: string) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${dbId}`;
  const result = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
    },
  });

  if (!result.ok) {
    throw new Error(`Failed to delete database ${dbId}: ${result.statusText}`);
  } else {
    console.log(`Deleted database ${dbId}`);
  }
}

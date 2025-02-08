import { ApiKey, ApiKeyStatus, GatewayServiceError } from '../types';

export async function getApiKeys(env: Env, userId: string): Promise<ApiKey[]> {
  const stmt = env.DB.prepare('SELECT * FROM api_keys WHERE user_id = ?');
  const result = await stmt.bind(userId).all();
  return result.results.map(
    row =>
      ({
        id: Number(row.id),
        name: row.name as string,
        apiKey: row.api_key as string,
        status: Number(row.status) as ApiKeyStatus,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      } as ApiKey),
  );
}

export async function createApiKey(env: Env, userId: string, name: string): Promise<ApiKey> {
  const key = await crypto.subtle
    .digest('SHA-256', crypto.getRandomValues(new Uint8Array(32)))
    .then(buf =>
      Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(''),
    );
  const now = Math.floor(Date.now() / 1000);
  const stmt = env.DB.prepare(
    'INSERT INTO api_keys (name, api_key, user, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
  );
  const result = await stmt.bind(name, key, userId, now, now).first();
  if (result === null) {
    throw new GatewayServiceError(500, 'Failed to create API key');
  }
  return {
    id: Number(result.id),
    name: result.name as string,
    apiKey: key,
    status: ApiKeyStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
  } as ApiKey;
}

export async function deleteApiKey(env: Env, id: number): Promise<void> {
  const stmt = env.DB.prepare('UPDATE api_keys SET status = ? WHERE id = ?');
  await stmt.bind(ApiKeyStatus.DELETED, id).run();
}

export async function getUserFromApiKey(env: Env, apiKey: string): Promise<number | null> {
  const stmt = env.DB.prepare('SELECT user_id FROM api_keys WHERE api_key = ? AND status = ?');
  const result = await stmt.bind(apiKey, ApiKeyStatus.ACTIVE).first();
  if (!result) {
    return null;
  }
  return Number(result.user_id);
}

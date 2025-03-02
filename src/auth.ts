import * as jose from 'jose';
import { Next } from 'hono';

import { GatewayServiceContext } from './types';
import { getUserFromApiKey } from './db/api_key';

export async function serviceApiKeyAuthMiddleware(c: GatewayServiceContext, next: Next) {
  const apiKey = c.req.header('X-API-KEY');
  if (apiKey !== c.env.INTERNAL_SERVICE_API_KEY) {
    return c.text('Unauthorized', 401);
  }
  await next();
}

// Authentication middleware for JWT or API_KEY
export async function jwtOrApiKeyAuthMiddleware(c: GatewayServiceContext, next: Next) {
  try {
    const token = getBearer(c);
    if (token.startsWith('mizu-')) {
      const userId = await getUserFromApiKey(c.env, token);
      if (!userId) {
        return c.text('Unauthorized', 401);
      }
      c.set('userId', userId);
      await next();
    } else {
      const { userId, userKey } = await verifyJWT(token, c.env.JWT_PUB_KEY);
      c.set('userId', userId);
      c.set('userKey', userKey);
      await next();
    }
  } catch (error) {
    return c.text('Unauthorized', 401);
  }
}

// Authentication middleware for JWT (Mizu users)
export async function jwtAuthMiddleware(c: GatewayServiceContext, next: Next) {
  try {
    const token = getBearer(c);
    const { userId, userKey } = await verifyJWT(token, c.env.JWT_PUB_KEY);
    c.set('userId', userId);
    c.set('userKey', userKey);
    await next();
  } catch (error) {
    console.error('....error ..', error);
    return c.text('Unauthorized', 401);
  }
}

// Authentication layer for API_KEY (external users)
export async function apiKeyAuthMiddleware(c: GatewayServiceContext, next: Next) {
  try {
    const token = getBearer(c);
    if (token.startsWith('mizu-')) {
      const userId = await getUserFromApiKey(c.env, token);
      if (!userId) {
        return c.text('Unauthorized', 401);
      }
      c.set('userId', userId.toString());
    } else {
      return c.text('Unauthorized', 401);
    }
    await next();
  } catch (error) {
    return c.text('Unauthorized', 401);
  }
}

// JWT verification helper
async function verifyJWT(
  token: string,
  publicKey: string,
): Promise<{ userId: string; userKey: string }> {
  try {
    const publicKeyObj = await jose.importSPKI(publicKey, 'EdDSA');
    const { payload } = await jose.jwtVerify(token, publicKeyObj);
    const subject = (payload as jose.JWTPayload).sub as string;
    const parsedSubject = JSON.parse(subject);
    return { userId: parsedSubject.userId, userKey: parsedSubject.userKey };
  } catch (error) {
    throw new Error('Invalid token');
  }
}

function getBearer(c: GatewayServiceContext): string {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Invalid token');
  }
  return authHeader.split(' ')[1];
}

import * as jose from 'jose';
import { Next } from 'hono';

import { GatewayServiceContext } from './types';
import { getUserFromApiKey } from './db/api_key';

// Authentication middleware
export async function authMiddleware(c: GatewayServiceContext, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.text('Unauthorized', 401);
  }

  try {
    const token = authHeader.split(' ')[1];
    if (token.startsWith('mizu-')) {
      const userId = await getUserFromApiKey(c.env, token);
      if (!userId) {
        return c.text('Unauthorized', 401);
      }
      c.set('userId', userId.toString());
    } else {
      const userId = await verifyJWT(token, c.env.JWT_PUB_KEY);
      c.set('userId', userId);
    }
    await next();
  } catch (error) {
    return c.text('Unauthorized', 401);
  }
}

// JWT verification helper
async function verifyJWT(token: string, publicKey: string): Promise<string> {
  try {
    const publicKeyObj = await jose.importSPKI(publicKey, 'EdDSA');
    const { payload } = await jose.jwtVerify(token, publicKeyObj);
    const subject = (payload as jose.JWTPayload).sub as string;
    const parsedSubject = JSON.parse(subject);
    return parsedSubject.userId;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

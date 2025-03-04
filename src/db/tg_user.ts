import { eq, and, or, isNull } from 'drizzle-orm';
import { createDb } from './index';
import { tgUsers } from '../schema/tgUser';
import { Itguser } from '../types/tgUser';
import { Env } from '../../worker-configuration';

export async function getTgUser(env: Env, userId: string) {
  if (!env?.DB || !userId) {
    console.error('Invalid parameters:', { env: !!env?.DB, userId });
    throw new Error('Missing required parameters');
  }
  try {
    const db = createDb(env.DB);
    const tgUserQuery = await db.select().from(tgUsers).where(eq(tgUsers.userId, userId));
    return tgUserQuery[0];
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

export async function createTgUser(env: Env, data: Itguser) {
  if (!env?.DB) {
    throw new Error('Database connection required');
  }

  const db = createDb(env.DB);

  // Ensure required fields are present
  if (!data.userId || !data.tgId) {
    throw new Error('userId and tgId are required');
  }

  const insertData = {
    userId: data.userId,
    tgId: data.tgId,
    username: data.username || null,
    photoUrl: data.photoUrl || null,
    firstName: data.firstName || null,
    lastName: data.lastName || null,
    authDate: data.authDate || null,
  } as const;

  const result = await db.insert(tgUsers).values(insertData).returning();

  return result[0];
}

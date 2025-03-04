import { eq, and, or, isNull } from 'drizzle-orm';
import { createDb } from './index';
import { tgUsers } from '../schema/tgUser';

export async function getTgUser(env: Env, userId: string) {
  if (!env?.DB || !userId) {
    console.error('Invalid parameters:', { env: !!env?.DB, userId });
    throw new Error('Missing required parameters');
  }
  try {
    const db = createDb(env.DB);
    const tgUserQuery = await db
      .select({
        tgId: tgUsers.tgId,
        userId: tgUsers.userId,
      })
      .from(tgUsers)
      .where(eq(tgUsers.userId, userId));
    return tgUserQuery[0];
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

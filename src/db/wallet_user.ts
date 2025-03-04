import { createDb } from '.';
import { Env } from '../../worker-configuration';
import { walletUsers } from '../schema/walletUser';
import { eq } from 'drizzle-orm';

export async function getWalletByUser(env: Env, userId: string) {
  if (!env?.DB || !userId) {
    console.error('Invalid parameters:', { env: !!env?.DB, userId });
    throw new Error('Missing required parameters');
  }
  try {
    const db = createDb(env.DB);
    const tgUserQuery = await db.select().from(walletUsers).where(eq(walletUsers.userId, userId));
    return tgUserQuery[0];
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

export async function updateWalletAddressByUser(env: Env, userId: string, address: string) {
  if (!env?.DB || !userId || !address) {
    console.error('Invalid parameters:', { env: !!env?.DB, userId, address });
    throw new Error('Missing required parameters');
  }
  try {
    const db = createDb(env.DB);
    const tgUserQuery = await db
      .update(walletUsers)
      .set({ address: address })
      .where(eq(walletUsers.userId, userId));
    return tgUserQuery;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

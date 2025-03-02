import { tgUsers } from '../schema/tgUser';
import { userBalance } from '../schema/userBalance';
import { userRewardPoints } from '../schema/userPoint';
import { walletUsers } from '../schema/walletUser';
import { drizzle } from 'drizzle-orm/d1';

export function createDb(db: D1Database) {
  return drizzle(db, {
    schema: {
      tgUsers,
      userBalance,
      userRewardPoints,
      walletUsers,
    },
  });
}

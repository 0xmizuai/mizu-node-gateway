import { eq, and, or, isNull } from 'drizzle-orm';
import { createDb } from './index';
import { tgUsers } from '../schema/tgUser';
import { userBalance } from '../schema/userBalance';
import { userRewardPoints } from '../schema/userPoint';

export async function calculateUserCredits(env: Env, userKey: string, userId: string) {
  if (!env?.DB || !userKey || !userId) {
    console.error('Invalid parameters:', { env: !!env?.DB, userKey, userId });
    throw new Error('Missing required parameters');
  }

  try {
    const db = createDb(env.DB);

    const tgUser = await db.query.tgUsers.findFirst({
      where: eq(tgUsers.userId, userId),
      columns: { tgId: true },
    });

    const balanceCondition = eq(userBalance.tokenAddress, env.TOKEN_ADDRESS || '');

    const [emailBalance, emailPoints, tgBalance, tgPoints] = await Promise.all([
      db
        .select()
        .from(userBalance)
        .where(and(balanceCondition, eq(userBalance.userKey, userKey))),
      db.select().from(userRewardPoints).where(eq(userRewardPoints.userKey, userKey)),
      tgUser?.tgId
        ? db
            .select()
            .from(userBalance)
            .where(and(balanceCondition, eq(userBalance.userKey, tgUser.tgId)))
        : Promise.resolve([]),
      tgUser?.tgId
        ? db.select().from(userRewardPoints).where(eq(userRewardPoints.userKey, tgUser.tgId))
        : Promise.resolve([]),
    ]);

    return {
      emailBalance: emailBalance || [],
      emailPoints: emailPoints || [],
      tgBalance: tgBalance || [],
      tgPoints: tgPoints || [],
    };
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

export async function updateUserClaimedStatus(env: Env, userKey: string, userId: string) {
  const db = createDb(env.DB);

  try {
    console.log('userId = ', userId);
    const tgUserQuery = db
      .select({
        tgId: tgUsers.tgId,
      })
      .from(tgUsers)
      .where(eq(tgUsers.userId, userId));

    const tgUser = (await tgUserQuery)[0];
    console.log('Drizzle query result:', tgUser);

    // 构建查询条件，确保所有参数都有效
    const balanceCondition = and(
      or(eq(userBalance.isCalculate, 0), isNull(userBalance.isCalculate)),
      eq(userBalance.tokenAddress, env.TOKEN_ADDRESS || ''),
    );

    const pointCondition = or(
      eq(userRewardPoints.isCalculate, 0),
      isNull(userRewardPoints.isCalculate),
    );

    // 并行查询所有数据，添加错误处理
    const [emailBalance, emailPoints, tgBalance, tgPoints] = await Promise.all([
      db
        .update(userBalance)
        .set({ isCalculate: 1 })
        .where(and(balanceCondition, eq(userBalance.userKey, userKey)))
        .catch(err => {
          console.error('Email balance query error:', err);
          return [];
        }),
      db
        .update(userRewardPoints)
        .set({ isCalculate: 1 })
        .where(and(pointCondition, eq(userRewardPoints.userKey, userKey))),
      tgUser?.tgId
        ? db
            .update(userBalance)
            .set({ isCalculate: 1 })
            .where(and(balanceCondition, eq(userBalance.userKey, tgUser.tgId)))
        : Promise.resolve([]),
      tgUser?.tgId
        ? db
            .update(userRewardPoints)
            .set({ isCalculate: 1 })
            .where(and(pointCondition, eq(userRewardPoints.userKey, tgUser.tgId)))
        : Promise.resolve([]),
    ]);

    return {
      emailBalance: emailBalance || [],
      emailPoints: emailPoints || [],
      tgBalance: tgBalance || [],
      tgPoints: tgPoints || [],
    };
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

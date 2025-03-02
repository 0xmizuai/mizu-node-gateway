import { eq, and, or, isNull } from 'drizzle-orm';
import { createDb } from './index';
import { tgUsers } from '../schema/tgUser';
import { userBalance } from '../schema/userBalance';
import { userRewardPoints } from '../schema/userPoint';

export async function calculateUserCredits(
  env: Env,
  userKey: string,
  userId: string,
  isNew = false,
) {
  const db = createDb(env.DB);

  // 查询 TG 用户
  const tgUser = await db.query.tgUsers.findFirst({
    where: eq(tgUsers.userId, userId),
    columns: { tgId: true },
  });

  // 构建查询条件
  const balanceCondition = and(
    or(eq(userBalance.isCalculate, 0), isNull(userBalance.isCalculate)),
    eq(userBalance.tokenAddress, env.TOKEN_ADDRESS),
  );

  const pointCondition = or(
    eq(userRewardPoints.isCalculate, 0),
    isNull(userRewardPoints.isCalculate),
  );

  // 并行查询所有数据
  const [emailBalance, emailPoints, tgBalance, tgPoints] = await Promise.all([
    db
      .select()
      .from(userBalance)
      .where(and(balanceCondition, eq(userBalance.userKey, userKey))),
    db
      .select()
      .from(userRewardPoints)
      .where(and(pointCondition, eq(userRewardPoints.userKey, userKey))),
    tgUser?.tgId
      ? db
          .select()
          .from(userBalance)
          .where(and(balanceCondition, eq(userBalance.userKey, tgUser.tgId)))
      : Promise.resolve([]),
    tgUser?.tgId
      ? db
          .select()
          .from(userRewardPoints)
          .where(and(pointCondition, eq(userRewardPoints.userKey, tgUser.tgId)))
      : Promise.resolve([]),
  ]);

  return {
    emailBalance,
    emailPoints,
    tgBalance,
    tgPoints,
    isNew,
  };
}

export async function updateUserClaimedStatus(env: Env, userKey: string, userId: string) {
  const db = createDb(env.DB);

  const tgUser = await db.query.tgUsers.findFirst({
    where: eq(tgUsers.userId, userId),
    columns: { tgId: true },
  });

  // 更新状态
  await Promise.all([
    db
      .update(userBalance)
      .set({ isCalculate: 1 })
      .where(
        and(
          eq(userBalance.userKey, userKey),
          eq(userBalance.tokenAddress, env.TOKEN_ADDRESS),
          or(eq(userBalance.isCalculate, 0), isNull(userBalance.isCalculate)),
        ),
      ),

    db
      .update(userRewardPoints)
      .set({ isCalculate: 1 })
      .where(
        and(
          eq(userRewardPoints.userKey, userKey),
          or(eq(userRewardPoints.isCalculate, 0), isNull(userRewardPoints.isCalculate)),
        ),
      ),

    tgUser?.tgId
      ? db
          .update(userBalance)
          .set({ isCalculate: 1 })
          .where(
            and(
              eq(userBalance.userKey, tgUser.tgId),
              eq(userBalance.tokenAddress, env.TOKEN_ADDRESS),
              or(eq(userBalance.isCalculate, 0), isNull(userBalance.isCalculate)),
            ),
          )
      : Promise.resolve(),

    tgUser?.tgId
      ? db
          .update(userRewardPoints)
          .set({ isCalculate: 1 })
          .where(
            and(
              eq(userRewardPoints.userKey, tgUser.tgId),
              or(eq(userRewardPoints.isCalculate, 0), isNull(userRewardPoints.isCalculate)),
            ),
          )
      : Promise.resolve(),
  ]);

  return true;
}

import { eq, and, or, isNull } from 'drizzle-orm';
import { createDb } from './index';
import { tgUsers } from '../schema/tgUser';

export async function getTgUser(env: Env, userId: string) {
  if (!env?.DB || !userId) {
    console.error('Invalid parameters:', { env: !!env?.DB, userId });
    throw new Error('Missing required parameters');
  }
  try {
    // 测试数据库连接
    console.log('Testing database connection...');
    const testResult = await env.DB.prepare('SELECT 1').first();
    console.log('Database connection test:', testResult);
    const db = createDb(env.DB);
    // 打印查询信息
    console.log('Query params:', {
      userId,
    });
    const tgUserQuery = await db
      .select({
        tgId: tgUsers.tgId,
        userId: tgUsers.userId,
      })
      .from(tgUsers)
      .where(eq(tgUsers.userId, userId));

    console.log('TG user query result:', tgUserQuery);
    const tgUser = tgUserQuery[0];
    console.log('Drizzle query result:', tgUserQuery);
    return tgUser;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

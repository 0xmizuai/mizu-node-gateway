import { Balance, InferenceJobInput, PoolConfig } from '../types';
import { GatewayServiceError, TokenUsage } from '../types';

const DEFAULT_DEPOSIT = 1000000;

export async function recordPendingCost(env: Env, userId: string, cost: number) {
  const stmt = env.DB.prepare('UPDATE users SET pendingCost = pendingCost + ? WHERE id = ?');
  const result = await stmt.bind(cost, userId).run();
  if (!result.success) {
    throw new GatewayServiceError(500, 'Failed to record pending cost');
  }
}

export async function settleJobRewards(
  env: Env,
  jobInput: InferenceJobInput,
  config: PoolConfig,
  usage: TokenUsage,
  worker: string,
) {
  const { prompt_tokens, completion_tokens } = usage;
  const inputCost = prompt_tokens * config.prices.input;
  const outputCost = completion_tokens * config.prices.output;
  const totalCost = inputCost + outputCost;

  const now = Math.floor(Date.now() / 1000);
  const nday = Math.floor(now / 86400);
  const spendingQuery = env.DB.prepare(
    'UPDATE spending SET inputTokens = inputTokens + ?, ' +
      'outputTokens = outputTokens + ?, ' +
      'spending = spending + ?, ' +
      'updatedAt = ? WHERE publisher = ? and pool_id = ?',
  );
  const publisherQuery = env.DB.prepare(
    'UPDATE users SET pendingCost = pendingCost - ?, ' +
      'finalizedCost = finalizedCost + ?, updatedAt = ? WHERE user = ?',
  );
  const poolRewardUpdateQuery = env.DB.prepare(
    'UPDATE earnings SET inputTokens = inputTokens + ?, ' +
      'outputTokens = outputTokens + ?, ' +
      'earnings = earnings + ?, ' +
      'updatedAt = ? WHERE worker = ? and pool_id = ? and nday = ?',
  );
  const poolUpdateQuery = env.DB.prepare(
    'UPDATE pools SET inputTokens = inputTokens + ?, ' +
      'outputTokens = outputTokens + ?, ' +
      'earnings = earnings + ?, ' +
      'updatedAt = ? WHERE id = ?',
  );
  await env.DB.batch([
    spendingQuery.bind(
      prompt_tokens,
      completion_tokens,
      totalCost,
      now,
      jobInput.publisher,
      config.id,
    ),
    publisherQuery.bind(jobInput.estimatedCost, totalCost, now, jobInput.publisher),
    poolRewardUpdateQuery.bind(
      prompt_tokens,
      completion_tokens,
      totalCost,
      now,
      worker,
      config.id,
      nday,
    ),
    poolUpdateQuery.bind(prompt_tokens, completion_tokens, totalCost, now, config.id),
  ]);
}

export async function settlePoolRewards(env: Env, pool: PoolConfig) {
  const now = Math.floor(Date.now() / 1000);
  const nday = Math.floor(now / 86400) - 1;
  if (nday <= pool.lastSettledDay) {
    throw new GatewayServiceError(400, 'already settled');
  }

  const rewards = await env.DB.prepare(
    'SELECT worker, SUM(earnings) as earnings FROM earnings ' +
      'WHERE pool_id = ? and nday <= ? and settled = 0 ' +
      'GROUP BY worker',
  )
    .bind(pool.id, nday)
    .all();
  if (!rewards.success) {
    throw new GatewayServiceError(500, 'Failed to get rewards to settle');
  }
  if (rewards.results.length === 0) {
    throw new GatewayServiceError(404, 'No rewards to settle');
  }

  const ratio = pool.feeRatio / 100;

  // update the worker earnings
  const updateWorkerStmts = rewards.results.map(reward =>
    env.DB.prepare('UPDATE users SET earnings = earnings + ?, updatedAt = ? WHERE id = ?').bind(
      Math.floor((reward.earnings as number) * (1 - ratio)),
      now,
      reward.worker as string,
    ),
  );

  // update the pool owner earnings
  const totalEarnings = rewards.results.reduce((acc, curr) => acc + (curr.earnings as number), 0);
  const updatePoolOwnerStmt = env.DB.prepare(
    'UPDATE users SET earnings = earnings + ?, updatedAt = ? WHERE id = ?',
  ).bind(Math.floor(totalEarnings * ratio), now, pool.owner);

  // update the pool earnings and lastSettledDay
  const updatePoolStmt = env.DB.prepare(
    'UPDATE pools SET settledEarnings = settledEarnings + ?, lastSettledDay = ? WHERE id = ?',
  ).bind(totalEarnings, nday, pool.id);

  // update all the records to be settled
  const updatePoolStatusStmt = env.DB.prepare(
    'UPDATE earnings SET settled = 1, updatedAt = ? WHERE pool_id = ? AND nday <= ?',
  ).bind(now, pool.id, nday);

  await env.DB.batch([
    ...updateWorkerStmts,
    updatePoolOwnerStmt,
    updatePoolStmt,
    updatePoolStatusStmt,
  ]);
}

export async function deposit(env: Env, user: string, amount: number): Promise<Balance> {
  // Insert user if not exists with 0 credit
  const insertStmt = env.DB.prepare('INSERT OR IGNORE INTO users (id, deposit) VALUES (?, 0)');
  // Update credit
  const updateStmt = env.DB.prepare('UPDATE users SET deposit = deposit + ? WHERE id = ?');
  await env.DB.batch([insertStmt.bind(user), updateStmt.bind(amount, user)]);
  return await getBalance(env, user);
}

export async function getBalance(env: Env, user: string): Promise<Balance> {
  const selectStmt = env.DB.prepare(
    'SELECT deposit, earnings, lockedSpending, spending FROM users WHERE id = ?',
  );
  const result: Record<string, number> | null = await selectStmt.bind(user).first();
  if (!result) {
    throw new GatewayServiceError(404, 'User not found after deposit');
  }
  const balance = result.deposit + result.earnings - result.pendingCost - result.finalizedCost;
  return {
    balance,
    deposit: result.deposit,
    earnings: result.earnings,
    lockedSpending: result.lockedSpending,
    spending: result.spending,
  };
}

export async function initUser(env: Env, user: string) {
  const exists = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(user).first();
  if (exists) {
    throw new GatewayServiceError(400, 'User already exists');
  }

  const insertStmt = env.DB.prepare('INSERT OR IGNORE INTO users (id, deposit) VALUES (?, ?)').bind(
    user,
    DEFAULT_DEPOSIT,
  );
  const result = await insertStmt.run();
  if (!result.success) {
    throw new GatewayServiceError(500, 'Failed to insert user');
  }
}

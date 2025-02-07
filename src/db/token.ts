import { Balance, InferenceJobInput, PoolConfig } from '../types';
import { GatewayServiceError, TokenUsage } from '../types';

export async function recordPendingCost(env: Env, userId: string, cost: number) {
  const stmt = env.DB.prepare('UPDATE users SET pendingCost = pendingCost + ? WHERE id = ?');
  const result = await stmt.bind(cost, userId).run();
  if (!result.success) {
    throw new GatewayServiceError(500, 'Failed to record pending cost');
  }
}

export async function settleTokenUsage(
  env: Env,
  jobInput: InferenceJobInput,
  config: PoolConfig,
  usage: TokenUsage,
) {
  const { prompt_tokens, completion_tokens } = usage;
  const inputCost = prompt_tokens * config.prices.input;
  const outputCost = completion_tokens * config.prices.output;
  const totalCost = inputCost + outputCost;

  const publisherQuery = env.DB.prepare(
    'UPDATE users SET pendingCost = pendingCost - ?, ' +
      'finalizedCost = finalizedCost + ?, updatedAt = ? WHERE user = ?',
  );
  const poolOwnerQuery = env.DB.prepare(
    'INSERT INTO users (id, earnings, updatedAt) ' +
      'VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET ' +
      'earnings = earnings + ?, updatedAt = ?',
  );
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    publisherQuery.bind(jobInput.estimatedCost, totalCost, now, jobInput.publisher),
    poolOwnerQuery.bind(config.owner, config.id, totalCost, now, totalCost, now),
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
    'SELECT deposit, earnings, pendingCost, finalizedCost FROM users WHERE id = ?',
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
    pendingCost: result.pendingCost,
    finalizedCost: result.finalizedCost,
  };
}

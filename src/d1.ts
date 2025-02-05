import {
  Balance,
  InferenceJobInput,
  PoolConfig,
  PoolConfigInput,
} from "./types";
import { GatewayServiceError, TokenUsage } from "./types";

export async function getPools(env: Env): Promise<PoolConfig[]> {
  const stmt = env.DB.prepare("SELECT * FROM pools");
  const result = await stmt.all();
  return result.results.map((row) => ({
    id: Number(row.id),
    name: row.name as string,
    model: row.model as string,
    owner: row.owner as string,
    prices: row.prices as { input: number; output: number },
    contextLength: Number(row.context_length),
    status: Number(row.status),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
}

export async function getPool(env: Env, id: number): Promise<PoolConfig> {
  const stmt = env.DB.prepare("SELECT * FROM pools WHERE id = ?");
  const result = await stmt.bind(id).first();
  if (result === null) {
    throw new GatewayServiceError(404, "Pool not found");
  }
  return {
    id: Number(result.id),
    name: result.name as string,
    model: result.model as string,
    owner: result.owner as string,
    prices: result.prices as { input: number; output: number },
    contextLength: Number(result.context_length),
    status: Number(result.status),
    createdAt: Number(result.created_at),
    updatedAt: Number(result.updated_at),
  } as PoolConfig;
}

export async function settleTokenUsage(
  env: Env,
  jobInput: InferenceJobInput,
  config: PoolConfig,
  usage: TokenUsage
) {
  const { prompt_tokens, completion_tokens } = usage;
  const inputCost = prompt_tokens * config.prices.input;
  const outputCost = completion_tokens * config.prices.output;
  const totalCost = inputCost + outputCost;

  const publisherQuery = env.DB.prepare(
    "UPDATE user SET pendingCost = pendingCost - ?, " +
      "finalizedCost = finalizedCost + ?, updatedAt = ? WHERE user = ?"
  );
  const poolOwnerQuery = env.DB.prepare(
    "INSERT INTO user (user, earnings, updatedAt) " +
      "VALUES (?, ?, ?) ON CONFLICT(user, gateway) DO UPDATE SET " +
      "earnings = earnings + ?, updatedAt = ?"
  );
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    publisherQuery.bind(
      jobInput.estimatedCost,
      totalCost,
      now,
      jobInput.publisher
    ),
    poolOwnerQuery.bind(
      config.owner,
      config.id,
      totalCost,
      now,
      totalCost,
      now
    ),
  ]);
}

export async function poolNameExists(env: Env, name: string): Promise<boolean> {
  const stmt = env.DB.prepare("SELECT id FROM pools WHERE name = ?");
  const result = await stmt.bind(name).first();
  return result !== null;
}

export async function createPool(
  env: Env,
  user: string,
  pool: PoolConfigInput
): Promise<number> {
  if (await poolNameExists(env, pool.name)) {
    throw new GatewayServiceError(409, "Pool name already exists");
  }

  const stmt = env.DB.prepare(
    "INSERT INTO pools (name, model, owner, prices, " +
      "contextLength, createdAt, updatedAt) VALUES " +
      "(?, ?, ?, ?, ?, ?, ?) RETURNING id"
  );
  const now = Math.floor(Date.now() / 1000);
  const result = await stmt
    .bind(
      pool.name,
      pool.model,
      user,
      JSON.stringify(pool.prices),
      pool.contextLength,
      now,
      now
    )
    .run()
    .catch((err: any) => {
      if (err.code === 2067) {
        // SQLITE_CONSTRAINT_UNIQUE
        throw new GatewayServiceError(409, "Pool name already exists");
      }
      throw new GatewayServiceError(500, `Database error: ${err.message}`);
    });
  if (!result.success || result.results.length === 0) {
    throw new GatewayServiceError(500, "Failed to create pool");
  }
  return Number(result.results[0].id);
}

export async function deposit(
  env: Env,
  user: string,
  amount: number
): Promise<Balance> {
  // Insert user if not exists with 0 credit
  const insertStmt = env.DB.prepare(
    "INSERT OR IGNORE INTO user (user, deposit) VALUES (?, 0)"
  );
  // Update credit
  const updateStmt = env.DB.prepare(
    "UPDATE user SET deposit = deposit + ? WHERE user = ?"
  );
  await env.DB.batch([insertStmt.bind(user), updateStmt.bind(amount, user)]);
  return await getBalance(env, user);
}

export async function getBalance(env: Env, user: string): Promise<Balance> {
  const selectStmt = env.DB.prepare(
    "SELECT deposit, earnings, pendingCost, finalizedCost FROM user WHERE user = ?"
  );
  const result: Record<string, number> | null = await selectStmt
    .bind(user)
    .first();
  if (!result) {
    throw new GatewayServiceError(404, "User not found after deposit");
  }
  const balance =
    result.deposit +
    result.earnings -
    result.pendingCost -
    result.finalizedCost;
  return {
    balance,
    deposit: result.deposit,
    earnings: result.earnings,
    pendingCost: result.pendingCost,
    finalizedCost: result.finalizedCost,
  };
}

export async function updatePool(
  env: Env,
  existingPool: PoolConfig,
  pool: Partial<PoolConfig>
): Promise<PoolConfig> {
  if (pool.prices === undefined && pool.status === undefined) {
    throw new GatewayServiceError(400, "Prices or status are required");
  }

  const stmt = env.DB.prepare(
    "UPDATE pools SET prices = ?, status = ?, updatedAt = ? WHERE id = ?"
  );
  const now = Math.floor(Date.now() / 1000);
  const result = await stmt
    .bind(
      JSON.stringify(pool.prices ?? existingPool.prices),
      pool.status ?? existingPool.status,
      now,
      existingPool.id
    )
    .run();
  if (!result.success) {
    throw new GatewayServiceError(500, "Failed to update pool");
  }
  return {
    id: existingPool.id,
    name: existingPool.name,
    model: existingPool.model,
    owner: existingPool.owner,
    prices: pool.prices ?? existingPool.prices,
    contextLength: existingPool.contextLength,
    status: pool.status ?? existingPool.status,
    createdAt: existingPool.createdAt,
    updatedAt: now,
  };
}

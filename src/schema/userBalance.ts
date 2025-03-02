import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const userBalance = sqliteTable(
  'user_balance',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userKey: text('user_key').notNull(),
    tokenAddress: text('token_address').notNull(),
    tokenBalance: integer('token_balance').default(0),
    isCalculate: integer('is_calculate').default(0),
    createdAt: integer('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  table => ({
    unq: unique().on(table.userKey, table.tokenAddress),
  }),
);

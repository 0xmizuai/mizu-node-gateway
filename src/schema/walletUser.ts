import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const walletUsers = sqliteTable('wallet_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  address: text('address').notNull().unique(),
  userId: text('user_id').notNull().unique(),
  chain: text('chain'),
  nonce: text('nonce'),
  nonceExpiredAt: integer('nonce_expired_at'),
  createdAt: integer('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

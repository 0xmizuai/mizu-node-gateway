import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tgUsers = sqliteTable('tg_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tgId: text('tg_id').notNull().unique(),
  userId: text('user_id').notNull().unique(),
  username: text('username'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  photoUrl: text('photo_url'),
  authDate: integer('auth_date'),
  createdAt: integer('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

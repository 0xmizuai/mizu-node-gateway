import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tgUsers = sqliteTable('tg_users', {
  id: integer('id').primaryKey(),
  tgId: text('tg_id').notNull(),
  userId: text('user_id').notNull(),
  username: text('username'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  photoUrl: text('photo_url'),
  authDate: integer('auth_date'),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
});

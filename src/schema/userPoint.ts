import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const userRewardPoints = sqliteTable(
  'user_reward_points',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userKey: text('user_key').notNull(),
    userKeyType: text('user_key_type').default(''),
    claimedPoint: integer('claimed_point'),
    latestClaimTimestamp: integer('latest_claim_timestamp'),
    referralRewardPoint: integer('referral_reward_point'),
    jobRewardCount: integer('job_reward_count').default(0),
    continousCheckInDays: integer('continous_check_in_days').default(0),
    latestCheckInTimestamp: integer('latest_check_in_timestamp').default(0),
    userPhotoUrl: text('user_photo_url').default(''),
    username: text('username').default(''),
    tgHandleUsername: text('tg_handle_username').default(''),
    lastestActivityTimestamp: integer('lastest_activity_timestamp'),
    rejectAirdrop: integer('reject_airdrop').default(0),
    minAirdropValue: integer('min_airdrop_value').default(0),
    channelUserStatus: integer('channel_user_status').default(0),
    channelUpdateTimestamp: integer('channel_update_timestamp').default(0),
    firstTop100: integer('first_top_100').default(0),
    isCalculate: integer('is_calculate').default(0),
    createdAt: integer('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  table => ({
    unq: unique().on(table.userKey, table.userKeyType),
  }),
);

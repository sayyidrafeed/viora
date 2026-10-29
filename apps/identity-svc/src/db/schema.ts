import { sql } from 'drizzle-orm'
import { boolean, check, integer, pgSchema, text, timestamp } from 'drizzle-orm/pg-core'

export const identity = pgSchema('identity')

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

// Tabel standar Better Auth + kolom plugin admin. state_version dinaikkan trigger, bukan oleh aplikasi.
export const user = identity.table('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires', { withTimezone: true }),
  stateVersion: integer('state_version').notNull().default(1),
  ...timestamps,
})

export const session = identity.table('session', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  impersonatedBy: text('impersonated_by'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  ...timestamps,
})

export const account = identity.table('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  ...timestamps,
})

export const verification = identity.table('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps,
})

// Hanya ada supaya validasi schema Better Auth lolos. Kunci JWT datang dari keyring SOPS (§6), jadi tabel ini menolak semua baris.
export const jwks = identity.table(
  'jwks',
  {
    id: text('id').primaryKey(),
    publicKey: text('public_key').notNull(),
    privateKey: text('private_key').notNull(),
    alg: text('alg'),
    crv: text('crv'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  () => [check('jwks_from_keyring_only', sql`false`)],
)

export const channel = identity.table('channel', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  handle: text('handle').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  avatarKey: text('avatar_key'),
  bannerKey: text('banner_key'),
  stateVersion: integer('state_version').notNull().default(1),
  ...timestamps,
})

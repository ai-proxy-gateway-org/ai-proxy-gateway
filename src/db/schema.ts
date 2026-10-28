// src/db/schema.ts
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  integer,
  jsonb,
  doublePrecision,
  unique,
} from 'drizzle-orm/pg-core';

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  client_type: varchar('client_type', { length: 50 }).default('server-based'),
  allowed_domains: jsonb('allowed_domains').default([]),
  allowed_models: jsonb('allowed_models').default([]),
  is_active: boolean('is_active').default(true),
  summary_enabled: boolean('summary_enabled').default(false),
  rate_limit: integer('rate_limit').default(60),
  max_output_price: doublePrecision('max_output_price'),
  monthly_budget: doublePrecision('monthly_budget'),
  daily_budget: doublePrecision('daily_budget'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  client_id: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password_hash: text('password_hash'),
  role: varchar('role', { length: 50 }).default('member'),
  allowed_models: jsonb('allowed_models').default([]),
  max_output_price: doublePrecision('max_output_price'),
  budget_limit: doublePrecision('budget_limit'),
  monthly_budget: doublePrecision('monthly_budget'),
  daily_budget: doublePrecision('daily_budget'),
  rate_limit: integer('rate_limit'),
  last_login_at: timestamp('last_login_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const admin_users = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password_hash: text('password_hash').notNull(),
  last_login_at: timestamp('last_login_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const client_keys = pgTable('client_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  client_id: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  key_hash: varchar('key_hash', { length: 255 }).notNull().unique(),
  key_prefix: varchar('key_prefix', { length: 32 }),
  label: varchar('label', { length: 255 }),
  environment: varchar('environment', { length: 50 }).default('production'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const key_deliveries = pgTable('key_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  key_id: uuid('key_id').references(() => client_keys.id, { onDelete: 'cascade' }),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  token_hash: varchar('token_hash', { length: 255 }).notNull().unique(),
  payload: text('payload').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  opened_at: timestamp('opened_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const logs = pgTable('logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  client_id: uuid('client_id'),
  key_id: uuid('key_id'),
  provider: varchar('provider', { length: 50 }),
  model: varchar('model', { length: 100 }),
  status: varchar('status', { length: 50 }).default('pending'),
  error_message: text('error_message'),
  prompt: text('prompt'),
  response: text('response'),
  input_tokens: integer('input_tokens'),
  output_tokens: integer('output_tokens'),
  input_price_used: doublePrecision('input_price_used'),
  output_price_used: doublePrecision('output_price_used'),
  cost: doublePrecision('cost'),
  latency_ms: integer('latency_ms'),
  session_id: uuid('session_id'),
  is_flagged: boolean('is_flagged').default(false),
  flagged_reason: text('flagged_reason'),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  client_id: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  started_at: timestamp('started_at', { withTimezone: true }).defaultNow(),
  ended_at: timestamp('ended_at', { withTimezone: true }),
  message_count: integer('message_count').default(0),
  summary: text('summary'),
  summary_tokens: integer('summary_tokens'),
  summary_cost: doublePrecision('summary_cost'),
});

export const model_catalog = pgTable(
  'model_catalog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 50 }).notNull(),
    model: varchar('model', { length: 255 }).notNull(),
    input_price: doublePrecision('input_price'),
    output_price: doublePrecision('output_price'),
    is_active: boolean('is_active').default(true),
    price_checked_at: timestamp('price_checked_at', { withTimezone: true }),
    price_source: varchar('price_source', { length: 50 }),
    source_ids: jsonb('source_ids').default([]),
    litellm_ids: jsonb('litellm_ids').default([]),
    son_fiyat_notu: text('son_fiyat_notu'),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [unique('model_catalog_provider_model_unique').on(t.provider, t.model)]
);

export const price_events = pgTable('price_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tur: varchar('tur', { length: 50 }),
  tetikleyen: varchar('tetikleyen', { length: 50 }),
  model: varchar('model', { length: 255 }),
  kaynak: varchar('kaynak', { length: 100 }),
  eski_girdi: doublePrecision('eski_girdi'),
  eski_cikti: doublePrecision('eski_cikti'),
  yeni_girdi: doublePrecision('yeni_girdi'),
  yeni_cikti: doublePrecision('yeni_cikti'),
  aciklama: text('aciklama'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

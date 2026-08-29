// src/db/schema.ts
import { pgTable, uuid, varchar, boolean, timestamp, text, integer, jsonb, doublePrecision } from 'drizzle-orm/pg-core';

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
 
  client_type: varchar('client_type', { length: 50 }),
  allowed_domains: jsonb('allowed_domains'), 
  allowed_models: jsonb('allowed_models'),
  is_active: boolean('is_active').default(true)
});

export const client_keys = pgTable('client_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  client_id: uuid('client_id').references(() => clients.id),
  key_hash: varchar('key_hash', { length: 255 }).notNull().unique(),
  environment: varchar('environment', { length: 50 }),
  is_active: boolean('is_active').default(true)
});

export const logs = pgTable('logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  client_id: uuid('client_id'),
  provider: varchar('provider', { length: 50 }),
  model: varchar('model', { length: 100 }),
  status: varchar('status', { length: 50 }),
  error_message: text('error_message'),
  input_tokens: integer('input_tokens'),
  output_tokens: integer('output_tokens'),
  cost: doublePrecision('cost'),
  latency_ms: integer('latency_ms'),
  completed_at: timestamp('completed_at'),
  created_at: timestamp('created_at').defaultNow()
});
// src/db/schema.ts
import { pgTable, uuid, varchar, boolean, timestamp, text, integer, jsonb, doublePrecision } from 'drizzle-orm/pg-core';

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
 
  client_type: varchar('client_type', { length: 50 }),
  allowed_domains: jsonb('allowed_domains'), 
  allowed_models: jsonb('allowed_models'),
  is_active: boolean('is_active').default(true),
  // Oturum özetleme özelliği: Admin panelinden müşteri bazlı açılıp kapatılır.
  // Müşteri isterse X-Summarize header'ı ile de geçersiz kılabilir (override).
  summary_enabled: boolean('summary_enabled').default(false),
  rate_limit: integer('rate_limit').default(60)
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
  // İsteğin ve cevabın tam metni. Denetim amaçlı: şüpheli/tehlikeli bir
  // request olduğunda tam olarak ne sorulup ne cevap verildiğini görebilmek
  // için — mission brief'te "Prompt" loglanması zaten isteniyordu.
  prompt: text('prompt'),
  response: text('response'),
  input_tokens: integer('input_tokens'),
  output_tokens: integer('output_tokens'),
  cost: doublePrecision('cost'),
  latency_ms: integer('latency_ms'),
  // Hangi oturuma ait olduğu (opsiyonel ilişkilendirme)
  session_id: uuid('session_id'),
  // Tehlikeli içerik tespiti (OpenAI Moderation)
  is_flagged: boolean('is_flagged').default(false),
  flagged_reason: text('flagged_reason'),
  completed_at: timestamp('completed_at'),
  created_at: timestamp('created_at').defaultNow()
});

// Oturum tablosu: 15 dakika sessizlik sonrası kapanan oturumların kalıcı kaydı.
// Redis'teki geçici oturum verisi TTL dolunca silinir, bu tablo ise kalıcıdır.
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  client_id: uuid('client_id').references(() => clients.id),
  started_at: timestamp('started_at').defaultNow(),
  ended_at: timestamp('ended_at'),
  message_count: integer('message_count').default(0),
  summary: text('summary'),
  summary_tokens: integer('summary_tokens'),
  summary_cost: doublePrecision('summary_cost'),
});
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  client_id: uuid('client_id').references(() => clients.id),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password_hash: text('password_hash'),
  role: varchar('role', { length: 50 }).default('user'),
  allowed_models: jsonb('allowed_models'),
  budget_limit: doublePrecision('budget_limit'),
  created_at: timestamp('created_at').defaultNow()
});

export const model_catalog = pgTable('model_catalog', {
  id: varchar('id', { length: 255 }).primaryKey(),
  provider: varchar('provider', { length: 50 }),
  input_price: doublePrecision('input_price'),
  output_price: doublePrecision('output_price'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at').defaultNow()
});

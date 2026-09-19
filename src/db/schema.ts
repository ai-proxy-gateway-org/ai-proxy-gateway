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
  summary_enabled: boolean('summary_enabled').default(false)
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
  // istek olduğunda tam olarak ne sorulup ne cevap verildiğini görebilmek
  // için — mission brief'te "Prompt" loglanması zaten isteniyordu.
  prompt: text('prompt'),
  response: text('response'),
  input_tokens: integer('input_tokens'),
  output_tokens: integer('output_tokens'),
  cost: doublePrecision('cost'),
  latency_ms: integer('latency_ms'),
  // Hangi oturuma ait olduğu (opsiyonel ilişkilendirme)
  session_id: uuid('session_id'),
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
-- =============================================================================
-- AI Proxy Gateway — Initial PostgreSQL Schema Migration
-- Compatible with standard PostgreSQL 14+, Supabase, Neon, AWS RDS, and Docker.
-- Safe to run multiple times (idempotent via IF NOT EXISTS).
-- =============================================================================

-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Clients (Organizations / Teams)
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  client_type varchar(50) DEFAULT 'server-based',
  allowed_domains jsonb DEFAULT '[]'::jsonb,
  allowed_models jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  summary_enabled boolean DEFAULT false,
  rate_limit integer DEFAULT 60,
  max_output_price double precision,
  monthly_budget double precision,
  daily_budget double precision,
  created_at timestamptz DEFAULT now()
);

-- 2. Customer Portal Users
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  email varchar(255) NOT NULL UNIQUE,
  password_hash text,
  role varchar(50) DEFAULT 'member',
  allowed_models jsonb DEFAULT '[]'::jsonb,
  max_output_price double precision,
  budget_limit double precision,
  monthly_budget double precision,
  daily_budget double precision,
  rate_limit integer,
  last_login_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 3. Administrator Accounts (/admin)
CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  last_login_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 4. Client API Keys (SHA-256 hashed sk-proxy-* tokens)
CREATE TABLE IF NOT EXISTS client_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  key_hash varchar(255) NOT NULL UNIQUE,
  key_prefix varchar(32),
  label varchar(255),
  environment varchar(50) DEFAULT 'production',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 5. One-Time Encrypted Key Deliveries (AES-256-GCM handover links)
CREATE TABLE IF NOT EXISTS key_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid REFERENCES client_keys(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(255) NOT NULL UNIQUE,
  payload text NOT NULL,
  expires_at timestamptz NOT NULL,
  opened_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 6. Request Audit & Cost Logs
CREATE TABLE IF NOT EXISTS logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid,
  key_id uuid,
  provider varchar(50),
  model varchar(100),
  status varchar(50) DEFAULT 'pending',
  error_message text,
  prompt text,
  response text,
  input_tokens integer,
  output_tokens integer,
  input_price_used double precision,
  output_price_used double precision,
  cost double precision,
  latency_ms integer,
  session_id uuid,
  is_flagged boolean DEFAULT false,
  flagged_reason text,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 7. Conversation Sessions (15-min sliding window AI summaries)
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  message_count integer DEFAULT 0,
  summary text,
  summary_tokens integer,
  summary_cost double precision
);

-- 8. Dynamic Model Catalog & Pricing (prices stored per 1K tokens in USD)
CREATE TABLE IF NOT EXISTS model_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(50) NOT NULL,
  model varchar(255) NOT NULL,
  input_price double precision,
  output_price double precision,
  is_active boolean DEFAULT true,
  price_checked_at timestamptz,
  price_source varchar(50),
  source_ids jsonb DEFAULT '[]'::jsonb,
  litellm_ids jsonb DEFAULT '[]'::jsonb,
  son_fiyat_notu text,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT model_catalog_provider_model_unique UNIQUE (provider, model)
);

-- 9. Price Sync Audit Events
CREATE TABLE IF NOT EXISTS price_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tur varchar(50),
  tetikleyen varchar(50),
  model varchar(255),
  kaynak varchar(100),
  eski_girdi double precision,
  eski_cikti double precision,
  yeni_girdi double precision,
  yeni_cikti double precision,
  aciklama text,
  created_at timestamptz DEFAULT now()
);

-- Indexes for high-throughput lookups & dashboard queries
CREATE INDEX IF NOT EXISTS idx_client_keys_client_id ON client_keys(client_id);
CREATE INDEX IF NOT EXISTS idx_client_keys_user_id ON client_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_users_client_id ON users(client_id);
CREATE INDEX IF NOT EXISTS idx_logs_client_id_created_at ON logs(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_key_id_created_at ON logs(key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_client_id_started_at ON sessions(client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_events_created_at ON price_events(created_at DESC);

-- Seed baseline models (safe no-op if already populated)
INSERT INTO model_catalog (provider, model, input_price, output_price, is_active, price_source)
VALUES
  ('openai', 'gpt-4o', 0.0025, 0.01, true, 'seed'),
  ('openai', 'gpt-4o-mini', 0.00015, 0.0006, true, 'seed'),
  ('anthropic', 'claude-3-5-sonnet-latest', 0.003, 0.015, true, 'seed'),
  ('gemini', 'gemini-2.5-flash', 0.00015, 0.0006, true, 'seed')
ON CONFLICT (provider, model) DO NOTHING;

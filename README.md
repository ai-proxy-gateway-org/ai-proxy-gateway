<p align="center">
  <img src="https://img.shields.io/badge/runtime-Hono%20Edge-E36002?style=for-the-badge&logo=hono&logoColor=white" alt="Hono" />
  <img src="https://img.shields.io/badge/deploy-Vercel%20Edge-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" />
  <img src="https://img.shields.io/badge/cache-Upstash%20Redis-00E9A3?style=for-the-badge&logo=upstash&logoColor=white" alt="Upstash" />
  <img src="https://img.shields.io/badge/database-Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/orm-Drizzle-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black" alt="Drizzle" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

# 🚀 AI Proxy Gateway

**A blazing-fast, production-ready AI API Gateway built on edge infrastructure.**

Route requests across OpenAI, Anthropic, and Google Gemini through a single, unified endpoint — with built-in authentication, rate limiting, cost tracking, session summarization, and a full admin console. Designed to run on **Vercel Edge Functions** with zero cold-start overhead.

---

## ✨ Features

| Category | Feature | Description |
|----------|---------|-------------|
| 🔀 **Routing** | Unified Endpoint | Single `POST /v1/chat/completions` routes to OpenAI, Anthropic, or Gemini based on model name |
| 🔐 **Security** | API Key Management | Issue `sk-proxy-*` keys per client. Keys are SHA-256 hashed — never stored in plaintext |
| 🔐 **Security** | Vault Integration | Provider secrets stored in a centralized Vault server, never exposed to edge functions |
| 🔐 **Security** | One-Time Key Delivery | Generated keys are delivered via AES-256-GCM encrypted single-use links |
| ⚡ **Performance** | SWR Caching | Stale-While-Revalidate pattern for Vault keys — 0 ms latency overhead on cache hits |
| ⚡ **Performance** | Edge-Native | Runs on Vercel Edge worldwide. 17,750+ req/sec throughput benchmarked |
| 🛡️ **Protection** | Rate Limiting | Redis-based fixed-window rate limiter with fail-open fault tolerance |
| 💰 **Cost Control** | Token & Cost Tracking | Every request logged with input/output tokens, latency, and calculated USD cost |
| 💰 **Cost Control** | Budget Limits | Set daily and monthly spending caps per client |
| 💰 **Cost Control** | Dynamic Pricing | Auto-syncs model prices from OpenRouter. Price drops adopted automatically |
| 📊 **Analytics** | Admin Console | Full-featured web dashboard — clients, requests, models, pricing, budgets |
| 📊 **Analytics** | Customer Portal | Self-service portal where clients view their own usage, costs, and API keys |
| 🧠 **AI Insights** | Session Summarization | Groups conversations into 15-min sessions and generates AI summaries via `gpt-4o-mini` |
| 🌍 **Flexibility** | Multi-Provider | OpenAI, Anthropic, and Google Gemini supported out of the box |
| 🌍 **Flexibility** | Vault Fallback | No Vault server? Falls back to `.env` provider keys for easy local development |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Application                       │
│                   (sends sk-proxy-* API key)                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │  POST /v1/chat/completions
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AI Proxy Gateway (Hono)                      │
│  ┌──────────┐  ┌───────────────┐  ┌──────────────────────────┐  │
│  │   Auth   │→ │  Rate Limit   │→ │   Provider Router        │  │
│  │Middleware │  │  (Redis)      │  │  claude* → Anthropic     │  │
│  │(Supabase)│  │  60 req/min   │  │  gemini* → Google        │  │
│  └──────────┘  └───────────────┘  │  default → OpenAI        │  │
│                                    └────────────┬─────────────┘  │
│  ┌──────────────────┐  ┌────────────────────┐   │               │
│  │  Session Tracker  │  │   Cost Calculator  │   │               │
│  │  (Redis, 15-min)  │  │  (model_catalog)   │   │               │
│  └──────────────────┘  └────────────────────┘   │               │
└─────────────────────────────────────────────────┼───────────────┘
                           │                      │
              ┌────────────┘                      │
              ▼                                   ▼
┌──────────────────────┐          ┌──────────────────────────────┐
│   Vault Server       │          │   AI Provider APIs           │
│   (Secret Storage)   │          │   • api.openai.com           │
│   SWR-cached in      │          │   • api.anthropic.com        │
│   Redis (5 min)      │          │   • generativelanguage.      │
└──────────────────────┘          │     googleapis.com           │
                                  └──────────────────────────────┘
```

---

## 📦 Supported Models

### OpenAI
`gpt-4o` · `gpt-4o-mini` · `o1-preview` · `o1-mini` · `o3-mini`

### Anthropic
`claude-sonnet-5` · `claude-opus-5` · `claude-haiku-4-5-20251001` · `claude-sonnet-4-20250514` · `claude-3-5-sonnet-latest` · `claude-3-opus-20240229`

### Google Gemini
`gemini-3.6-flash` · `gemini-2.5-flash` · `gemini-2.0-flash` · `gemini-1.5-pro` · `gemini-1.5-flash`

> **Note:** Model pricing is dynamically fetched from a database catalog. The static `model_pricing.json` serves as an automatic fallback. New models can be added from the Admin Console without code changes.

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- A [Supabase](https://supabase.com/) project (free tier works)
- An [Upstash Redis](https://upstash.com/) database (free tier works)
- At least one AI provider API key (OpenAI, Anthropic, or Gemini)

### 1. Clone & Install

```bash
git clone https://github.com/ai-proxy-gateway-org/ai-proxy-gateway.git
cd ai-proxy-gateway
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

```env
# --- Database ---
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOi...
DATABASE_URL=postgresql://postgres.xxx:password@aws-1-eu-west-1.pooler.supabase.com:6543/postgres

# --- Cache & Rate Limiting ---
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=AQ...

# --- Admin Panel ---
ADMIN_TOKEN=your-long-random-secret-token
SESSION_SECRET=another-random-secret

# --- AI Provider Keys (for Vault-less local development) ---
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AI...

# --- Optional ---
ENABLE_PORTAL=true
```

### 3. Set Up Database

Run the following SQL in your Supabase SQL Editor to create the required tables:

```sql
-- Clients
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  client_type varchar(50) DEFAULT 'server-based',
  allowed_domains jsonb DEFAULT '[]',
  allowed_models jsonb DEFAULT '[]',
  is_active boolean DEFAULT true,
  summary_enabled boolean DEFAULT false
);

-- API Keys
CREATE TABLE IF NOT EXISTS client_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id),
  key_hash varchar(255) UNIQUE NOT NULL,
  key_prefix varchar(20),
  label varchar(255),
  environment varchar(50) DEFAULT 'production',
  is_active boolean DEFAULT true,
  created_at timestamp DEFAULT now()
);

-- Request Logs
CREATE TABLE IF NOT EXISTS logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid,
  provider varchar(50),
  model varchar(100),
  status varchar(50) DEFAULT 'pending',
  error_message text,
  prompt text,
  response text,
  input_tokens integer,
  output_tokens integer,
  cost double precision,
  latency_ms integer,
  session_id uuid,
  completed_at timestamp,
  created_at timestamp DEFAULT now()
);

-- Sessions (for AI summarization)
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  client_id uuid REFERENCES clients(id),
  started_at timestamp DEFAULT now(),
  ended_at timestamp,
  message_count integer DEFAULT 0,
  summary text,
  summary_tokens integer,
  summary_cost double precision
);
```

### 4. Start Development Server

```bash
npm run dev
```

The gateway will be available at `http://127.0.0.1:3000`.

### 5. Create Your First API Key

```bash
# Open the Admin Console in your browser
open http://127.0.0.1:3000/admin

# Or use the test script
npx tsx --env-file=.env src/test.ts
```

### 6. Send Your First Request

```bash
curl -X POST http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-proxy-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

**Switch providers instantly** — just change the model name:

```bash
# Anthropic
-d '{"model": "claude-sonnet-5", "messages": [...]}'

# Google Gemini
-d '{"model": "gemini-3.6-flash", "messages": [...]}'
```

---

## 🔒 Vault Server (Recommended for Production)

For production deployments, provider API keys should be stored in a dedicated Vault server rather than environment variables. The gateway connects to the Vault over HTTPS and caches keys in Redis using a **Stale-While-Revalidate (SWR)** strategy:

- **Fresh window:** 5 minutes — keys served instantly from Redis
- **Hard expiry:** 2 hours — Redis evicts the key entirely
- **Background refresh:** When a cached key becomes stale, the gateway serves it immediately while refreshing from the Vault asynchronously (zero latency penalty)

```env
VAULT_API_URL=https://your-vault-server.example.com
VAULT_ACCESS_TOKEN=vault-secret-token
```

> **No Vault? No problem.** If `VAULT_API_URL` is not set, the gateway falls back to reading `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY` directly from environment variables.

---

## 🧠 Session Summarization

The gateway can automatically group API interactions into sessions and generate AI-powered summaries.

### How It Works

1. **Session creation:** When a client sends a request with `X-Summarize: true` header (or has `summary_enabled` set in the database), a Redis session is created with a 15-minute sliding TTL.
2. **Message accumulation:** Each request/response pair is buffered in Redis as the session progresses.
3. **Summary generation:** When triggered (manually or on session expiry), all messages are summarized by `gpt-4o-mini` and permanently saved to PostgreSQL.

### Session API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/sessions/current` | Get the active session for the authenticated client |
| `GET` | `/v1/sessions/:id/messages` | Retrieve all messages in a session |
| `POST` | `/v1/sessions/:id/summarize` | Trigger AI summary generation |
| `GET` | `/v1/sessions/history` | List all past summarized sessions |

### Enable Summarization

**Per-request** (header):
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "X-Summarize: true" \
  -H "Authorization: Bearer sk-proxy-..." \
  ...
```

**Per-client** (database): Set `summary_enabled = true` in the `clients` table.

---

## 📊 Admin Console & Customer Portal

### Admin Console (`/admin`)

A full-featured, zero-dependency web dashboard built into the gateway. No separate frontend build step required.

- **Dashboard:** Real-time spending charts, request volume, error rates
- **People:** Manage clients, issue API keys, set model permissions
- **Models:** Configure supported models, manage pricing, toggle availability
- **Requests:** Full audit log with prompt/response inspection
- **Price Audit:** Automatic drift detection against OpenRouter & LiteLLM
- **Administrators:** Multi-admin support with session-based authentication

### Customer Portal (`/portal`)

A self-service portal where clients can monitor their own usage:

- View request history, token consumption, and costs
- Check which models they have access to
- Monitor budget status (daily/monthly limits)
- Retrieve API keys via secure one-time links

> Enable with `ENABLE_PORTAL=true` in your environment.

---

## ☁️ Deploy to Vercel

The gateway is designed for one-click deployment to Vercel:

### 1. Connect Repository

Link your GitHub repository to Vercel. The included `vercel.json` handles all routing configuration automatically.

### 2. Set Environment Variables

Add all variables from `.env.example` to your Vercel project settings under **Settings → Environment Variables**.

### 3. Deploy

```bash
vercel --prod
```

The gateway will be live at `https://your-project.vercel.app`.

### Vercel Configuration

The included `vercel.json` provides:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index" }],
  "crons": [{ "path": "/admin/api/cron/prices", "schedule": "0 3 * * *" }]
}
```

- **Universal rewrite:** All requests routed through the Hono application
- **Daily cron job:** Automatic model price synchronization at 03:00 UTC

---

## ⚡ Performance Benchmarks

Benchmarks performed with [autocannon](https://github.com/mcollina/autocannon) on a local development machine:

| Test Scenario | Connections | Duration | Total Requests | Req/Sec | Avg Latency | Max Latency |
|---------------|-------------|----------|----------------|---------|-------------|-------------|
| Health Check (raw throughput) | 500 | 5s | **89,000** | **17,752** | 27 ms | 149 ms |
| Auth + Rate Limit (DB bound) | 500 | 10s | 1,000 | 52 | 5,175 ms | 9,573 ms |
| Auth + Real AI Call (50 conn) | 50 | 5s | 310 | 52 | — | — |

> **Note:** The DB-bound test latency reflects cross-continent network distance (Turkey → Ireland). When deployed to the same region as your database (e.g., both on EU-West), expect 100x improvement in DB-bound throughput.

### E2E Latency (Real AI Provider Calls)

| Provider | Model | Cache Miss | Cache Hit | Speedup |
|----------|-------|------------|-----------|---------|
| OpenAI | `gpt-4o` | 2,618 ms | 1,474 ms | **1,144 ms** |
| Anthropic | `claude-sonnet-5` | 3,484 ms | 2,176 ms | **1,308 ms** |
| Gemini | `gemini-3.6-flash` | 2,588 ms | — | — |

---

## 🛡️ Security

- **API Key Hashing:** Client keys are SHA-256 hashed before storage. Plaintext keys are never persisted.
- **One-Time Key Delivery:** Generated keys are encrypted with AES-256-GCM and delivered via single-use links that self-destruct after viewing.
- **Vault Isolation:** Real provider API keys live in a dedicated Vault server, never in application environment variables or client-side code.
- **Rate Limiting:** Redis-based per-client throttling prevents abuse, brute-force attacks, and runaway costs.
- **Fail-Open Design:** If Redis is temporarily unavailable, rate limiting degrades gracefully to keep the proxy operational.
- **GitHub Push Protection:** The repository is configured with GitHub Secret Scanning to prevent accidental secret leaks.

---

## 🏭 Recommended Infrastructure

### Development / Testing (Free Tier)

| Service | Plan | Limits |
|---------|------|--------|
| [Vercel](https://vercel.com) | Hobby (Free) | 500K edge function invocations/month |
| [Supabase](https://supabase.com) | Free | 500 MB storage, 2 GB bandwidth/month |
| [Upstash Redis](https://upstash.com) | Free | 10,000 commands/day |

> ⚠️ **Supabase Free Tier Note:** Projects with no activity for 7 days are automatically paused. Visit the dashboard to resume.

### Production

| Service | Recommended Plan | Why |
|---------|-----------------|-----|
| [Vercel](https://vercel.com) | Pro ($20/mo) | Unlimited edge invocations, team collaboration |
| [Supabase](https://supabase.com) | Pro ($25/mo) | 8 GB storage, no auto-pause, 200 concurrent connections |
| [Upstash Redis](https://upstash.com) | Pay-as-you-go | $0.2 per 100K commands, no daily limit |

---

## 📁 Project Structure

```
ai-proxy-gateway/
├── api/
│   └── index.ts              # Vercel serverless entry point
├── src/
│   ├── app.ts                # Main Hono application & routes
│   ├── server.ts             # Local Node.js development server
│   ├── model_pricing.json    # Static model pricing fallback
│   ├── core/
│   │   ├── anahtarTeslim.ts  # AES-256-GCM one-time key delivery
│   │   ├── butce.ts          # Budget tracking & enforcement
│   │   ├── modelCatalog.ts   # Dynamic model catalog with caching
│   │   ├── priceSource.ts    # OpenRouter/LiteLLM price sync
│   │   ├── providerConfig.ts # Provider URL & key configuration
│   │   └── security.ts       # Security verification pipeline
│   ├── db/
│   │   ├── DrizzleAdapter.ts # Database repository (CRUD operations)
│   │   ├── index.ts          # Lazy Proxy DB connection (serverless-safe)
│   │   └── schema.ts         # Drizzle ORM table definitions
│   ├── interfaces/
│   │   └── IDatabase.ts      # Repository pattern interface
│   ├── middleware/
│   │   ├── authMiddleware.ts  # Bearer token validation
│   │   ├── rateLimiter.ts     # Upstash Redis rate limiter
│   │   └── rateLimitMiddleware.ts
│   ├── routes/
│   │   ├── admin.ts           # Admin console (SPA, ~5,200 LOC)
│   │   └── portal.ts          # Customer portal (SPA, ~1,500 LOC)
│   ├── services/
│   │   └── databaseService.ts # Service binding layer
│   ├── ui/
│   │   └── stil.ts            # Shared CSS & theme constants
│   └── utils/
│       ├── auth.ts            # Key generation & hashing
│       ├── sessionManager.ts  # Redis session tracking & AI summaries
│       ├── supabaseClient.ts  # Supabase JS client
│       └── vault.ts           # Vault client with SWR caching
├── vercel.json                # Vercel deployment config & cron
├── drizzle.config.ts          # Drizzle Kit migration config
├── package.json
└── tsconfig.json
```

---

## 🔧 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string (Supabase transaction pooler) |
| `SUPABASE_URL` | ✅ | Supabase project URL (for admin/portal) |
| `SUPABASE_SERVICE_KEY` | ✅ | Supabase service role key |
| `UPSTASH_REDIS_REST_URL` | ✅ | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Upstash Redis auth token |
| `ADMIN_TOKEN` | ✅ | Secret token to access the admin console |
| `SESSION_SECRET` | ✅ | Signing key for session cookies |
| `VAULT_API_URL` | ❌ | Vault server URL (falls back to env keys if unset) |
| `VAULT_ACCESS_TOKEN` | ❌ | Vault authentication token |
| `OPENAI_API_KEY` | ❌ | Direct OpenAI key (used when Vault is not configured) |
| `ANTHROPIC_API_KEY` | ❌ | Direct Anthropic key (used when Vault is not configured) |
| `GEMINI_API_KEY` | ❌ | Direct Gemini key (used when Vault is not configured) |
| `ENABLE_PORTAL` | ❌ | Set to `true` to enable the customer portal |
| `CRON_SECRET` | ❌ | Auth token for Vercel Cron price sync |
| `PORT` | ❌ | Local dev server port (default: `3000`) |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the ISC License.

---

<p align="center">
  Built with ⚡ by <strong>Iceberg</strong> — because your AI infrastructure deserves better than raw API keys in environment variables.
</p>

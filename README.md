<p align="center">
  <img src="https://img.shields.io/badge/runtime-Node.js%20%7C%20Edge-E36002?style=for-the-badge&logo=hono&logoColor=white" alt="Hono" />
  <img src="https://img.shields.io/badge/deploy-Docker%20%7C%20Vercel%20%7C%20Cloud-000000?style=for-the-badge&logo=docker&logoColor=white" alt="Deploy" />
  <img src="https://img.shields.io/badge/database-PostgreSQL%20%7C%20Pluggable-336791?style=for-the-badge&logo=postgresql&logoColor=white" alt="Database" />
  <img src="https://img.shields.io/badge/cache-Redis%20(Optional)-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/orm-Drizzle-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black" alt="Drizzle" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

# 🚀 AI Proxy Gateway

**A blazing-fast, modular, infrastructure-agnostic AI API Gateway.**

Route requests across OpenAI, Anthropic, Google Gemini, or custom OpenAI-compatible endpoints through a single unified API — with built-in authentication, rate limiting, cost tracking, session summarization, and a full admin console. Built on [Hono](https://hono.dev/) with a pluggable adapter architecture so you can deploy anywhere: **Docker, Kubernetes, bare-metal Node.js, AWS/Railway/Fly.io, or Vercel Edge/Serverless**.

---

## ✨ Features

| Category | Feature | Description |
|----------|---------|-------------|
| 🔀 **Routing** | Unified Endpoint | Single `POST /v1/chat/completions` routes to OpenAI, Anthropic, Gemini, or custom endpoints |
| 🔌 **Modularity** | Pluggable Storage | Adapter pattern (`IDatabase`) works out-of-the-box with PostgreSQL/Supabase or custom adapters (MongoDB, MySQL, SQLite) |
| 🛡️ **Security** | API Key Management | Issue `sk-proxy-*` keys per client. Keys are SHA-256 hashed — never stored in plaintext |
| 🛡️ **Security** | Vault Integration | Store provider secrets in an isolated Vault server or fall back to environment/secret-manager variables |
| 🛡️ **Security** | One-Time Key Delivery | Generated keys are delivered via AES-256-GCM encrypted single-use links |
| ⚡ **Performance** | SWR Caching | Stale-While-Revalidate pattern for Vault keys — 0 ms latency overhead on cache hits |
| ⚡ **Performance** | Portable Runtime | Runs natively on Node.js, Docker containers, or Vercel Edge (17,750+ req/sec benchmarked) |
| 🛡️ **Protection** | Fail-Open Rate Limiting | Redis-backed fixed-window rate limiter that degrades gracefully when Redis is omitted or unreachable |
| 💸 **Cost Control** | Token & Cost Tracking | Every request logged with input/output tokens, latency, and calculated USD cost |
| 💸 **Cost Control** | Budget Limits | Enforce daily and monthly spending caps per organization or user |
| 💸 **Cost Control** | Dynamic Pricing | Auto-syncs model prices from OpenRouter & LiteLLM with drift verification |
| 📊 **Analytics** | Admin Console | Built-in zero-build web dashboard — clients, models, pricing, budgets, and session summaries |
| 📊 **Analytics** | Risk Audit UI | Proactive monitoring interface highlighting flagged prompts and failed requests |
| 📊 **Analytics** | Customer Portal | Optional self-service portal (`ENABLE_PORTAL=true`) for end-users to track usage and keys |
| 🧠 **AI Insights** | Session Summarization | Groups conversations into 15-min sessions and auto-generates AI context summaries |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Client Application                           │
│                    (sends sk-proxy-* Bearer key)                     │
└───────────────────────────┬──────────────────────────────────────────┘
                            │  POST /v1/chat/completions
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      AI Proxy Gateway (Hono)                         │
│  ┌────────────┐  ┌────────────────┐  ┌────────────────────────────┐  │
│  │    Auth    │→ │   Rate Limit   │→ │      Provider Router       │  │
│  │ (IDatabase)│  │ (Redis / Open) │  │  claude* → Anthropic       │  │
│  └────────────┘  └────────────────┘  │  gemini* → Google Gemini   │  │
│                                      │  default → OpenAI / Custom │  │
│  ┌───────────────────┐  ┌──────────┴───────────┐  └───────┬───────┘  │
│  │  Session Tracker  │  │  dbService Adapter   │          │          │
│  │  (Optional Redis) │  │ Postgres / MongoDB / │          │          │
│  └───────────────────┘  │ Custom IDatabase     │          │          │
│                         └──────────────────────┘          │          │
└───────────────────────────┬───────────────────────────────┼──────────┘
                            │                               │
               ┌────────────┘                               ▼
               ▼                              ┌────────────────────────┐
┌───────────────────────────┐                 │   AI Provider APIs     │
│ Secret Source             │                 │   • OpenAI             │
│ • Vault Server (SWR)  OR  │                 │   • Anthropic          │
│ • Env / K8s / Cloud Sec.  │                 │   • Google Gemini      │
└───────────────────────────┘                 │   • Custom Base URLs   │
                                              └────────────────────────┘
```

---

## 🚀 Quick Start

Choose the setup workflow that matches your environment.

### Option A: One-Command Setup with Docker Compose (Self-Hosted / Local)

Spins up PostgreSQL 16, **automatically applies all SQL migrations** from [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql), and starts the gateway on port `3000` — no cloud accounts required.

```bash
git clone https://github.com/ai-proxy-gateway-org/ai-proxy-gateway.git
cd ai-proxy-gateway

cp .env.example .env
# Add at least one provider key (e.g., OPENAI_API_KEY=sk-...) in .env

docker compose up -d
```

The gateway is now live at `http://localhost:3000`.

---

### Option B: Node.js Setup (Any PostgreSQL, Neon, RDS, Railway, or Supabase)

#### 1. Prerequisites
- **Node.js** v20+
- **PostgreSQL 14+** (local Postgres, Docker, AWS RDS, Neon, Railway, or Supabase) — *or implement [`IDatabase`](src/interfaces/IDatabase.ts) for another database engine (see [Adapting to Your Stack](#-adapting-to-your-stack))*
- At least one AI provider API key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`)
- *(Optional)* Redis (Upstash REST or self-hosted via HTTP proxy) for distributed rate limiting & session buffering

#### 2. Clone & Install

```bash
git clone https://github.com/ai-proxy-gateway-org/ai-proxy-gateway.git
cd ai-proxy-gateway
npm install
```

#### 3. Configure Environment

```bash
cp .env.example .env
```

Minimal `.env` required to run the core gateway:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_proxy_gateway
ADMIN_TOKEN=replace-with-a-long-random-secret
SESSION_SECRET=replace-with-another-random-secret
OPENAI_API_KEY=sk-proj-...
```

> **Using the Built-in Admin Console (`/admin`) & Customer Portal (`/portal`)?**
> Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (works with both Supabase Cloud and [Self-Hosted Supabase](https://supabase.com/docs/guides/self-hosting/docker)). See [Environment Variables](#-environment-variables) for all optional modules.

#### 4. Run Database Migrations

All database tables, constraints, indexes, and baseline model seeds are defined in [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql) and [`src/db/schema.ts`](src/db/schema.ts). Apply them with a single command:

```bash
npm run db:migrate
```

<details>
<summary><strong>Alternative migration methods (Drizzle Kit / psql / Supabase CLI)</strong></summary>

```bash
# Option 1: Push schema directly from TypeScript definitions via Drizzle Kit
npm run db:push

# Option 2: Standard psql client against any PostgreSQL server
psql "$DATABASE_URL" -f supabase/migrations/0001_initial_schema.sql

# Option 3: Supabase CLI
npx supabase db push
```
</details>

#### 5. Start the Server

```bash
# Development mode (hot-reload)
npm run dev

# Production mode
npm run start
```

#### 6. Create a Client Key & Send Your First Request

Generate a test client and `sk-proxy-*` key (or issue one via `/admin`):

```bash
npx tsx --env-file=.env src/test.ts
```

Call the unified chat completions endpoint:

```bash
curl -X POST http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-proxy-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Switch providers anytime just by changing `model`:
- **OpenAI:** `gpt-4o`, `gpt-4o-mini`, `o1-mini`, `o3-mini`
- **Anthropic:** `claude-sonnet-4-20250514`, `claude-3-5-sonnet-latest`, `claude-3-opus-20240229`
- **Google Gemini:** `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-pro`

---

## 🔌 Adapting to Your Stack

AI Proxy Gateway is architected around decoupled interfaces so you can swap databases, caches, secret managers, runtimes, or AI backends without rewriting the core proxy.

### 1. Bring Your Own Database (MongoDB, MySQL, SQLite, DynamoDB)

The core gateway communicates exclusively with [`dbService`](src/services/databaseService.ts), which implements the [`IDatabase`](src/interfaces/IDatabase.ts) contract:

```typescript
// src/interfaces/IDatabase.ts
export interface IDatabase {
  createNewClient(name: string, environment: string): Promise<any>;
  verifyClient(token: string): Promise<{ success: boolean; client?: any; error?: string; status?: number }>;
  logRequestStart(clientId: string, provider: string, model: string, prompt?: string | null): Promise<string | null>;
  logRequestComplete(
    logId: string, provider: string, model: string,
    inputTokens: number | null, outputTokens: number | null,
    latencyMs: number, isSuccess: boolean, error_message?: string, response?: string | null
  ): Promise<void>;
  checkModeration(logId: string, prompt: string): Promise<void>;
  saveSession(
    sessionId: string, clientId: string, startedAt: string,
    messageCount: number, summary: string, summaryTokens: number, summaryCost: number
  ): Promise<void>;
  getSessionsByClient(clientId: string, limit?: number): Promise<any[]>;
}
```

**To switch to MongoDB, MySQL, SQLite, or an internal microservice:**
1. Create your adapter class in `src/db/` (e.g., `src/db/MongoAdapter.ts` implementing `IDatabase`).
2. Swap a single line in [`src/services/databaseService.ts`](src/services/databaseService.ts):
   ```typescript
   // src/services/databaseService.ts
   import { MongoAdapter } from '../db/MongoAdapter.js';
   export const dbService = new MongoAdapter();
   ```
No changes to `src/app.ts` or routing middleware are required.

---

### 2. Redis Options (Self-Hosted Redis vs. Upstash vs. Zero-Redis)

- **Zero-Redis Mode (Default if omitted):** Leave `UPSTASH_REDIS_REST_URL` empty. Rate limiting, Vault SWR caching, and session buffering automatically operate in **fail-open** mode so the gateway works with zero Redis dependency.
- **Self-Hosted Redis (Docker / Kubernetes):** Run [`serverless-redis-http` (SRH)](https://github.com/hiett/serverless-redis-http) alongside a standard `redis:7-alpine` container and point `UPSTASH_REDIS_REST_URL` to your local SRH endpoint (`http://srh:80`).
- **Managed Serverless Redis:** Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from Upstash.

---

### 3. Secret Management Options (Vault vs. Environment / Cloud Secrets)

- **Environment / Secret Managers (Simple):** Leave `VAULT_API_URL` unset and inject `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY` via `.env`, Docker Secrets, Kubernetes Secrets, AWS Secrets Manager, or Doppler.
- **Dedicated Vault Server (Zero-Trust Production):** Run the included [`ai-vault-server/`](ai-vault-server) microservice (or a compatible HTTPS endpoint returning `{ "apiKey": "..." }` at `GET /keys/:provider`) and set:
  ```env
  VAULT_API_URL=https://vault.internal.example.com
  VAULT_ACCESS_TOKEN=your-vault-token
  ```
  Keys are cached in Redis using **Stale-While-Revalidate (SWR)** (5-min fresh window, 2-hour TTL, AES-256-GCM encrypted at rest in Redis).

---

### 4. Custom & Self-Hosted LLM Endpoints (Ollama, vLLM, LiteLLM, Azure)

Override upstream provider URLs via environment variables (`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `GEMINI_BASE_URL`) or run the included local mock server (`npm run mock`) for offline CI/CD testing without spending API credits.

---

### 5. Headless Gateway vs. Full Portal Mode

- **Headless / Internal Cost-Center Mode:** Set `ENABLE_PORTAL=false` in `.env` so the customer portal (`/portal`) is never dynamically imported or exposed.
- **Full B2B / Multi-Team Mode:** Set `ENABLE_PORTAL=true` to give end-users self-service visibility into their own token consumption, budgets, allowed models, and one-time key handover links.

---

## ☁️ Deployment Guides

### Deploy Anywhere with Docker (AWS ECS, Fly.io, Railway, Render, Coolify, K8s)

Build and run the standalone container image using the included [`Dockerfile`](Dockerfile):

```bash
docker build -t ai-proxy-gateway .

docker run -d \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@db-host:5432/ai_proxy" \
  -e OPENAI_API_KEY="sk-proj-..." \
  -e ADMIN_TOKEN="your-secret" \
  -e SESSION_SECRET="your-session-secret" \
  ai-proxy-gateway
```

Run migrations against your target database before or during release:

```bash
DATABASE_URL="postgresql://user:pass@db-host:5432/ai_proxy" npm run db:migrate
```

### Deploy Serverless / Edge to Vercel

The included [`vercel.json`](vercel.json) and [`api/index.ts`](api/index.ts) entry point configure universal routing and a daily `03:00 UTC` price-sync cron job automatically:

```bash
npm i -g vercel
vercel --prod
```

Configure the variables from [`.env.example`](.env.example) under **Vercel Project Settings → Environment Variables** (use a pooled PostgreSQL connection string for `DATABASE_URL` in serverless environments).

---

## 🧠 Session Summarization

The gateway can group multi-turn API interactions into 15-minute sliding sessions and generate concise AI context summaries.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/sessions/current` | Get the active session for the authenticated client |
| `GET` | `/v1/sessions/:id/messages` | Retrieve buffered messages in an active session |
| `POST` | `/v1/sessions/:id/summarize` | Trigger AI summary generation and persist to DB |
| `GET` | `/v1/sessions/history` | List past summarized sessions from the database |

Enable per request via header (`-H "X-Summarize: true"`) or per client (`summary_enabled = true`).

---

## 📊 Admin Console & Customer Portal

- **Admin Console (`/admin`):** Zero-build web dashboard for managing organizations, users, `sk-proxy-*` keys, model permissions, daily/monthly budgets, risk audit logs (flagged prompts & errors), session summaries, and automated price-drift checks against OpenRouter & LiteLLM.
- **Customer Portal (`/portal`):** Optional self-service interface (`ENABLE_PORTAL=true`) where team members inspect their own usage, remaining budgets, and allowed models.

---

## ⚡ Performance Benchmarks

Benchmarked locally with [autocannon](https://github.com/mcollina/autocannon):

| Test Scenario | Connections | Duration | Total Requests | Req/Sec | Avg Latency |
|---------------|-------------|----------|----------------|---------|-------------|
| Health Check (raw Hono routing) | 500 | 5s | **89,000** | **17,752** | 27 ms |
| Auth + Rate Limit + Real AI Call | 50 | 5s | 310 | 52 | Provider-bound |

> **Tip:** Co-locating your compute runtime and database in the same cloud region (e.g., both in `eu-central-1` or `us-east-1`) keeps auth & logging overhead under a few milliseconds.

---

## 🛡️ Security Highlights

- **SHA-256 Key Hashing:** Client `sk-proxy-*` keys are hashed before storage; plaintext keys are never persisted.
- **AES-256-GCM Handover Links:** Newly issued keys are delivered via single-use links (`/reveal/:token`) where the decryption key is derived from the URL token (never stored in the DB) and wiped immediately once opened.
- **Vault Secret Isolation:** Master provider keys can be isolated in [`ai-vault-server`](ai-vault-server) and encrypted in Redis SWR cache.
- **Domain Whitelisting & Model Caps:** Browser-based clients enforce `Origin` allowlists, per-user/client model allowlists, and `max_output_price` ceilings.
- **Async Content Moderation:** Prompts are checked asynchronously in the background without adding latency to client responses.

---

## 📁 Project Structure

```
ai-proxy-gateway/
├── api/
│   └── index.ts                             # Vercel serverless / edge entry point
├── ai-vault-server/                         # Optional standalone Vault microservice
├── scripts/
│   └── migrate.ts                           # Cross-platform SQL migration runner
├── supabase/
│   └── migrations/
│       └── 0001_initial_schema.sql          # Full idempotent PostgreSQL schema & seeds
├── src/
│   ├── app.ts                               # Main Hono application & proxy routes
│   ├── server.ts                            # Node.js / Docker server entry point
│   ├── model_pricing.json                   # Static model pricing fallback
│   ├── core/
│   │   ├── budget.ts                        # Daily & monthly budget enforcement
│   │   ├── keyDelivery.ts                   # AES-256-GCM one-time key handover
│   │   ├── kimlik.ts                        # Admin & customer portal authentication
│   │   ├── modelAuthorization.ts            # Model allowlist & price-ceiling checks
│   │   ├── modelCatalog.ts                  # Cached dynamic model catalog
│   │   ├── priceSource.ts                   # OpenRouter & LiteLLM price sync
│   │   ├── providerConfig.ts                # Upstream provider URLs & headers
│   │   └── security.ts                      # Auth → Domain → Rate-limit pipeline
│   ├── db/
│   │   ├── DrizzleAdapter.ts                # Default PostgreSQL IDatabase adapter
│   │   ├── index.ts                         # Lazy PostgreSQL connection proxy
│   │   └── schema.ts                        # Drizzle ORM table definitions
│   ├── interfaces/
│   │   └── IDatabase.ts                     # Pluggable database adapter interface
│   ├── middleware/
│   │   ├── authMiddleware.ts                # Bearer token verification
│   │   ├── domainWhitelister.ts             # Browser Origin allowlist check
│   │   ├── rateLimiter.ts                   # Fail-open Redis rate limiter
│   │   └── rateLimitMiddleware.ts
│   ├── routes/
│   │   ├── admin.ts                         # Built-in Admin Console SPA & API
│   │   ├── portal.ts                        # Built-in Customer Portal SPA & API
│   │   └── reveal.ts                        # One-time key reveal route
│   ├── services/
│   │   └── databaseService.ts               # Active IDatabase adapter binding
│   └── utils/
│       ├── auth.ts                          # Key generation & SHA-256 hashing
│       ├── sessionManager.ts                # Sliding-window Redis sessions & summaries
│       ├── supabaseClient.ts                # Lazy Supabase REST client (admin/portal)
│       └── vault.ts                         # Vault client with encrypted SWR cache
├── Dockerfile                               # Production Node.js container image
├── docker-compose.yml                       # Local/self-hosted Postgres + Gateway stack
├── drizzle.config.ts                        # Drizzle Kit schema & migration config
├── vercel.json                              # Vercel routing & cron config
├── .env.example                             # Documented environment template
└── package.json
```

---

## 🔧 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅* | — | PostgreSQL connection URL (*not needed if using a custom `IDatabase` adapter) |
| `OPENAI_API_KEY` | ❌ | — | Direct OpenAI key (used when `VAULT_API_URL` is unset) |
| `ANTHROPIC_API_KEY` | ❌ | — | Direct Anthropic key (used when `VAULT_API_URL` is unset) |
| `GEMINI_API_KEY` | ❌ | — | Direct Google Gemini key (used when `VAULT_API_URL` is unset) |
| `OPENAI_BASE_URL` | ❌ | `https://api.openai.com` | Custom OpenAI-compatible base URL (Ollama, vLLM, Azure, etc.) |
| `ANTHROPIC_BASE_URL` | ❌ | `https://api.anthropic.com` | Custom Anthropic-compatible base URL |
| `GEMINI_BASE_URL` | ❌ | `https://generativelanguage...` | Custom Gemini-compatible base URL |
| `VAULT_API_URL` | ❌ | — | Centralized Vault server URL (overrides direct `*_API_KEY` env vars) |
| `VAULT_ACCESS_TOKEN` | ❌ | — | Bearer token for authenticating with Vault server |
| `UPSTASH_REDIS_REST_URL` | ❌ | — | Redis HTTP endpoint (Upstash or `serverless-redis-http`). Fails open if unset |
| `UPSTASH_REDIS_REST_TOKEN` | ❌ | — | Redis HTTP auth token |
| `SUPABASE_URL` | ❌ | — | Supabase REST URL (required for built-in `/admin` & `/portal` dashboards) |
| `SUPABASE_SERVICE_KEY` | ❌ | — | Supabase service-role key (for `/admin` & `/portal`) |
| `ADMIN_TOKEN` | ❌ | — | Bootstrap token for `/admin` access & encryption fallback |
| `SESSION_SECRET` | ❌ | — | HMAC signing secret for admin & portal session cookies |
| `ENABLE_PORTAL` | ❌ | `false` | Set to `true` to mount the `/portal` self-service customer dashboard |
| `BUDGET_TIMEZONE` | ❌ | `Europe/Istanbul` | IANA timezone used for daily/monthly budget rollover boundaries |
| `CRON_SECRET` | ❌ | — | Bearer secret for triggering `/admin/api/cron/prices` |
| `HOST` | ❌ | `127.0.0.1` | Bind address for Node.js server (`0.0.0.0` in Docker) |
| `PORT` | ❌ | `3000` | HTTP listen port for Node.js server |

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md) before submitting a Pull Request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the [ISC License](LICENSE).

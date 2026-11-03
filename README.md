<p align="center">
  <img src="https://img.shields.io/badge/runtime-Node.js%20%7C%20Edge-E36002?style=for-the-badge&logo=hono&logoColor=white" alt="Hono" />
  <img src="https://img.shields.io/badge/deploy-Docker%20%7C%20Vercel%20%7C%20Cloud-000000?style=for-the-badge&logo=docker&logoColor=white" alt="Deploy" />
  <img src="https://img.shields.io/badge/database-PostgreSQL%20%7C%20Pluggable-336791?style=for-the-badge&logo=postgresql&logoColor=white" alt="Database" />
  <img src="https://img.shields.io/badge/cache-Redis%20(Upstash%20%7C%20SRH)-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/orm-Drizzle-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black" alt="Drizzle" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

# 🚀 AI Proxy Gateway

**A modular, infrastructure-agnostic AI API Gateway for multi-provider routing, cost tracking, and key management.**

Route requests across OpenAI, Anthropic, Google Gemini, or custom OpenAI-compatible endpoints through a single unified API — with built-in authentication, rate limiting, cost tracking, session summarization, and an admin console. Built on [Hono](https://hono.dev/) with a pluggable storage adapter (`IDatabase`) so you can run it anywhere: **Docker Compose, Kubernetes, standalone Node.js VMs, AWS/Railway/Fly.io, or Vercel Serverless/Edge**.

---

## ✨ Features

| Category | Feature | Description |
|----------|---------|-------------|
| 🔀 **Routing** | Unified Endpoint | Single `POST /v1/chat/completions` routes to OpenAI, Anthropic, Gemini, or custom endpoints based on model prefix |
| 🔌 **Modularity** | Pluggable Storage | Adapter pattern (`IDatabase`) works out-of-the-box with PostgreSQL/Supabase or custom adapters (MongoDB, MySQL, SQLite) |
| 🛡️ **Security** | API Key Management | Issue `sk-proxy-*` keys per client via CLI or UI. Keys are SHA-256 hashed — never stored in plaintext |
| 🛡️ **Security** | Vault Integration | Store provider secrets in an isolated Vault server (`ai-vault-server`) or read from environment/secret-manager variables |
| 🛡️ **Security** | One-Time Key Delivery | Generated keys can be delivered via AES-256-GCM encrypted single-use links (`/reveal/:token`) |
| ⚡ **Performance** | SWR Caching | Stale-While-Revalidate pattern for Vault keys — 0 ms latency overhead on Redis cache hits |
| 🛡️ **Protection** | Rate Limiting | Redis-backed fixed-window rate limiter per client (`rate_limit` req/min) with fail-open fault tolerance |
| 💸 **Cost Control** | Token & Cost Tracking | Every request logged asynchronously with input/output tokens, latency, and USD cost calculated from `model_catalog` |
| 💸 **Cost Control** | Budget Limits | Enforce daily and monthly spending caps per organization or user |
| 💸 **Cost Control** | Dynamic Pricing | Auto-syncs model prices from OpenRouter & LiteLLM with cross-source drift verification |
| 📊 **Analytics** | Admin Console | Built-in web dashboard (`/admin`) — clients, users, models, pricing, budgets, risk audit, and session summaries |
| 📊 **Analytics** | Customer Portal | Optional self-service portal (`/portal`, enabled via `ENABLE_PORTAL=true`) for end-users to track usage and keys |
| 🧠 **AI Insights** | Session Summarization | Groups conversations into 15-min sliding sessions and generates AI context summaries |

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
│  │  (Redis 15m TTL)  │  │ Postgres / MongoDB / │          │          │
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

### Core Gateway vs. Web UI Dashboards (`/admin` & `/portal`)

| Component | Database Connection Used | Cloud Account Required? |
|-----------|--------------------------|-------------------------|
| **Core Proxy Gateway** (`POST /v1/chat/completions`, `/v1/sessions/*`, CLI scripts `db:migrate` & `key:create`) | Standard PostgreSQL (`DATABASE_URL` via Drizzle ORM) **or** any custom [`IDatabase`](src/interfaces/IDatabase.ts) adapter | **No** — runs 100% locally with Docker PostgreSQL, Neon, RDS, Railway, or custom DB |
| **Web Dashboards** (`/admin` Admin Console & `/portal` Customer Portal) | Supabase REST client (`SUPABASE_URL` + `SUPABASE_SERVICE_KEY`) | **Requires Supabase** (Free Tier cloud project or [Self-Hosted Supabase](https://supabase.com/docs/guides/self-hosting/docker)). Without Supabase, use `npm run key:create` and SQL to manage clients/keys |

---

## 🚀 Quick Start

### Option A: Docker Compose (Zero-Cloud Local / Self-Hosted Core Gateway)

Requires **Docker Engine** with **Docker Compose v2.24+** (uses `env_file.required: false`).

Spins up PostgreSQL 16 (bound to `127.0.0.1:5432` so it is not exposed to external networks), **automatically runs `npm run db:migrate`** on every container startup (recording applied SQL files in `schema_migrations`), and starts the gateway container on port `3000` (`HOST=0.0.0.0`).

> **Note:** Inside [`docker-compose.yml`](docker-compose.yml), the `gateway` container uses `DOCKER_DATABASE_URL` (defaulting to `postgresql://postgres:postgres@postgres:5432/ai_proxy_gateway`) so that `DATABASE_URL=...@localhost:5432/...` in your host `.env` file never overrides the internal Docker service hostname `postgres`.

```bash
git clone https://github.com/ai-proxy-gateway-org/ai-proxy-gateway.git
cd ai-proxy-gateway

cp .env.example .env
# Edit .env and set at least one provider key (e.g., OPENAI_API_KEY=sk-proj-...)

docker compose up -d

# Issue your first client and sk-proxy-* API key inside the running container:
docker compose exec gateway npm run key:create -- "My First App" production
```

The gateway is now live at `http://localhost:3000`.

> **Admin Console in Option A:** The Compose stack runs the **core gateway only** (`/v1/chat/completions`, `/v1/sessions/*`, `key:create`). The `/admin` and `/portal` dashboards additionally need `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` in `.env` (a free Supabase Cloud project pointed at the same schema works). Without them, manage clients/keys with `npm run key:create` and SQL.
>
> **Adding migrations later:** The gateway container runs `npm run db:migrate` on every start, so new files like `supabase/migrations/0002_*.sql` are applied automatically on `docker compose up -d --build` (already-applied files are skipped via `schema_migrations`).

---

### Option B: Node.js Setup (Local Postgres, Supabase, Neon, RDS, or Railway)

#### 1. Prerequisites
- **Node.js v20+** (v22 LTS recommended)
- **PostgreSQL 14+** (local Postgres, Docker, Supabase, Neon, AWS RDS, or Railway) — *or implement [`IDatabase`](src/interfaces/IDatabase.ts) for another database engine (see [Adapting to Your Stack](#-adapting-to-your-stack))*
- At least one AI provider API key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`) — *or use `npm run mock` for offline zero-key testing*
- *(Optional, recommended for production)* Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) for rate limiting, Vault SWR caching, and session buffering
- *(Optional)* `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` if you want to use the `/admin` and `/portal` web dashboards

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

> **Note:** Both `npm run dev` and `npm run start` automatically load `.env` from the working directory via [`src/utils/env.ts`](src/utils/env.ts) (and silently skip it in container/serverless environments where variables are injected by the platform).

Minimal `.env` for the core gateway:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_proxy_gateway
ADMIN_TOKEN=generate-with-openssl-rand-hex-32
SESSION_SECRET=generate-with-openssl-rand-hex-32
OPENAI_API_KEY=sk-proj-...
```

> ⚠️ **Security Warning:** Always set strong random values for `ADMIN_TOKEN` and `SESSION_SECRET` (e.g., run `openssl rand -hex 32`) before exposing the server to a network.

#### 4. Run Database Migrations

All 9 database tables (`clients`, `users`, `admin_users`, `client_keys`, `key_deliveries`, `logs`, `sessions`, `model_catalog`, `price_events`), indexes, and initial `model_catalog` seeds (`gpt-4o`, `gpt-4o-mini`, `claude-sonnet-4-20250514`, `claude-3-5-sonnet-latest`, `gemini-2.5-flash`) are defined in [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql).

Apply them with a single command (tracks applied files in `schema_migrations` so each migration runs only once, in addition to using idempotent SQL):

```bash
npm run db:migrate
```

<details>
<summary><strong>Alternative migration methods (Drizzle Kit / psql / Supabase CLI)</strong></summary>

```bash
# Option 1: Push schema directly from TypeScript definitions (src/db/schema.ts)
npm run db:push

# Option 2: Standard psql client against any PostgreSQL server
psql "$DATABASE_URL" -f supabase/migrations/0001_initial_schema.sql

# Option 3: Supabase CLI with explicit database URL
npx supabase db push --db-url "$DATABASE_URL"
```
</details>

#### 5. Start the Server

```bash
# Development mode (hot-reload)
npm run dev

# Production mode (loads .env if present, runs src/server.ts)
npm run start
```

> **Offline / Zero-Key Testing:** Want to test without real OpenAI/Anthropic/Gemini API keys? Run `npm run mock` in a second terminal (starts a local mock AI provider on `http://127.0.0.1:4000`) and set `OPENAI_BASE_URL=http://127.0.0.1:4000` and `OPENAI_API_KEY=mock-key` in `.env`.

#### 6. Create Your First Client & `sk-proxy-*` API Key

**Method 1 — CLI Script (works with any PostgreSQL or custom `IDatabase` adapter):**

```bash
npm run key:create -- "Acme Backend" production
```

Output:
```text
✅ Client and API key created successfully!
────────────────────────────────────────────────────────────
Client ID : 7f9c2b10-...
API Key   : sk-proxy-9a8b7c6d5e4f...
────────────────────────────────────────────────────────────
⚠️  Save this API key now — only its SHA-256 hash is stored in the database.
```

By default, `key:create` creates an active `server-based` client with access to the seeded models (`gpt-4o`, `gpt-4o-mini`, `claude-sonnet-4-20250514`, `claude-3-5-sonnet-latest`, `gemini-2.5-flash`).

**Method 2 — Admin Console Web UI (when `SUPABASE_URL` & `SUPABASE_SERVICE_KEY` are configured):**
1. Open `http://127.0.0.1:3000/admin` in your browser.
2. Sign in using your `ADMIN_TOKEN` (from `.env`) to bootstrap your first administrator account (`admin_users`), or sign in with an existing admin email & password.
3. Under **People / Customers**, create a client or user, configure `allowed_models`, `max_output_price`, and daily/monthly budgets, and issue a new `sk-proxy-*` key (or generate a one-time AES-256-GCM `/reveal/:token` link).

#### 7. Send Your First Request

```bash
curl -X POST http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-proxy-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Switch providers just by changing `model`. The fresh database is seeded with exactly these 5 models in `model_catalog`:
- **OpenAI:** `gpt-4o`, `gpt-4o-mini`
- **Anthropic:** `claude-sonnet-4-20250514`, `claude-3-5-sonnet-latest`
- **Google Gemini:** `gemini-2.5-flash`

> **Using other models:** Any model not in `model_catalog` is rejected with `400 Model '<name>' is not available on this gateway`. To enable more models, add them in `/admin` → **Models** (or run the price sync cron), or insert them directly:
> ```sql
> INSERT INTO model_catalog (provider, model, input_price, output_price, is_active, price_source)
> VALUES ('openai', 'o3-mini', 0.0011, 0.0044, true, 'manual')   -- prices are USD per 1K tokens
> ON CONFLICT (provider, model) DO NOTHING;
> ```
> Then grant it to a client by appending `openai/o3-mini` to `clients.allowed_models` (or via `/admin`).

---

## 💻 Using with Official SDKs

Because `POST /v1/chat/completions` accepts `Authorization: Bearer sk-proxy-...` and injects upstream provider headers (`Authorization: Bearer`, `x-api-key` + `anthropic-version`) on the server side, you can use the **official OpenAI SDK** to call OpenAI, Anthropic, and Gemini models by setting `baseURL` and `apiKey`:

### TypeScript / Node.js (`npm install openai`)

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://127.0.0.1:3000/v1',
  apiKey: process.env.PROXY_API_KEY, // sk-proxy-...
});

// 1. OpenAI
const gpt = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello from OpenAI!' }],
});

// 2. Google Gemini (routed via Gemini's OpenAI compatibility layer)
const gemini = await client.chat.completions.create({
  model: 'gemini-2.5-flash',
  messages: [{ role: 'user', content: 'Hello from Gemini!' }],
});
```

### Python (`pip install openai`)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:3000/v1",
    api_key="sk-proxy-your-key-here",
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}],
)
print(response.choices[0].message.content)
```

> **Note on Anthropic Request/Response Format:** When `model` starts with `claude`, the gateway forwards the request body to Anthropic's `/v1/messages` endpoint (which requires `max_tokens` in the request body and returns `content[0].text` in the JSON response, while the gateway extracts `content[0].text` for audit logging).

---

## 📋 Unified Endpoint Capabilities & Known Limitations

Understanding how `POST /v1/chat/completions` routes and processes requests helps you plan production deployments:

| Aspect | Current Behavior & Scope |
|--------|--------------------------|
| **Routing Rule** | Model prefix based: `claude*` → Anthropic (`/v1/messages`), `gemini*` → Google Gemini (`/v1beta/openai/chat/completions`), all other model names → OpenAI (`/v1/chat/completions`). |
| **Custom `OPENAI_BASE_URL` (Ollama / vLLM / LiteLLM)** | Setting `OPENAI_BASE_URL` redirects the default (non-`claude*`, non-`gemini*`) route to your custom endpoint. Because it overrides the default OpenAI base URL, OpenAI Cloud and a custom `OPENAI_BASE_URL` cannot be used simultaneously on the same instance unless routed through an upstream aggregator like LiteLLM/OpenRouter. |
| **Response Mode (JSON vs. SSE Streaming)** | The unified `/v1/chat/completions` handler currently parses upstream responses as JSON (`await aiResponse.json()`) to extract token usage and response text for cost logging and session buffering. It is designed for standard (non-streaming) JSON completions. |
| **Payload Pass-Through (Tools / Vision)** | Request bodies are forwarded as-is (`JSON.stringify(body)`) to the target endpoint. OpenAI and Gemini (via Google's OpenAI-compatible endpoint) share the same payload schema; Anthropic `/v1/messages` expects Anthropic-formatted fields (`max_tokens`, `messages`). |
| **Redis Fail-Open Mode** | If `UPSTASH_REDIS_REST_URL` is omitted or unreachable, the gateway degrades gracefully (requests succeed without rate limiting or session buffering). **For production deployments, always configure Redis** so rate limits (`rate_limit`) and Vault SWR caching are actively enforced. |

---

## 📜 Available NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local development server with hot-reload (`tsx watch src/server.ts`) |
| `npm run start` | Start production Node.js server (`tsx src/server.ts`, auto-loads `.env` if present) |
| `npm run db:migrate` | Apply all SQL migrations in `supabase/migrations/` using `DATABASE_URL` |
| `npm run db:push` | Push Drizzle TypeScript schema (`src/db/schema.ts`) directly to PostgreSQL |
| `npm run key:create -- "<Name>" [env]` | Create a new client and generate a `sk-proxy-*` API key via CLI |
| `npm run mock` | Start local Hono mock AI provider server on `http://127.0.0.1:4000` (zero API cost) |
| `npm run mock-vault` | Start local mock Vault server on `http://127.0.0.1:4001` for testing SWR key encryption |
| `npm run typecheck` | Run TypeScript compiler check (`tsc --noEmit`) across all source files |
| `npm test` | Run the database, auth, domain allowlist, rate-limit, and logging integration suite (`src/test.ts`) |

> ⚠️ **`npm test` writes real rows** to the database in `DATABASE_URL` (2 clients named `[TEST] ...`, 1 key each, 1 log row). Run it against a **test database only** — it refuses to run when `NODE_ENV=production` unless `ALLOW_TEST_WRITES=true`. Cleanup:
> ```sql
> DELETE FROM logs    WHERE client_id IN (SELECT id FROM clients WHERE name LIKE '[TEST]%');
> DELETE FROM clients WHERE name LIKE '[TEST]%';   -- client_keys cascade via foreign key
> ```
> To create a real client/key, use `npm run key:create` instead.

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

### 2. Redis Options (Upstash vs. Self-Hosted Redis vs. Zero-Redis Dev Mode)

- **Managed Serverless Redis (Upstash):** Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- **Self-Hosted Redis (Docker / Kubernetes):** Run [`serverless-redis-http` (SRH)](https://github.com/hiett/serverless-redis-http) alongside a standard `redis:7-alpine` container and point `UPSTASH_REDIS_REST_URL` to your local SRH endpoint (`http://srh:80`).
- **Zero-Redis Mode (Local Development Only):** Leave `UPSTASH_REDIS_REST_URL` empty. The gateway runs in fail-open mode without Redis.

### 3. Secret Management Options (Vault vs. Environment / Cloud Secrets)

- **Environment / Secret Managers (Simple):** Leave `VAULT_API_URL` unset and inject `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY` via `.env`, Docker Secrets, Kubernetes Secrets, AWS Secrets Manager, or Doppler.
- **Dedicated Vault Server (Zero-Trust Production):** Run the included [`ai-vault-server/`](ai-vault-server) microservice (or any HTTPS endpoint returning `{ "apiKey": "..." }` at `GET /keys/:provider`) and set:
  ```env
  VAULT_API_URL=https://vault.internal.example.com
  VAULT_ACCESS_TOKEN=your-vault-token
  ```
  Keys are cached in Redis using **Stale-While-Revalidate (SWR)** (5-min fresh window, 2-hour TTL, AES-256-GCM encrypted at rest in Redis).

---

## 🔒 Privacy & Data Retention

Know what leaves your infrastructure and what is stored before going to production:

| Behavior | Default | What happens | How to change |
|----------|---------|--------------|---------------|
| **Prompt moderation** | On (`ENABLE_MODERATION=true`) | Every prompt is sent **in the background** to OpenAI's Moderation API (`https://api.openai.com/v1/moderations`) using your OpenAI key. Flagged requests get `logs.is_flagged = true` + `flagged_reason`. Requests are never blocked. If no OpenAI key is available the check is silently skipped. | Set `ENABLE_MODERATION=false` (recommended when using non-OpenAI or self-hosted models only, or when prompts must not reach OpenAI) |
| **Payload logging** | On (`LOG_PAYLOADS=true`) | Full request messages (`logs.prompt`) and response text (`logs.response`) are stored in your database for auditing and the admin console. | Set `LOG_PAYLOADS=false` to store metadata only (model, tokens, cost, latency, status, error) |
| **Session buffering** | Per client / per request (`summary_enabled`, `X-Summarize: true`) | Q&A pairs are buffered in Redis (15-min sliding TTL) and summarized by `gpt-4o-mini`; summaries are stored in `sessions`. | Leave `summary_enabled = false` and don't send `X-Summarize` |
| **Retention** | Unlimited | The gateway never deletes `logs` or `sessions` rows automatically. | Schedule your own cleanup, e.g. `DELETE FROM logs WHERE created_at < now() - interval '90 days';` (via `pg_cron`, a cron job, or your DB provider's scheduler) |

> [!IMPORTANT]
> If you process personal data (GDPR / KVKK), document these flows in your privacy policy, or disable moderation and payload logging.

---

## ☁️ Deployment Guides

### 1. Deploy with Docker (AWS ECS, Fly.io, Railway, Render, Coolify, K8s)

The included [`Dockerfile`](Dockerfile) installs production dependencies (`npm ci --omit=dev` — `tsx` is included in `dependencies`) and sets `ENV HOST=0.0.0.0 PORT=3000`:

```bash
# 1. Run database migrations against your target PostgreSQL database (requires npm install first)
npm install
DATABASE_URL="postgresql://user:pass@db-host:5432/ai_proxy" npm run db:migrate

# 2. Build and run the container
docker build -t ai-proxy-gateway .

docker run -d \
  -p 3000:3000 \
  -e HOST="0.0.0.0" \
  -e PORT="3000" \
  -e DATABASE_URL="postgresql://user:pass@db-host:5432/ai_proxy" \
  -e OPENAI_API_KEY="sk-proj-..." \
  -e ADMIN_TOKEN="your-strong-random-secret" \
  -e SESSION_SECRET="your-strong-session-secret" \
  ai-proxy-gateway
```

### 2. Deploy Serverless to Vercel

#### Step 1: Run Migrations on Your Production Database
Before deploying, ensure your production PostgreSQL / Supabase database schema is initialized:
```bash
DATABASE_URL="postgresql://postgres.xxx:pass@aws-0-region.pooler.supabase.com:6543/postgres" npm run db:migrate
```

#### Step 2: Configure Vercel Environment Variables
In **Vercel Project Settings → Environment Variables**, add the variables from [`.env.example`](.env.example):
- `DATABASE_URL` (use the transaction pooler port `6543` for serverless connections)
- `SUPABASE_URL` & `SUPABASE_SERVICE_KEY` (for `/admin` and `/portal`)
- `UPSTASH_REDIS_REST_URL` & `UPSTASH_REDIS_REST_TOKEN`
- `ADMIN_TOKEN`, `SESSION_SECRET`, and `CRON_SECRET`
- Provider keys (`OPENAI_API_KEY`, etc.) or `VAULT_API_URL` + `VAULT_ACCESS_TOKEN`

#### Step 3: Deploy
```bash
npm i -g vercel
vercel --prod
```

The included [`vercel.json`](vercel.json) configures universal routing to [`api/index.ts`](api/index.ts) and two daily cron jobs (authenticated via `CRON_SECRET`):
```json
{
  "framework": null,
  "rewrites": [
    { "source": "/(.*)", "destination": "/api/index" }
  ],
  "crons": [
    { "path": "/admin/api/cron/prices", "schedule": "0 3 * * *" },
    { "path": "/admin/api/cron/sessions", "schedule": "0 4 * * *" }
  ]
}
```
- **`/admin/api/cron/prices` (`03:00 UTC`):** Syncs and cross-verifies model pricing from OpenRouter and LiteLLM.
- **`/admin/api/cron/sessions` (`04:00 UTC`):** Summarizes expired Redis conversation sessions via `gpt-4o-mini` and archives them to PostgreSQL.

---

## 🧠 Session Summarization

The gateway can group multi-turn API interactions into 15-minute sliding sessions in Redis and generate AI context summaries.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/sessions/current` | Get the active session for the authenticated client |
| `GET` | `/v1/sessions/:id/messages` | Retrieve buffered messages in an active session |
| `POST` | `/v1/sessions/:id/summarize` | Trigger AI summary generation (`gpt-4o-mini`) and persist to DB |
| `GET` | `/v1/sessions/history` | List past summarized sessions from the database |

Enable per request via header (`-H "X-Summarize: true"`) or per client (`summary_enabled = true`).

---

## ⚡ Performance Benchmarks

Benchmarked locally with [autocannon](https://github.com/mcollina/autocannon) to measure raw HTTP framework overhead vs. end-to-end authenticated calls:

| Test Scenario | Connections | Duration | Total Requests | Req/Sec | Avg Latency | Notes |
|---------------|-------------|----------|----------------|---------|-------------|-------|
| `GET /` Health Check (raw Hono routing overhead) | 500 | 5s | 89,000 | 17,752 | 27 ms | Measures framework overhead without DB/LLM I/O |
| `POST /v1/chat/completions` (Auth + Rate Limit + Real AI Call) | 50 | 5s | 310 | 52 | Provider-bound | Bound by upstream LLM generation latency (1.4s–3.5s) |

---

## 📁 Project Structure

```
ai-proxy-gateway/
├── api/
│   └── index.ts                             # Vercel serverless entry point
├── ai-vault-server/                         # Optional standalone Vault microservice
├── mock-server/
│   └── index.ts                             # Local mock AI provider (npm run mock)
├── mock-vault/
│   └── index.ts                             # Local mock Vault server (npm run mock-vault)
├── scripts/
│   ├── create-key.ts                        # CLI utility to create clients & sk-proxy-* keys
│   └── migrate.ts                           # Cross-platform SQL migration runner
├── supabase/
│   └── migrations/
│       └── 0001_initial_schema.sql          # Full idempotent PostgreSQL schema & seeds
├── src/
│   ├── app.ts                               # Main Hono application & proxy routes
│   ├── server.ts                            # Node.js / Docker server entry point (loads .env)
│   ├── test.ts                              # Integration test suite (npm test)
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
│   │   ├── databaseService.ts               # Active IDatabase adapter binding
│   │   ├── db.ts                            # Client helper wrapper
│   │   └── logger.ts                        # Async request logger wrapper
│   ├── ui/
│   │   └── stil.ts                          # Shared dashboard styles
│   └── utils/
│       ├── auth.ts                          # Key generation & SHA-256 hashing
│       ├── env.ts                           # Zero-dependency .env loader
│       ├── hesap.ts                         # Scrypt password hashing & HMAC cookies
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

All variables match [`.env.example`](.env.example):

| Variable | Required | Default in `.env.example` | Description |
|----------|----------|---------------------------|-------------|
| `DATABASE_URL` | ✅* | `postgresql://postgres:...` | PostgreSQL connection URL (*not needed if using a custom `IDatabase` adapter) |
| `ADMIN_TOKEN` | ✅ (Prod) | *(empty)* | Secret token for `/admin` bootstrap & encryption fallback. Generate with `openssl rand -hex 32` |
| `SESSION_SECRET` | ✅ (Prod) | *(empty)* | HMAC signing secret for `/admin` and `/portal` session cookies. Generate with `openssl rand -hex 32` |
| `OPENAI_API_KEY` | ❌** | *(empty)* | Direct OpenAI key (**at least one provider key or Vault is required to make AI calls) |
| `ANTHROPIC_API_KEY` | ❌** | *(empty)* | Direct Anthropic key (used when `VAULT_API_URL` is unset) |
| `GEMINI_API_KEY` | ❌** | *(empty)* | Direct Google Gemini key (used when `VAULT_API_URL` is unset) |
| `OPENAI_BASE_URL` | ❌ | *(empty → `https://api.openai.com`)* | Custom OpenAI-compatible base URL (Ollama, vLLM, LiteLLM, or `http://127.0.0.1:4000` for mock) |
| `ANTHROPIC_BASE_URL` | ❌ | *(empty → `https://api.anthropic.com`)* | Custom Anthropic-compatible base URL |
| `GEMINI_BASE_URL` | ❌ | *(empty → `https://generativelanguage...`)* | Custom Gemini-compatible base URL |
| `VAULT_API_URL` | ❌ | *(empty)* | Centralized Vault server URL (overrides direct `*_API_KEY` env vars) |
| `VAULT_ACCESS_TOKEN` | ❌ | *(empty)* | Bearer token for authenticating with Vault server |
| `UPSTASH_REDIS_REST_URL` | ❌ (Prod ✅) | *(empty)* | Redis HTTP endpoint (Upstash or `serverless-redis-http`). Fails open if unset |
| `UPSTASH_REDIS_REST_TOKEN` | ❌ (Prod ✅) | *(empty)* | Redis HTTP auth token |
| `SUPABASE_URL` | ❌*** | *(empty)* | Supabase Project URL (***required for `/admin` and `/portal` web dashboards) |
| `SUPABASE_SERVICE_KEY` | ❌*** | *(empty)* | Supabase `service_role` secret key (found in Supabase Dashboard → Project Settings → API) |
| `ENABLE_PORTAL` | ❌ | `false` | Set to `true` to mount the `/portal` self-service customer dashboard |
| `BUDGET_TIMEZONE` | ❌ | `Europe/Istanbul` | IANA timezone used for daily/monthly budget rollover boundaries |
| `CRON_SECRET` | ❌ | *(empty)* | Bearer secret for authenticating `/admin/api/cron/prices` and `/admin/api/cron/sessions` |
| `HOST` | ❌ | `127.0.0.1` | Bind address for Node.js server (`Dockerfile` & `docker-compose.yml` set `0.0.0.0`) |
| `PORT` | ❌ | `3000` | HTTP listen port for Node.js server |
| `ENABLE_MOCK_PROVIDERS` | ❌ | `false` | Routes `providerConfig.ts` helpers to `http://localhost:4000` when `true` |
| `ENABLE_MODERATION` | ❌ | `true` | Sends each prompt to OpenAI's Moderation API and flags `logs.is_flagged`. Set `false` to never send prompts to OpenAI for moderation (see [Privacy & Data Retention](#-privacy--data-retention)) |
| `LOG_PAYLOADS` | ❌ | `true` | Stores full prompt & response text in `logs.prompt` / `logs.response`. Set `false` to store only tokens, cost, latency and status |
| `TEST_PROXY_KEY` | ❌ | *(empty)* | Optional `sk-proxy-*` key used by local test scripts |
| `DEMO_LIMITED_KEY` | ❌ | *(empty)* | Optional rate-limited `sk-proxy-*` key for demo scenarios |

---

## 🛠️ Troubleshooting

| Status / Symptom | Cause | How to Fix |
|------------------|-------|------------|
| `401 Unauthorized` (`Missing or Invalid Token`) | Request is missing `Authorization: Bearer sk-proxy-...` header | Pass the key as a Bearer token: `-H "Authorization: Bearer sk-proxy-..."` |
| `401 Unauthorized` (`Key not found`) | The `sk-proxy-*` key does not exist in `client_keys` or was revoked (`is_active = false`) | Run `npm run key:create -- "My App"` or issue a new key in `/admin` |
| `403 Forbidden` (`Client is inactive`) | The parent organization in `clients` has `is_active = false` | Re-enable the client in `/admin` or update `clients.is_active = true` |
| `403 Forbidden` (`Origin not allowed`) | Client is configured as `browser-based` and request `Origin` is not in `allowed_domains` | Add your frontend domain to `allowed_domains` in `/admin` or set `client_type = 'server-based'` |
| `400 / 403 Model not allowed or not in catalog` | Requested model is inactive in `model_catalog`, not in client/user `allowed_models`, or exceeds `max_output_price` | Permit the model or raise the price ceiling in `/admin` → **Models / People**, or check `SELECT * FROM model_catalog;` |
| `400` `Model '<name>' is not available on this gateway` | The model is not an active row in `model_catalog` (a fresh DB only seeds `gpt-4o`, `gpt-4o-mini`, `claude-sonnet-4-20250514`, `claude-3-5-sonnet-latest`, `gemini-2.5-flash`) | Add it in `/admin` → **Models**, or `INSERT INTO model_catalog ...` (see [Send Your First Request](#7-send-your-first-request)). Custom `OPENAI_BASE_URL` models (Ollama/vLLM) must be added too |
| `403` `Model '<name>' is not enabled for your account` | The model is in the catalog but `openai/<model>` (etc.) is not in the client's `allowed_models` | Append `<provider>/<model>` to `clients.allowed_models`, or set a `max_output_price` ceiling the model fits under |
| `403` `Model '<name>' costs $X per 1M output tokens, above your limit` | Client has a `max_output_price` ceiling lower than the model's output price | Raise `max_output_price` or add the model explicitly to `allowed_models` |
| `429 Too Many Requests` | Client exceeded per-minute `rate_limit` or daily/monthly USD budget | Increase `rate_limit`, `daily_budget`, or `monthly_budget` for the client/user in `/admin` (budgets are only tracked when Redis is configured) |
| `500 Internal Edge Proxy Error` (`*_API_KEY was not found`) | Neither `VAULT_API_URL` nor the provider's `*_API_KEY` is configured | Set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` in `.env`, or start `ai-vault-server` |
| `Migration failed: ENOTFOUND` | `DATABASE_URL` points to an unreachable host or a paused Supabase Free Tier project | Resume your database in the Supabase dashboard, or switch `DATABASE_URL` to a local/Docker PostgreSQL instance |
| `Container port 3000 unreachable` | Server bound to `127.0.0.1` instead of `0.0.0.0` inside Docker | Ensure `HOST=0.0.0.0` is set (included by default in `Dockerfile` and `docker-compose.yml`) |
| `Long-running request timeout on Vercel` | Vercel Hobby plan enforces function execution timeouts (10s–60s) on slow reasoning models | Upgrade to Vercel Pro (up to 300s) or deploy via `Dockerfile` / `docker-compose.yml` for unrestricted connection durations |

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

# Vercel Deployment & Vault Handoff Guide

Bu belge, sistemi canlıya alacak olan DevOps / Vercel yöneticisi için hazırlanmıştır. Kurumsal güvenlik standartları gereği API şifreleri ana Gateway sunucusunda değil, izole bir Kasa (Vault) sunucusunda barındırılacaktır.

## 1. Vault Sunucusunun Canlıya Alınması (ai-vault-server)

Mevcut dizinin hemen yanındaki `ai-vault-server` klasörünü ayrı bir Git repository'si olarak Vercel, Render veya Railway'e deploy edin.

**Vault Sunucusu Ortam Değişkenleri (Environment Variables):**
Bu sunucuya aşağıdaki ortam değişkenlerini tanımlamalısınız:

*   `VAULT_ACCESS_TOKEN` = (Örn: `super-secret-vault-token-123`) -> *Bu token, Gateway'in kasaya erişmek için kullanacağı şifredir.*
*   `OPENAI_API_KEY` = `sk-proj-...`
*   `ANTHROPIC_API_KEY` = `sk-ant-...`
*   `GEMINI_API_KEY` = `AIzaSy-...`

Vault sunucusu deploy edildikten sonra URL'sini not edin (Örn: `https://ai-vault-server.vercel.app`).

## 2. Ana Gateway Sunucusunun Canlıya Alınması (ai-proxy-gateway)

Mevcut Gateway projesini (`ai-proxy-gateway`) Vercel'e (Edge Functions destekli şekilde) deploy edin. 

**Gateway Ortam Değişkenleri:**
Bu sunucuda **ASLA** OpenAI vb. şifreler bulunmayacaktır. Sadece veritabanı, Redis ve Kasa erişim bilgileri yer alacaktır:

*   `VAULT_API_URL` = `https://ai-vault-server.vercel.app` *(Bir önceki adımda aldığınız URL)*
*   `VAULT_ACCESS_TOKEN` = `super-secret-vault-token-123` *(Vault'a verdiğiniz aynı şifre)*
*   `UPSTASH_REDIS_REST_URL` = (Upstash Redis URL)
*   `UPSTASH_REDIS_REST_TOKEN` = (Upstash Redis Token)
*   `SUPABASE_URL` = (Supabase Proje URL)
*   `SUPABASE_SERVICE_KEY` = (Supabase Service Role Key)
*   `ADMIN_TOKEN` = (Admin paneline ilk girişte veya API ile erişimde kullanılacak şifre)
*   `SESSION_SECRET` = (Güvenli çerezler için rastgele 32+ karakterli bir metin)

## 3. Supabase Veritabanı Güncellemeleri (ÇOK ÖNEMLİ)

Canlı (Production) Supabase veritabanınızdaki SQL Editor'e girip aşağıdaki tabloları/sütunları eklediğinizden emin olun (Oturum özetleme ve Moderasyon özellikleri için yeniler):

```sql
-- 1. Sessions tablosu (Yapay zeka özetleri için)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES clients(id),
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  message_count INTEGER DEFAULT 0,
  summary TEXT,
  summary_tokens INTEGER,
  summary_cost DOUBLE PRECISION
);

-- 2. Logs tablosuna Moderasyon sütunlarının eklenmesi
ALTER TABLE logs ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT false;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS flagged_reason TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS session_id UUID;

-- 3. Clients tablosuna özetleme izninin eklenmesi
ALTER TABLE clients ADD COLUMN IF NOT EXISTS summary_enabled BOOLEAN DEFAULT false;
```

## 4. Ekstra Notlar
*   **Rate Limiting:** Sistem Edge üzerinde Upstash Redis kullanarak DDoS ve spam koruması sağlar.
*   **SWR Cache:** Gateway, şifreleri Vault'tan çekerken Stale-While-Revalidate (SWR) mimarisi kullanır. Yani Vault sunucusu 1 saniye yavaş yanıt verse bile, Gateway müşteriye 0 milisaniye (Edge) gecikmesiyle hizmet etmeye devam eder.

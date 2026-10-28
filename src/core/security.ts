// Güvenlik zinciri: kimlik -> domain -> hız limiti.
// Üç kontrol de B tarafının middleware'lerinden geliyor; bu dosya yalnızca
// sırayı, HTTP kodlarını ve client kaydından gelen verinin taşınmasını yönetiyor.

import { verifyClient } from '../middleware/authMiddleware.js';
import { checkDomainWhitelist } from '../middleware/domainWhitelister.js';
import { checkRateLimit } from '../middleware/rateLimiter.js';
import { supabase } from '../utils/supabaseClient.js';

interface ClientPolicy {
  clientType: 'browser-based' | 'server-based';
  allowedDomains: string[];
  allowedModels: string[];
  // Birim price tavanı (1000 token başına çıktı priceı). null ise sınır yok
  // ve yalnızca allowedModels geçerli — mevcut müşterilerin davranışı böyle
  // değişmeden kalıyor.
  maxOutputPrice: number | null;
}

async function resolveClientPolicy(clientRecord: Record<string, unknown>, clientId: string): Promise<ClientPolicy> {
  // verifyClient (IDatabase üzerinden) politika alanlarını doğrudan dönebiliyor;
  // böylece saf PostgreSQL, Docker veya özel veritabanı adaptörlerinde ek bir
  // Supabase sorgusuna gerek kalmıyor.
  if ('client_type' in clientRecord || 'allowed_domains' in clientRecord || 'allowed_models' in clientRecord) {
    return {
      clientType: (clientRecord.client_type as ClientPolicy['clientType']) ?? 'server-based',
      allowedDomains: (clientRecord.allowed_domains as string[] | null) ?? [],
      allowedModels: (clientRecord.allowed_models as string[] | null) ?? [],
      maxOutputPrice: (clientRecord.max_output_price as number | null) ?? null,
    };
  }

  if (!process.env.SUPABASE_URL) {
    return {
      clientType: 'server-based',
      allowedDomains: [],
      allowedModels: [],
      maxOutputPrice: null,
    };
  }

  const { data } = await supabase
    .from('clients')
    .select('client_type, allowed_domains, allowed_models, max_output_price')
    .eq('id', clientId)
    .single();

  return {
    clientType: (data?.client_type as ClientPolicy['clientType']) ?? 'server-based',
    allowedDomains: (data?.allowed_domains as string[] | null) ?? [],
    allowedModels: (data?.allowed_models as string[] | null) ?? [],
    maxOutputPrice: (data?.max_output_price as number | null) ?? null
  };
}

// Client başına hız limiti varsayılanı (client kaydında rate_limit varsa o kullanılır).
const DEFAULT_REQUESTS_PER_MINUTE = 60;

export type SecurityOutcome =
  | {
      ok: true; clientId: string; keyId: string | null;
      allowedModels: string[]; maxOutputPrice: number | null;
    }
  | { ok: false; status: number; error: string };

export async function runSecurityChain(options: {
  apiKey: string;
  origin: string | null;
}): Promise<SecurityOutcome> {
  // 1. Kimlik — key SHA-256'lanıp client_keys ile karşılaştırılır
  const auth = await verifyClient(options.apiKey);
  if (!auth.success || !auth.client) {
    return { ok: false, status: Number(auth.status ?? 401), error: String(auth.error ?? 'Unauthorized') };
  }

  const clientId = String(auth.client.id);
  const policy = await resolveClientPolicy(auth.client as Record<string, unknown>, clientId);

  // 2. Domain — yalnızca tarayıcı tabanlı client'lara uygulanır
  const domain = checkDomainWhitelist(policy.clientType, policy.allowedDomains, options.origin);
  if (!domain.success) {
    return { ok: false, status: Number(domain.status), error: String(domain.error) };
  }

  // 3. Hız limiti — Redis INCR + TTL
  const clientLimit = Number(auth.client.rate_limit) > 0 ? Number(auth.client.rate_limit) : DEFAULT_REQUESTS_PER_MINUTE;
  const rate = await checkRateLimit(clientId, clientLimit, 60);
  if (!rate.success) {
    return { ok: false, status: Number(rate.status), error: String(rate.error) };
  }

  // keyId kayda geçiyor: harcamayı key bazında kırabilmek için.
  return {
    ok: true,
    clientId,
    keyId: (auth as { keyId?: string }).keyId ?? null,
    allowedModels: policy.allowedModels,
    maxOutputPrice: policy.maxOutputPrice
  };
}

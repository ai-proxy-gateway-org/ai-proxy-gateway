// Güvenlik zinciri: kimlik -> domain -> hız limiti.
// Üç kontrol de B tarafının middleware'lerinden geliyor; bu dosya yalnızca
// sırayı, HTTP kodlarını ve client kaydından gelen verinin taşınmasını yönetiyor.

import { verifyClient } from '../middleware/authMiddleware.js';
import { checkDomainWhitelist } from '../middleware/domainWhitelister.js';
import { checkRateLimit } from '../middleware/rateLimiter.js';
import { supabase } from '../services/db.js';

// GEÇİCİ: verifyClient şu an clients tablosundan yalnızca (id, name, is_active)
// seçiyor; client_type, allowed_domains ve allowed_models kolonları sorguya dahil
// değil. O select genişletildiğinde bu ek sorgu tamamen kalkacak ve veriler
// doğrudan verifyClient'ın döndürdüğü kayıttan okunacak.
interface ClientPolicy {
  clientType: 'browser-based' | 'server-based';
  allowedDomains: string[];
  allowedModels: string[];
  // Birim fiyat tavanı (1000 token başına çıktı fiyatı). null ise sınır yok
  // ve yalnızca allowedModels geçerli — mevcut müşterilerin davranışı böyle
  // değişmeden kalıyor.
  maxOutputPrice: number | null;
}

async function fetchClientPolicy(clientId: string): Promise<ClientPolicy> {
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

// Client başına hız limiti şemada tutulmuyor; tüm client'lar için aynı varsayılan
// uygulanıyor. wf-ortak §4 dakika/saat/gün seviyelerinde istemci bazlı limit
// istiyor — bunun için clients tablosuna limit kolonları eklenmesi gerekiyor.
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
  // 1. Kimlik — anahtar SHA-256'lanıp client_keys ile karşılaştırılır
  const auth = await verifyClient(options.apiKey);
  if (!auth.success || !auth.client) {
    return { ok: false, status: Number(auth.status ?? 401), error: String(auth.error ?? 'Unauthorized') };
  }

  const clientId = String(auth.client.id);
  const policy = await fetchClientPolicy(clientId);

  // 2. Domain — yalnızca tarayıcı tabanlı client'lara uygulanır
  const domain = checkDomainWhitelist(policy.clientType, policy.allowedDomains, options.origin);
  if (!domain.success) {
    return { ok: false, status: Number(domain.status), error: String(domain.error) };
  }

  // 3. Hız limiti — Redis INCR + TTL
  const rate = await checkRateLimit(clientId, DEFAULT_REQUESTS_PER_MINUTE, 60);
  if (!rate.success) {
    return { ok: false, status: Number(rate.status), error: String(rate.error) };
  }

  // keyId kayda geçiyor: harcamayı anahtar bazında kırabilmek için.
  return {
    ok: true,
    clientId,
    keyId: (auth as { keyId?: string }).keyId ?? null,
    allowedModels: policy.allowedModels,
    maxOutputPrice: policy.maxOutputPrice
  };
}

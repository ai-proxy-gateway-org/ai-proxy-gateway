// Güvenlik zinciri: kimlik -> domain -> hız limiti.
// Üç kontrol de B tarafının middleware'lerinden geliyor; bu dosya yalnızca
// sırayı, HTTP kodlarını ve client kaydından gelen verinin taşınmasını yönetiyor.

import { verifyClient } from '../middleware/authMiddleware.js';
import { checkDomainWhitelist } from '../middleware/domainWhitelister.js';
import { checkRateLimit } from '../middleware/rateLimiter.js';
import { supabase } from '../services/db.js';
import { butceKontrol } from './butce.js';

// GEÇİCİ: verifyClient şu an clients tablosundan yalnızca (id, name, is_active)
// seçiyor; client_type, allowed_domains ve allowed_models kolonları sorguya dahil
// değil. O select genişletildiğinde bu ek sorgu tamamen kalkacak ve veriler
// doğrudan verifyClient'ın döndürdüğü kayıttan okunacak.
interface ClientPolicy {
  clientType: 'browser-based' | 'server-based';
  allowedDomains: string[];
  allowedModels: string[];
  aylikButce: number | null;
  gunlukButce: number | null;
  // Birim fiyat tavanı (1000 token başına çıktı fiyatı). null ise sınır yok
  // ve yalnızca allowedModels geçerli — mevcut müşterilerin davranışı böyle
  // değişmeden kalıyor.
  maxOutputPrice: number | null;
}

// Anahtarın sahibinin izinleri.
//
// Servis şirket içinde kullanılıyor: yönetilen şey kişiler, "kim hangi modeli
// kullanabilir" kişiye göre değişiyor. Ağ geçidi kişiyi göremiyor ama
// anahtarı görüyor; anahtar bir kişiye aitse o kişinin izinleri uygulanıyor.
//
// Sahibi olmayan anahtarlar ortak servis anahtarı: onlarda şirket izni
// geçerli, çünkü arkasında belirli bir kişi yok.
//
// Şirket izni her durumda ÜST SINIR: kişiye şirketin açmadığı bir model
// açılamıyor, şirket tavanının üstüne çıkılamıyor. Aksi halde kişi bazında
// izin vermek, şirket politikasını delmenin yolu olurdu.
async function fetchKeyOwnerPolicy(keyId: string | null): Promise<{
  userId: string;
  allowedModels: string[]; maxOutputPrice: number | null;
  aylikButce: number | null; gunlukButce: number | null;
} | null> {
  if (!keyId) return null;

  const { data: anahtar } = await supabase
    .from('client_keys').select('user_id').eq('id', keyId).limit(1);
  const sahip = ((anahtar ?? [])[0] as { user_id: string | null } | undefined)?.user_id;
  if (!sahip) return null;

  const { data, error } = await supabase
    .from('users')
    .select('allowed_models, max_output_price, monthly_budget, daily_budget')
    .eq('id', sahip).limit(1);

  // Sütunlar sonradan eklendi; göç çalıştırılmamışsa kişi bazlı izin yok
  // sayılıyor ve şirket izni geçerli kalıyor.
  if (error) return null;

  const u = (data ?? [])[0] as {
    allowed_models: string[] | null; max_output_price: number | null;
    monthly_budget: number | null; daily_budget: number | null;
  } | undefined;
  if (!u) return null;

  return {
    userId: sahip,
    allowedModels: u.allowed_models ?? [],
    maxOutputPrice: u.max_output_price ?? null,
    aylikButce: u.monthly_budget ?? null,
    gunlukButce: u.daily_budget ?? null
  };
}

async function fetchClientPolicy(clientId: string): Promise<ClientPolicy> {
  const { data } = await supabase
    .from('clients')
    .select('client_type, allowed_domains, allowed_models, max_output_price, monthly_budget, daily_budget')
    .eq('id', clientId)
    .single();

  return {
    clientType: (data?.client_type as ClientPolicy['clientType']) ?? 'server-based',
    allowedDomains: (data?.allowed_domains as string[] | null) ?? [],
    allowedModels: (data?.allowed_models as string[] | null) ?? [],
    maxOutputPrice: (data?.max_output_price as number | null) ?? null,
    aylikButce: (data?.monthly_budget as number | null) ?? null,
    gunlukButce: (data?.daily_budget as number | null) ?? null
  };
}

// Client başına hız limiti şemada tutulmuyor; tüm client'lar için aynı varsayılan
// uygulanıyor. wf-ortak §4 dakika/saat/gün seviyelerinde istemci bazlı limit
// istiyor — bunun için clients tablosuna limit kolonları eklenmesi gerekiyor.
const DEFAULT_REQUESTS_PER_MINUTE = 60;

export type SecurityOutcome =
  | {
      ok: true; clientId: string; keyId: string | null; userId: string | null;
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

  // 4. Kişi bazlı izinler. Anahtarın sahibi varsa onun istisna listesi,
  //    sahipsiz (ortak) anahtarlarda şirketinki.
  //
  // Kesişim kaldırıldı. Önce kişinin listesi şirketinkiyle kesiştiriliyordu
  // ve bu üçüncü bir kapı yaratıyordu: modelin katalogda aktif olması,
  // şirket listesinde olması, kişide işaretli olması. Ortadaki katman hiçbir
  // şey eklemiyordu — modeli tamamen kapatmak Models sekmesindeki aktiflik
  // bayrağıyla zaten yapılıyor — ama sessiz hataya yol açıyordu: kişiye
  // işaretlenen model şirket listesinde yoksa erişim verilmiyor, panelde ise
  // verilmiş görünüyordu.
  //
  // Artık iki kapı var: model aktif mi, bu kişi kullanabilir mi.
  const keyId = (auth as { keyId?: string }).keyId ?? null;
  const sahipPolitikasi = await fetchKeyOwnerPolicy(keyId);

  const etkinModeller = sahipPolitikasi
    ? sahipPolitikasi.allowedModels
    : policy.allowedModels;

  const etkinTavan = (() => {
    const kisi = sahipPolitikasi?.maxOutputPrice ?? null;
    const sirket = policy.maxOutputPrice;
    if (kisi === null) return sirket;
    if (sirket === null) return kisi;
    // İkisi de varsa düşük olan geçerli.
    return Math.min(kisi, sirket);
  })();

  // keyId kayda geçiyor: harcamayı anahtar bazında kırabilmek için.
  // 5. Bütçe. Fiyat tavanı hangi modelin kullanılacağını sınırlıyor, bu ise
  //    ne kadar harcanacağını. Kişi ve şirket sınırları birlikte bakılıyor;
  //    hangisi önce dolarsa istek orada duruyor.
  const butce = await butceKontrol(
    sahipPolitikasi?.userId ?? null,
    clientId,
    {
      aylik: sahipPolitikasi?.aylikButce ?? null,
      gunluk: sahipPolitikasi?.gunlukButce ?? null
    },
    { aylik: policy.aylikButce, gunluk: policy.gunlukButce }
  );
  if (!butce.ok) {
    // 429: kaynak tükendi, sonra tekrar denenebilir. Günlük limitte ertesi
    // gün, aylıkta yönetici artırınca.
    return { ok: false, status: 429, error: butce.sebep };
  }

  return {
    ok: true,
    clientId,
    keyId,
    userId: sahipPolitikasi?.userId ?? null,
    allowedModels: etkinModeller,
    maxOutputPrice: etkinTavan
  };
}

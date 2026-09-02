// Model erişim kontrolü iki katmanlı çalışır:
//
//   1. KATALOG  — Model sistemde tanımlı mı? Kaynağı model_catalog tablosu.
//                 Fiyatı olmayan model hiç geçmez; aksi halde maliyet sessizce 0 yazılır.
//   2. YETKİ    — BU client BU modeli kullanabilir mi? Kaynağı clients.allowed_models.
//
// İkisinin ayrı olması önemli: katalogdaki her modeli herkese açsaydık bu fiilen
// wildcard erişim olurdu, wf-ortak §4 bunu açıkça yasaklıyor ("wildcard (*) erişimi
// kullanılmaz; böylece yeni ve pahalı modellere kontrolsüz erişim engellenir").
//
// allowed_models biçimi: "provider/model" (örn. "anthropic/claude-3-5-sonnet").
// katalog anahtarlarıyla aynı düzen — aynı model adı iki sağlayıcıda
// bulunabileceği için yalnız model adı belirsiz kalırdı.

import { isKnownModel, modelKey, priceFor } from './modelCatalog.js';
import type { ProviderName } from './providerConfig.js';

export type AuthorizationResult = { ok: true } | { ok: false; status: number; error: string };

// Yetki listesi parametre olarak alınıyor: güvenlik zinciri client kaydını zaten
// okuduğu için ikinci bir veritabanı turu gerekmiyor.
// Katalog artık veritabanından geldiği için async. Önbellekten okunduğunda
// beklemesiz döner; yalnızca 10 dakikada bir gerçek sorgu yapılır.
// FİYAT TAVANI
//
// İzin listesi tek başına bir darboğaz: müşteri ucuz bir modele geçmek istese
// bile yöneticinin kutucuğu işaretlemesini bekliyor. Yeni bir model
// çıktığında da kimse izin vermeden kullanılamıyor.
//
// Fiyat tavanı bunu tersine çeviriyor: müşteriye birim fiyat sınırı konuyor,
// o sınırın altındaki her model onaysız geçiyor, üstündekiler kapalı kalıyor.
// Yeni model ucuzsa kendiliğinden kullanılabilir, pahalıysa kendiliğinden
// kapalı — kimsenin bir şey yapması gerekmiyor.
//
// Çıktı fiyatı üzerinden ölçülüyor: modeller arasındaki fark orada
// belirginleşiyor (gpt-4o $0.010 · claude-opus-4 $0.075 / 1K) ve fatura
// ağırlığı da çıktıdan geliyor.
//
// allowed_models kalkmıyor, İSTİSNA LİSTESİ oluyor: tavanın üstünde ama bu
// müşteriye özel açılmış modeller orada duruyor.
export async function authorizeModel(
  provider: ProviderName,
  model: string,
  allowedModels: string[],
  maxOutputPrice?: number | null
): Promise<AuthorizationResult> {
  // Ret mesajları müşteriye ne yapması gerektiğini söylüyor.
  //
  // Önceden yalnızca kapıyı kapatıyorlardı ("not authorized"). Oysa her ret
  // yönetici panelinde talep olarak görünüyor: müşterinin bize ayrıca yazmasına
  // gerek yok. Bunu söylemezsek ya vazgeçiyor ya da gereksiz yere mesaj atıyor.
  if (!(await isKnownModel(provider, model))) {
    return {
      ok: false,
      status: 400,
      error:
        `Model '${model}' is not available on this gateway. ` +
        `Your request has been recorded and will be reviewed by an administrator.`
    };
  }

  if (allowedModels.includes(modelKey(provider, model))) return { ok: true };

  // İzin listesinde yok — tavanın altında mı?
  if (typeof maxOutputPrice === 'number' && maxOutputPrice > 0) {
    const fiyat = await priceFor(provider, model);

    // Fiyatı bilinmeyen model tavana göre değerlendirilemez; kapalı kalıyor.
    // "Bilmiyorsak geçir" demek, pahalı bir modelin fiyatı girilmediği için
    // açılması demekti.
    if (fiyat && fiyat.output <= maxOutputPrice) return { ok: true };

    if (fiyat) {
      return {
        ok: false,
        status: 403,
        error:
          `Model '${model}' costs $${(fiyat.output * 1000).toFixed(2)} per 1M output tokens, ` +
          `above your limit of $${(maxOutputPrice * 1000).toFixed(2)}. ` +
          `Your request has been recorded and is awaiting review.`
      };
    }
  }

  return {
    ok: false,
    status: 403,
    error:
      `Model '${model}' is not enabled for your account. ` +
      `Your request has been recorded and is awaiting review.`
  };
}

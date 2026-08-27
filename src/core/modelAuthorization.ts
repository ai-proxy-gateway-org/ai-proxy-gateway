// Model erişim kontrolü iki katmanlı çalışır:
//
//   1. KATALOG  — Model sistemde tanımlı mı? Kaynağı model_pricing.json.
//                 Fiyatı olmayan model hiç geçmez; aksi halde maliyet sessizce 0 yazılır.
//   2. YETKİ    — BU client BU modeli kullanabilir mi? Kaynağı clients.allowed_models.
//
// İkisinin ayrı olması önemli: katalogdaki her modeli herkese açsaydık bu fiilen
// wildcard erişim olurdu, wf-ortak §4 bunu açıkça yasaklıyor ("wildcard (*) erişimi
// kullanılmaz; böylece yeni ve pahalı modellere kontrolsüz erişim engellenir").
//
// allowed_models biçimi: "provider/model" (örn. "anthropic/claude-3-5-sonnet").
// model_pricing.json anahtarlarıyla aynı düzen — aynı model adı iki sağlayıcıda
// bulunabileceği için yalnız model adı belirsiz kalırdı.

import { isKnownModel, modelKey } from './modelCatalog.js';
import type { ProviderName } from './providerConfig.js';

export type AuthorizationResult = { ok: true } | { ok: false; status: number; error: string };

// Yetki listesi parametre olarak alınıyor: güvenlik zinciri client kaydını zaten
// okuduğu için ikinci bir veritabanı turu gerekmiyor.
export function authorizeModel(
  provider: ProviderName,
  model: string,
  allowedModels: string[]
): AuthorizationResult {
  if (!isKnownModel(provider, model)) {
    return {
      ok: false,
      status: 400,
      error: `Model '${model}' is not defined for provider '${provider}'.`
    };
  }

  if (!allowedModels.includes(modelKey(provider, model))) {
    return {
      ok: false,
      status: 403,
      error: `You are not authorized to use model '${model}'.`
    };
  }

  return { ok: true };
}

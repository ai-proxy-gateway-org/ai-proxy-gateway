// Sistemin tanıdığı model kataloğu.
//
// Umur'un `src/model_pricing.json` dosyası tek doğruluk kaynağı: oraya bir model
// eklendiğinde burada ayrıca bir şey değiştirmek gerekmiyor. Anahtar biçimi
// `provider/model` (örn. "anthropic/claude-3-5-sonnet") — maliyet hesabında
// kullanılan biçimin aynısı, böylece fiyatı olmayan bir model sisteme hiç giremiyor
// ve maliyet sessizce 0 yazılmıyor.
//
// Dosya henüz bu branch'te yok (Umur'un tarafında, main'de). O yüzden çalışma anında
// okunuyor ve bulunamazsa aynı isimlere sahip bir yedek listeye düşülüyor —
// main ile birleşince otomatik olarak gerçek dosyaya geçer.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

interface PricingEntry {
  input: number;
  output: number;
}

const FALLBACK_MODEL_KEYS = [
  'openai/gpt-4o',
  'gemini/gemini-1.5-pro',
  'anthropic/claude-3-5-sonnet'
];

let knownModelKeys: Set<string>;
let modelPrices: Record<string, PricingEntry>;
let catalogSource: 'model_pricing.json' | 'fallback';

function loadCatalog(): void {
  try {
    const pricingPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'model_pricing.json');
    const parsed = JSON.parse(readFileSync(pricingPath, 'utf8')) as Record<string, PricingEntry>;
    const keys = Object.keys(parsed);
    if (keys.length === 0) throw new Error('Katalog boş');
    knownModelKeys = new Set(keys);
    modelPrices = parsed;
    catalogSource = 'model_pricing.json';
  } catch {
    knownModelKeys = new Set(FALLBACK_MODEL_KEYS);
    modelPrices = {};
    catalogSource = 'fallback';
  }
}

loadCatalog();

export function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export function isKnownModel(provider: string, model: string): boolean {
  return knownModelKeys.has(modelKey(provider, model));
}

export function knownModels(): string[] {
  return [...knownModelKeys];
}

/**
 * Model fiyatları. 1000 token başına dolar — logger.ts ile aynı birim.
 * Arayüzde maliyet hesabını gösterip doğrulayabilmek için dışarı açıldı.
 */
export function priceList(): Record<string, PricingEntry> {
  return modelPrices;
}

export function catalogInfo(): { source: string; modelCount: number } {
  return { source: catalogSource, modelCount: knownModelKeys.size };
}

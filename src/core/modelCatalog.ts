// Sistemin tanıdığı model kataloğu ve pricesı.
//
// Kaynak: Supabase'deki `model_catalog` tablosu. Önceden `model_pricing.json`
// dosyasıydı; dosya dağıtım paketine gömülü olduğu için yeni model eklemek
// kod değişikliği + dağıtım gerektiriyordu. Tabloya taşınınca panelden
// yönetilebilir hale geldi.
//
// Üç koruma var:
//   1. Katalog bellekte 10 dakika tutuluyor — her istekte veritabanına gidilmiyor.
//   2. Veritabanı okunamazsa eldeki liste kullanılmaya devam ediyor; katalog
//      okunamadı diye request reddedilmiyor.
//   3. Hiç okunamamışsa `model_pricing.json` yedek olarak devreye giriyor.
//      Dosya silinmedi: ilk açılış tohumu ve acil status yedeği.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supabase } from '../utils/supabaseClient.js';

export interface PricingEntry {
  input: number;
  output: number;
}

interface Katalog {
  keys: Set<string>;
  prices: Record<string, PricingEntry>;
  kaynak: 'model_catalog' | 'model_pricing.json' | 'fallback';
  yuklenme: number;
}

const TAZELEME_MS = 10 * 60 * 1000;

const YEDEK_ANAHTARLAR = [
  'openai/gpt-4o',
  'gemini/gemini-1.5-pro',
  'anthropic/claude-3-5-sonnet'
];

let katalog: Katalog | null = null;
let yuklemeSurmekte: Promise<Katalog> | null = null;

/** Dosyadan okur — yalnızca veritabanı hiç okunamadığında kullanılıyor. */
function dosyadanOku(): Katalog {
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'model_pricing.json');
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, PricingEntry>;
    const keys = Object.keys(parsed);
    if (keys.length === 0) throw new Error('Katalog boş');
    return {
      keys: new Set(keys),
      prices: parsed,
      kaynak: 'model_pricing.json',
      yuklenme: Date.now()
    };
  } catch {
    return {
      keys: new Set(YEDEK_ANAHTARLAR),
      prices: {},
      kaynak: 'fallback',
      yuklenme: Date.now()
    };
  }
}

async function veritabanindanOku(): Promise<Katalog> {
  const { data, error } = await supabase
    .from('model_catalog')
    .select('provider, model, input_price, output_price')
    .eq('is_active', true);

  if (error) throw new Error(error.message);

  const satirlar = (data ?? []) as Array<{
    provider: string; model: string;
    input_price: number | null; output_price: number | null;
  }>;
  if (satirlar.length === 0) throw new Error('Katalog tablosu boş');

  const prices: Record<string, PricingEntry> = {};
  for (const s of satirlar) {
    // Fiyatı tanımlanmamış model katalogda sayılır ama maliyeti hesaplanamaz.
    if (s.input_price === null || s.output_price === null) continue;
    prices[`${s.provider}/${s.model}`] = {
      input: Number(s.input_price),
      output: Number(s.output_price)
    };
  }

  return {
    keys: new Set(satirlar.map((s) => `${s.provider}/${s.model}`)),
    prices,
    kaynak: 'model_catalog',
    yuklenme: Date.now()
  };
}

/**
 * Güncel kataloğu döner. Süresi dolmamışsa bellekten, dolmuşsa tazeler.
 * Tazeleme başarısızsa eldeki katalogla devam edilir.
 */
export async function getCatalog(): Promise<Katalog> {
  const taze = katalog && Date.now() - katalog.yuklenme < TAZELEME_MS;
  if (taze) return katalog as Katalog;

  // Aynı anda gelen isteklerin hepsi ayrı sorgu açmasın.
  if (!yuklemeSurmekte) {
    yuklemeSurmekte = veritabanindanOku()
      .then((yeni) => {
        katalog = yeni;
        return yeni;
      })
      .catch(() => {
        // Elde bir katalog varsa onunla devam; yoksa dosyaya düş.
        katalog = katalog ?? dosyadanOku();
        katalog.yuklenme = Date.now();
        return katalog;
      })
      .finally(() => {
        yuklemeSurmekte = null;
      });
  }
  return yuklemeSurmekte;
}

// Önbelleği düşürür. Yönetici panelinden model eklendiğinde ya da priceı
// değiştiğinde çağrılıyor: aksi halde değişiklik 10 dakikaya kadar geç etki eder
// ve "yeni modeli aktive etme" akışı çalışmaz.
//
// Sonraki getCatalog() çağrısı veritabanına gidip yeniden yükler.
export function invalidateCatalog(): void {
  katalog = null;
  yuklemeSurmekte = null;
}

export function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export async function isKnownModel(provider: string, model: string): Promise<boolean> {
  const k = await getCatalog();
  return k.keys.has(modelKey(provider, model));
}

/** Maliyet hesabı için price. Fiyatı tanımlanmamış modelde null döner. */
export async function priceFor(provider: string, model: string): Promise<PricingEntry | null> {
  const k = await getCatalog();
  return k.prices[modelKey(provider, model)] ?? null;
}

export async function priceList(): Promise<Record<string, PricingEntry>> {
  return (await getCatalog()).prices;
}

export async function knownModels(): Promise<string[]> {
  return [...(await getCatalog()).keys];
}

export async function catalogInfo(): Promise<{ source: string; modelCount: number; ageSeconds: number }> {
  const k = await getCatalog();
  return {
    source: k.kaynak,
    modelCount: k.keys.size,
    ageSeconds: Math.round((Date.now() - k.yuklenme) / 1000)
  };
}

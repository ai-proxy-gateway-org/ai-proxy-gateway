// Harcama bütçesi.
//
// Fiyat tavanı HANGİ modelin kullanılabileceğini sınırlıyor, NE KADAR
// harcanacağını değil: ucuz bir modelle çok request atan biri yine bütçeyi
// bitirebiliyor. Üç ayrı soru, üç ayrı mekanizma — price tavanı, bütçe,
// hız limiti.
//
// Sayaç Redis'te tutuluyor, veritabanında değil. Her istekte logs üzerinden
// toplam almak bir toplama sorgusu demek; sayaç okuması milisaniyelik.
// Gerçek kaynak yine veritabanı: sayaç bozulursa logs'tan yeniden
// hesaplanabiliyor.
//
// Bilinen kusur: cost ancak cevap geldikten sonra biliniyor. Limit dolmak
// üzereyken gelen bir request limiti birkaç sent aşabilir. Kesinlik için her
// isteği kilitlemek gerekirdi, o da her isteğe gecikme eklerdi.

import { Redis } from '@upstash/redis';
import { supabase } from '../utils/supabaseClient.js';

const redis = Redis.fromEnv();

// Aylık sayaç 40 gün, günlük 48 saat yaşıyor: dönem bittikten sonra
// kendiliğinden düşüyor, temizlik işi kalmıyor.
const AY_TTL = 40 * 24 * 60 * 60;
const GUN_TTL = 48 * 60 * 60;

// Dönem sınırları yerel saate göre.
//
// UTC kullanıldığında Türkiye'de gün sabah 03:00'te dönüyordu: gece 01:00'de
// atılan request bir önceki güne sayılıyordu. Saat dilimi ayarlanabilir çünkü
// proje açık kaynak olacak; başka ülkede kuran kendi saatini ister.
const SAAT_DILIMI = process.env.BUDGET_TIMEZONE || 'Europe/Istanbul';

// Verilen saat diliminde "yıl-month-gün" üretir. Intl kullanılıyor: yaz saati
// geçişlerini ve timezone kurallarını elle hesaplamak hataya açık.
function yerelTarih(now: Date): { yil: number; month: number; day: number } {
  const parcalar = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAAT_DILIMI,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);

  const al = (tip: string) => Number(parcalar.find((p) => p.type === tip)?.value ?? 0);
  return { yil: al('year'), month: al('month'), day: al('day') };
}

function donemler(now = new Date()) {
  const t = yerelTarih(now);
  const iki = (x: number) => String(x).padStart(2, '0');
  return {
    month: `${t.yil}-${iki(t.month)}`,
    day: `${t.yil}-${iki(t.month)}-${iki(t.day)}`
  };
}

// Bir anın hedef saat dilimindeki ofseti (yaz saati dahil, o ana ait).
function ofsetMs(an: Date): number {
  const yerel = new Date(an.toLocaleString('en-US', { timeZone: SAAT_DILIMI }));
  const utc = new Date(an.toLocaleString('en-US', { timeZone: 'UTC' }));
  return yerel.getTime() - utc.getTime();
}

// Dönemin başladığı anı UTC olarak verir — logs sorgusu bunu istiyor.
//
// Ofset dönemin BAŞINDA ölçülüyor, şu anda değil. Aylık dönemde bu fark
// ediyor: monthın 1'i kış saatinde, bugün yaz saatinde olabilir. Ofseti bugüne
// göre alsaydık month başı bir saat kayardı.
//
// İki tur: ilk turda duvar saatini UTC sanıp kaba bir an buluyoruz, ikinci
// turda ofseti o ana göre yeniden ölçüp düzeltiyoruz. Yaz saati geçişi tam
// gece yarısında olmadığı sürece iki tur yeter.
function yerelGunBasiUTC(now: Date, ayinBasi: boolean): string {
  const t = yerelTarih(now);
  const day = ayinBasi ? 1 : t.day;
  const duvar = Date.UTC(t.yil, t.month - 1, day, 0, 0, 0);

  let an = duvar;
  for (let tur = 0; tur < 2; tur++) an = duvar - ofsetMs(new Date(an));

  return new Date(an).toISOString();
}

function keys(kimlik: string) {
  const { month, day } = donemler();
  return {
    aylik: `spend:${kimlik}:${month}`,
    gunluk: `spend:${kimlik}:${day}`
  };
}

export interface BudgetLimits {
  aylik: number | null;
  gunluk: number | null;
}

export interface BudgetStatus {
  aylikHarcama: number;
  gunlukHarcama: number;
  aylikSinir: number | null;
  gunlukSinir: number | null;
  exceeded: 'aylik' | 'gunluk' | null;
}

export type BudgetType = 'user' | 'client';

// Dönemin harcamasını KAYITLARDAN hesaplar.
//
// Sayaç Redis'te ama gerçek kaynak logs tablosu. Sayaç yeni açıldığında
// (özellik ilk kez devreye inputğinde, dönem değiştiğinde ya da Redis
// temizlendiğinde) boş oluyor; o durumda kayıtlardan hesaplanıp sayaç
// dolduruluyor. Aksi halde "19 request var ama harcama sıfır" gibi bir
// tutarsızlık çıkıyordu: request sayısı kayıtlardan, harcama sayaçtan
// geliyordu ve ikisi farklı zamanları gösteriyordu.
async function kayitlardanHesapla(
  kimlik: string, tur: BudgetType, baslangicISO: string
): Promise<number> {
  try {
    let anahtarKimlikleri: string[] | null = null;

    if (tur === 'user') {
      const { data } = await supabase
        .from('client_keys').select('id').eq('user_id', kimlik);
      anahtarKimlikleri = ((data ?? []) as Array<{ id: string }>).map((x) => x.id);
      // Anahtarı olmayan kişinin harcaması da yok.
      if (!anahtarKimlikleri.length) return 0;
    }

    let sorgu = supabase
      .from('logs').select('cost').gte('created_at', baslangicISO).limit(10000) as any;
    sorgu = tur === 'user'
      ? sorgu.in('key_id', anahtarKimlikleri)
      : sorgu.eq('client_id', kimlik);

    const { data, error } = await sorgu;
    if (error) return 0;

    return ((data ?? []) as Array<{ cost: number | null }>)
      .reduce((t, k) => t + Number(k.cost ?? 0), 0);
  } catch {
    return 0;
  }
}

function donemBaslangici(): { month: string; day: string } {
  const now = new Date();
  return {
    month: yerelGunBasiUTC(now, true),
    day: yerelGunBasiUTC(now, false)
  };
}

// Ekranda "ne zaman sıfırlanıyor" yazabilmek için: hangi timezone, hangi dönem,
// dönemler hangi anda başladı.
export function getBudgetPeriod(now = new Date()) {
  const { month, day } = donemler(now);
  return {
    timezone: SAAT_DILIMI,
    month, day,
    ayBasi: yerelGunBasiUTC(now, true),
    gunBasi: yerelGunBasiUTC(now, false)
  };
}

async function oku(kimlik: string, tur: BudgetType): Promise<{ month: number; day: number }> {
  const a = keys(kimlik);
  const [ayHam, gunHam] = await redis.mget<(string | number | null)[]>(a.aylik, a.gunluk);

  // Sayaç hiç açılmamışsa kayıtlardan doldur. null ile 0 farkı önemli:
  // 0 "bu dönemde harcama yok" demek, null "sayaç yok" demek.
  const headers = donemBaslangici();
  let month = ayHam === null || ayHam === undefined ? null : Number(ayHam);
  let day = gunHam === null || gunHam === undefined ? null : Number(gunHam);

  if (month === null) {
    month = await kayitlardanHesapla(kimlik, tur, headers.month);
    if (month > 0) {
      await redis.set(a.aylik, month, { ex: AY_TTL });
    }
  }
  if (day === null) {
    day = await kayitlardanHesapla(kimlik, tur, headers.day);
    if (day > 0) {
      await redis.set(a.gunluk, day, { ex: GUN_TTL });
    }
  }

  return { month, day };
}

// Harcamayı sayaca ekliyor. İstek tamamlandıktan sonra çağrılıyor, çünkü
// cost ancak o zaman biliniyor.
export async function addSpend(kimlikler: Array<string | null>, amount: number): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  try {
    for (const kimlik of kimlikler) {
      if (!kimlik) continue;
      const a = keys(kimlik);
      const [yeniAy, yeniGun] = await Promise.all([
        redis.incrbyfloat(a.aylik, amount),
        redis.incrbyfloat(a.gunluk, amount)
      ]);
      // TTL yalnızca sayaç yeni açıldığında konuyor; her istekte expire
      // çağırmak süreyi sürekli ileri iterdi ve dönem hiç kapanmazdı.
      if (Number(yeniAy) === amount) await redis.expire(a.aylik, AY_TTL);
      if (Number(yeniGun) === amount) await redis.expire(a.gunluk, GUN_TTL);
    }
  } catch (error) {
    // Sayaç yazılamazsa request engellenmiyor: bütçe takibi kaybolur ama
    // servis çalışmaya devam eder. Aksi halde Redis kesintisi bütün
    // trafiği durdururdu.
    console.error('Bütçe counterı yazılamadı:', error);
  }
}

export async function getBudgetStatus(
  kimlik: string,
  sinirlar: BudgetLimits,
  tur: BudgetType = 'user'
): Promise<BudgetStatus> {
  const { month, day } = await oku(kimlik, tur);
  const exceeded =
    sinirlar.gunluk !== null && day >= sinirlar.gunluk ? 'gunluk'
    : sinirlar.aylik !== null && month >= sinirlar.aylik ? 'aylik'
    : null;

  return {
    aylikHarcama: month,
    gunlukHarcama: day,
    aylikSinir: sinirlar.aylik,
    gunlukSinir: sinirlar.gunluk,
    exceeded
  };
}

// Kişi ve şirket sınırları birlikte değerlendiriliyor: hangisi önce dolarsa
// request orada duruyor.
export async function checkBudget(
  kisiId: string | null,
  clientId: string,
  kisiSinir: BudgetLimits,
  sirketSinir: BudgetLimits
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    if (kisiId) {
      const d = await getBudgetStatus(kisiId, kisiSinir, 'user');
      if (d.exceeded === 'gunluk') {
        return {
          ok: false,
          reason: `Daily spending limit reached ($${(d.gunlukSinir ?? 0).toFixed(2)}). ` +
                 `Requests resume tomorrow, or ask an administrator to raise it.`
        };
      }
      if (d.exceeded === 'aylik') {
        return {
          ok: false,
          reason: `Monthly spending limit reached ($${(d.aylikSinir ?? 0).toFixed(2)}). ` +
                 `Ask an administrator to raise it.`
        };
      }
    }

    const s = await getBudgetStatus(clientId, sirketSinir, 'client');
    if (s.exceeded === 'gunluk') {
      return {
        ok: false,
        reason: `The company hit its daily spending limit ($${(s.gunlukSinir ?? 0).toFixed(2)}). ` +
               `Requests resume tomorrow.`
      };
    }
    if (s.exceeded === 'aylik') {
      return {
        ok: false,
        reason: `The company hit its monthly spending limit ($${(s.aylikSinir ?? 0).toFixed(2)}).`
      };
    }

    return { ok: true };
  } catch (error) {
    // Sayaç okunamazsa isteği geçiriyoruz: hız limitiyle aynı yaklaşım.
    // Redis kesintisinin bütün trafiği durdurması, bütçenin birkaç dakika
    // takip edilememesinden daha kötü.
    console.error('Bütçe okunamadı:', error);
    return { ok: true };
  }
}

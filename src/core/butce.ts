// Harcama bütçesi.
//
// Fiyat tavanı HANGİ modelin kullanılabileceğini sınırlıyor, NE KADAR
// harcanacağını değil: ucuz bir modelle çok istek atan biri yine bütçeyi
// bitirebiliyor. Üç ayrı soru, üç ayrı mekanizma — fiyat tavanı, bütçe,
// hız limiti.
//
// Sayaç Redis'te tutuluyor, veritabanında değil. Her istekte logs üzerinden
// toplam almak bir toplama sorgusu demek; sayaç okuması milisaniyelik.
// Gerçek kaynak yine veritabanı: sayaç bozulursa logs'tan yeniden
// hesaplanabiliyor.
//
// Bilinen kusur: maliyet ancak cevap geldikten sonra biliniyor. Limit dolmak
// üzereyken gelen bir istek limiti birkaç sent aşabilir. Kesinlik için her
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
// atılan istek bir önceki güne sayılıyordu. Saat dilimi ayarlanabilir çünkü
// proje açık kaynak olacak; başka ülkede kuran kendi saatini ister.
const SAAT_DILIMI = process.env.BUDGET_TIMEZONE || 'Europe/Istanbul';

// Verilen saat diliminde "yıl-ay-gün" üretir. Intl kullanılıyor: yaz saati
// geçişlerini ve dilim kurallarını elle hesaplamak hataya açık.
function yerelTarih(now: Date): { yil: number; ay: number; gun: number } {
  const parcalar = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAAT_DILIMI,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);

  const al = (tip: string) => Number(parcalar.find((p) => p.type === tip)?.value ?? 0);
  return { yil: al('year'), ay: al('month'), gun: al('day') };
}

function donemler(now = new Date()) {
  const t = yerelTarih(now);
  const iki = (x: number) => String(x).padStart(2, '0');
  return {
    ay: `${t.yil}-${iki(t.ay)}`,
    gun: `${t.yil}-${iki(t.ay)}-${iki(t.gun)}`
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
// ediyor: ayın 1'i kış saatinde, bugün yaz saatinde olabilir. Ofseti bugüne
// göre alsaydık ay başı bir saat kayardı.
//
// İki tur: ilk turda duvar saatini UTC sanıp kaba bir an buluyoruz, ikinci
// turda ofseti o ana göre yeniden ölçüp düzeltiyoruz. Yaz saati geçişi tam
// gece yarısında olmadığı sürece iki tur yeter.
function yerelGunBasiUTC(now: Date, ayinBasi: boolean): string {
  const t = yerelTarih(now);
  const gun = ayinBasi ? 1 : t.gun;
  const duvar = Date.UTC(t.yil, t.ay - 1, gun, 0, 0, 0);

  let an = duvar;
  for (let tur = 0; tur < 2; tur++) an = duvar - ofsetMs(new Date(an));

  return new Date(an).toISOString();
}

function anahtarlar(kimlik: string) {
  const { ay, gun } = donemler();
  return {
    aylik: `spend:${kimlik}:${ay}`,
    gunluk: `spend:${kimlik}:${gun}`
  };
}

export interface ButceSinirlari {
  aylik: number | null;
  gunluk: number | null;
}

export interface ButceDurumu {
  aylikHarcama: number;
  gunlukHarcama: number;
  aylikSinir: number | null;
  gunlukSinir: number | null;
  asildi: 'aylik' | 'gunluk' | null;
}

export type ButceTuru = 'kisi' | 'sirket';

// Dönemin harcamasını KAYITLARDAN hesaplar.
//
// Sayaç Redis'te ama gerçek kaynak logs tablosu. Sayaç yeni açıldığında
// (özellik ilk kez devreye girdiğinde, dönem değiştiğinde ya da Redis
// temizlendiğinde) boş oluyor; o durumda kayıtlardan hesaplanıp sayaç
// dolduruluyor. Aksi halde "19 istek var ama harcama sıfır" gibi bir
// tutarsızlık çıkıyordu: istek sayısı kayıtlardan, harcama sayaçtan
// geliyordu ve ikisi farklı zamanları gösteriyordu.
async function kayitlardanHesapla(
  kimlik: string, tur: ButceTuru, baslangicISO: string
): Promise<number> {
  try {
    let anahtarKimlikleri: string[] | null = null;

    if (tur === 'kisi') {
      const { data } = await supabase
        .from('client_keys').select('id').eq('user_id', kimlik);
      anahtarKimlikleri = ((data ?? []) as Array<{ id: string }>).map((x) => x.id);
      // Anahtarı olmayan kişinin harcaması da yok.
      if (!anahtarKimlikleri.length) return 0;
    }

    let sorgu = supabase
      .from('logs').select('cost').gte('created_at', baslangicISO).limit(10000) as any;
    sorgu = tur === 'kisi'
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

function donemBaslangici(): { ay: string; gun: string } {
  const now = new Date();
  return {
    ay: yerelGunBasiUTC(now, true),
    gun: yerelGunBasiUTC(now, false)
  };
}

// Ekranda "ne zaman sıfırlanıyor" yazabilmek için: hangi dilim, hangi dönem,
// dönemler hangi anda başladı.
export function butceDonemi(now = new Date()) {
  const { ay, gun } = donemler(now);
  return {
    dilim: SAAT_DILIMI,
    ay, gun,
    ayBasi: yerelGunBasiUTC(now, true),
    gunBasi: yerelGunBasiUTC(now, false)
  };
}

async function oku(kimlik: string, tur: ButceTuru): Promise<{ ay: number; gun: number }> {
  const a = anahtarlar(kimlik);
  const [ayHam, gunHam] = await redis.mget<(string | number | null)[]>(a.aylik, a.gunluk);

  // Sayaç hiç açılmamışsa kayıtlardan doldur. null ile 0 farkı önemli:
  // 0 "bu dönemde harcama yok" demek, null "sayaç yok" demek.
  const bas = donemBaslangici();
  let ay = ayHam === null || ayHam === undefined ? null : Number(ayHam);
  let gun = gunHam === null || gunHam === undefined ? null : Number(gunHam);

  if (ay === null) {
    ay = await kayitlardanHesapla(kimlik, tur, bas.ay);
    if (ay > 0) {
      await redis.set(a.aylik, ay, { ex: AY_TTL });
    }
  }
  if (gun === null) {
    gun = await kayitlardanHesapla(kimlik, tur, bas.gun);
    if (gun > 0) {
      await redis.set(a.gunluk, gun, { ex: GUN_TTL });
    }
  }

  return { ay, gun };
}

// Harcamayı sayaca ekliyor. İstek tamamlandıktan sonra çağrılıyor, çünkü
// maliyet ancak o zaman biliniyor.
export async function harcamaEkle(kimlikler: Array<string | null>, tutar: number): Promise<void> {
  if (!Number.isFinite(tutar) || tutar <= 0) return;
  try {
    for (const kimlik of kimlikler) {
      if (!kimlik) continue;
      const a = anahtarlar(kimlik);
      const [yeniAy, yeniGun] = await Promise.all([
        redis.incrbyfloat(a.aylik, tutar),
        redis.incrbyfloat(a.gunluk, tutar)
      ]);
      // TTL yalnızca sayaç yeni açıldığında konuyor; her istekte expire
      // çağırmak süreyi sürekli ileri iterdi ve dönem hiç kapanmazdı.
      if (Number(yeniAy) === tutar) await redis.expire(a.aylik, AY_TTL);
      if (Number(yeniGun) === tutar) await redis.expire(a.gunluk, GUN_TTL);
    }
  } catch (error) {
    // Sayaç yazılamazsa istek engellenmiyor: bütçe takibi kaybolur ama
    // servis çalışmaya devam eder. Aksi halde Redis kesintisi bütün
    // trafiği durdururdu.
    console.error('Bütçe sayacı yazılamadı:', error);
  }
}

export async function butceDurumu(
  kimlik: string,
  sinirlar: ButceSinirlari,
  tur: ButceTuru = 'kisi'
): Promise<ButceDurumu> {
  const { ay, gun } = await oku(kimlik, tur);
  const asildi =
    sinirlar.gunluk !== null && gun >= sinirlar.gunluk ? 'gunluk'
    : sinirlar.aylik !== null && ay >= sinirlar.aylik ? 'aylik'
    : null;

  return {
    aylikHarcama: ay,
    gunlukHarcama: gun,
    aylikSinir: sinirlar.aylik,
    gunlukSinir: sinirlar.gunluk,
    asildi
  };
}

// Kişi ve şirket sınırları birlikte değerlendiriliyor: hangisi önce dolarsa
// istek orada duruyor.
export async function butceKontrol(
  kisiId: string | null,
  clientId: string,
  kisiSinir: ButceSinirlari,
  sirketSinir: ButceSinirlari
): Promise<{ ok: true } | { ok: false; sebep: string }> {
  try {
    if (kisiId) {
      const d = await butceDurumu(kisiId, kisiSinir, 'kisi');
      if (d.asildi === 'gunluk') {
        return {
          ok: false,
          sebep: `Daily spending limit reached ($${(d.gunlukSinir ?? 0).toFixed(2)}). ` +
                 `Requests resume tomorrow, or ask an administrator to raise it.`
        };
      }
      if (d.asildi === 'aylik') {
        return {
          ok: false,
          sebep: `Monthly spending limit reached ($${(d.aylikSinir ?? 0).toFixed(2)}). ` +
                 `Ask an administrator to raise it.`
        };
      }
    }

    const s = await butceDurumu(clientId, sirketSinir, 'sirket');
    if (s.asildi === 'gunluk') {
      return {
        ok: false,
        sebep: `The company hit its daily spending limit ($${(s.gunlukSinir ?? 0).toFixed(2)}). ` +
               `Requests resume tomorrow.`
      };
    }
    if (s.asildi === 'aylik') {
      return {
        ok: false,
        sebep: `The company hit its monthly spending limit ($${(s.aylikSinir ?? 0).toFixed(2)}).`
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

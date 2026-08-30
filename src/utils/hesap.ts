// Hesap kimliği: şifre karması ve oturum çerezi.
//
// Anahtarlar için kullandığımız SHA-256 (utils/auth.ts) burada KULLANILMAZ.
// SHA-256 hızlı olmak üzere tasarlanmış; rastgele üretilmiş 64 karakterlik bir
// anahtar için bu sorun değil, ama insanın seçtiği bir şifre için felaket:
// saniyede milyarlarca deneme yapılabiliyor.
//
// scrypt bilerek yavaş ve bellek isteyen bir işlev. Node'un içinde geliyor,
// paket eklemeye gerek yok — Vercel'de derlenen bir bağımlılık taşımamak da
// ayrı bir kazanç.

import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt) as (
  parola: string | Buffer, tuz: string | Buffer, uzunluk: number
) => Promise<Buffer>;

const TUZ_UZUNLUK = 16;
const KARMA_UZUNLUK = 32;

// Karma biçimi: scrypt$<tuz>$<karma>. Algoritma adını içeride saklıyoruz ki
// ileride değiştirmek gerekirse eski kayıtlar tanınmaya devam etsin.
export async function sifreKarmasi(sifre: string): Promise<string> {
  const tuz = crypto.randomBytes(TUZ_UZUNLUK);
  const karma = await scrypt(sifre, tuz, KARMA_UZUNLUK);
  return `scrypt$${tuz.toString('hex')}$${karma.toString('hex')}`;
}

export async function sifreDogru(sifre: string, kayit: string): Promise<boolean> {
  const [yontem, tuzHex, karmaHex] = kayit.split('$');
  if (yontem !== 'scrypt' || !tuzHex || !karmaHex) return false;

  const beklenen = Buffer.from(karmaHex, 'hex');
  const hesaplanan = await scrypt(sifre, Buffer.from(tuzHex, 'hex'), beklenen.length);

  // Sabit zamanlı karşılaştırma: normal === karşılaştırması ilk farklı baytta
  // duruyor ve geçen süre şifrenin ne kadarının doğru olduğunu sızdırıyor.
  return crypto.timingSafeEqual(beklenen, hesaplanan);
}

// ---------------------------------------------------------------------------
// Oturum
//
// Sunucusuz ortamda her istek ayrı bir çalıştırma; bellekte oturum tutulamıyor.
// İki seçenek vardı: veritabanında oturum tablosu ya da imzalı çerez.
//
// İmzalı çerez seçildi — her istekte bir veritabanı turu daha eklemiyor.
// Bedeli, süresi dolmadan bir oturumu iptal edememek. Şifre değiştiğinde eski
// oturumların düşmesi için karmanın bir parçası imzaya katılıyor: şifre
// değişince imza tutmuyor ve bütün eski çerezler geçersiz oluyor.
// ---------------------------------------------------------------------------

const OTURUM_SURESI_SN = 7 * 24 * 60 * 60;

function imzaAnahtari(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.trim() === '') {
    throw new Error('SESSION_SECRET tanımlı değil; oturum imzalanamaz.');
  }
  return s;
}

export interface Oturum {
  tur: 'musteri' | 'yonetici';
  kullaniciId: string;
  clientId: string | null;
  biter: number;
}

function imzala(govde: string): string {
  return crypto.createHmac('sha256', imzaAnahtari()).update(govde).digest('base64url');
}

// parolaIzi: şifre karmasının kısa bir özeti. Şifre değişince değişiyor ve
// eski çerezlerin imzası tutmuyor.
export function oturumUret(o: Omit<Oturum, 'biter'>, parolaKarmasi: string): string {
  const govde = JSON.stringify({
    ...o,
    biter: Math.floor(Date.now() / 1000) + OTURUM_SURESI_SN,
    iz: parolaIzi(parolaKarmasi)
  });
  const kodlu = Buffer.from(govde).toString('base64url');
  return `${kodlu}.${imzala(kodlu)}`;
}

export function parolaIzi(parolaKarmasi: string): string {
  return crypto.createHash('sha256').update(parolaKarmasi).digest('base64url').slice(0, 12);
}

export function oturumCoz(cerez: string | undefined): (Oturum & { iz: string }) | null {
  if (!cerez) return null;
  const [kodlu, imza] = cerez.split('.');
  if (!kodlu || !imza) return null;

  const beklenen = imzala(kodlu);
  // İmza uzunlukları farklıysa timingSafeEqual hata atıyor; önce onu eliyoruz.
  if (imza.length !== beklenen.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(imza), Buffer.from(beklenen))) return null;

  try {
    const o = JSON.parse(Buffer.from(kodlu, 'base64url').toString()) as Oturum & { iz: string };
    if (!o.biter || o.biter < Math.floor(Date.now() / 1000)) return null;
    return o;
  } catch {
    return null;
  }
}

// Çerez başlıkları. HttpOnly: tarayıcı JavaScript'i okuyamıyor, XSS ile
// oturum çalınamıyor. SameSite=Lax: başka siteden gelen isteklerde
// gönderilmiyor. Secure: yalnızca https — yerelde http olduğu için
// geliştirmede kapalı.
export function cerezYaz(ad: string, deger: string, uretim: boolean): string {
  return [
    `${ad}=${deger}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${OTURUM_SURESI_SN}`,
    uretim ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

export function cerezSil(ad: string, uretim: boolean): string {
  return [
    `${ad}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    uretim ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

export function cerezOku(baslik: string | undefined, ad: string): string | undefined {
  if (!baslik) return undefined;
  for (const parca of baslik.split(';')) {
    const [k, ...v] = parca.trim().split('=');
    if (k === ad) return v.join('=');
  }
  return undefined;
}

// Tek kullanımlık anahtar teslimi.
//
// Sorun: yönetici anahtar üretince açık değeri görüyordu ve onu kişiye elle
// iletmek zorundaydı — WhatsApp, e-posta, ekran görüntüsü. Anahtar kalıcı iz
// bırakan yerlerde dolaşıyordu ve kullanıcı sayısı arttıkça bu ölçeklenmiyordu.
//
// Çözüm: anahtar üretilir üretilmez şifrelenip saklanıyor, yöneticiye yalnızca
// bir bağlantı veriliyor. Alıcı bağlantıyı kendi oturumuyla açtığında anahtar
// bir kez gösteriliyor ve kayıt siliniyor.
//
// ŞİFRELEME ANAHTARI BAĞLANTIDAKİ JETON. Jeton veritabanında saklanmıyor,
// yalnızca karması var. Veritabanını ele geçiren biri kayıtları çözemez;
// çözmek için bağlantının kendisi gerekiyor. Bu, "geçici de olsa açık anahtar
// saklamak" itirazını karşılıyor — saklanan şey açık değil.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { supabase } from '../services/db.js';

const OMUR_SAAT = 24;

export function jetonUret(): string {
  return randomBytes(24).toString('base64url');
}

function jetonKarmasi(jeton: string): string {
  return createHash('sha256').update(jeton).digest('hex');
}

// Jetondan 32 baytlık simetrik anahtar. Jeton zaten rastgele, türetme için
// karma yeterli.
function sifrelemeAnahtari(jeton: string): Buffer {
  return createHash('sha256').update(`teslim:${jeton}`).digest();
}

function sifrele(acikMetin: string, jeton: string): string {
  const iv = randomBytes(12);
  const sifreleyici = createCipheriv('aes-256-gcm', sifrelemeAnahtari(jeton), iv);
  const govde = Buffer.concat([sifreleyici.update(acikMetin, 'utf8'), sifreleyici.final()]);
  return [iv.toString('hex'), govde.toString('hex'), sifreleyici.getAuthTag().toString('hex')].join(':');
}

function coz(yuk: string, jeton: string): string | null {
  try {
    const [ivHex, govdeHex, etiketHex] = yuk.split(':');
    if (!ivHex || !govdeHex || !etiketHex) return null;
    const cozucu = createDecipheriv(
      'aes-256-gcm', sifrelemeAnahtari(jeton), Buffer.from(ivHex, 'hex')
    );
    cozucu.setAuthTag(Buffer.from(etiketHex, 'hex'));
    return Buffer.concat([
      cozucu.update(Buffer.from(govdeHex, 'hex')), cozucu.final()
    ]).toString('utf8');
  } catch {
    // Yanlış jeton ya da bozuk kayıt — ikisi de aynı sonucu vermeli.
    return null;
  }
}

export type TeslimSonucu =
  | { ok: true; jeton: string; sonKullanma: string }
  | { ok: false; hata: string };

// Anahtarı şifreleyip teslim kaydı açar, bağlantı jetonunu döner.
export async function teslimOlustur(
  keyId: string, userId: string, acikAnahtar: string
): Promise<TeslimSonucu> {
  const jeton = jetonUret();
  const sonKullanma = new Date(Date.now() + OMUR_SAAT * 3600 * 1000).toISOString();

  const { error } = await supabase.from('key_deliveries').insert([{
    key_id: keyId,
    user_id: userId,
    token_hash: jetonKarmasi(jeton),
    payload: sifrele(acikAnahtar, jeton),
    expires_at: sonKullanma
  }]);

  if (error) {
    return {
      ok: false,
      hata: error.message.includes('key_deliveries')
        ? 'The key_deliveries table has not been created yet. Run anahtar-teslim.sql.'
        : 'Could not prepare the handover link.'
    };
  }
  return { ok: true, jeton, sonKullanma };
}

export type AcmaSonucu =
  | { ok: true; anahtar: string }
  | { ok: false; durum: number; hata: string };

// Bağlantıyı açar. Yalnızca kaydın sahibi açabiliyor ve yalnızca bir kez.
export async function teslimAc(jeton: string, kullaniciId: string): Promise<AcmaSonucu> {
  const { data } = await supabase
    .from('key_deliveries')
    .select('id, user_id, payload, expires_at, opened_at')
    .eq('token_hash', jetonKarmasi(jeton))
    .limit(1);

  const kayit = (data ?? [])[0] as {
    id: string; user_id: string; payload: string;
    expires_at: string; opened_at: string | null;
  } | undefined;

  // Bulunamayan, açılmış ve süresi geçmiş kayıtlar AYNI cevabı veriyor:
  // farklı mesajlar geçerli bir bağlantının var olduğunu sızdırırdı.
  const yok = { ok: false as const, durum: 404, hata: 'This link is no longer valid.' };
  if (!kayit) return yok;
  if (kayit.opened_at) return yok;
  if (new Date(kayit.expires_at).getTime() < Date.now()) return yok;

  // Sahiplik kontrolü. Bağlantı sızsa bile başkası açamıyor.
  const a = Buffer.from(kayit.user_id);
  const b = Buffer.from(kullaniciId);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, durum: 403, hata: 'This link was issued to someone else.' };
  }

  const acik = coz(kayit.payload, jeton);
  if (!acik) return yok;

  // Önce işaretle, sonra döndür: aynı anda iki istek gelirse ikincisi
  // açılmış kayda düşsün.
  const { error } = await supabase
    .from('key_deliveries')
    .update({ opened_at: new Date().toISOString(), payload: '' })
    .eq('id', kayit.id).is('opened_at', null);
  if (error) return yok;

  return { ok: true, anahtar: acik };
}

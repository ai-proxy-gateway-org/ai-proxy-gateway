// Tek kullanımlık key teslimi.
//
// Sorun: yönetici key üretince açık değeri görüyordu ve onu kişiye elle
// iletmek zorundaydı — WhatsApp, e-posta, ekran görüntüsü. Anahtar kalıcı iz
// bırakan yerlerde dolaşıyordu ve kullanıcı sayısı arttıkça bu ölçeklenmiyordu.
//
// Çözüm: key üretilir üretilmez şifrelenip saklanıyor, yöneticiye yalnızca
// bir bağlantı veriliyor. Alıcı bağlantıyı kendi oturumuyla açtığında key
// bir kez gösteriliyor ve kayıt siliniyor.
//
// ŞİFRELEME ANAHTARI BAĞLANTIDAKİ JETON. Jeton veritabanında saklanmıyor,
// yalnızca karması var. Veritabanını ele geçiren biri kayıtları çözemez;
// çözmek için bağlantının kendisi gerekiyor. Bu, "geçici de olsa açık key
// saklamak" itirazını karşılıyor — saklanan şey açık değil.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { supabase } from '../utils/supabaseClient.js';

const OMUR_SAAT = 24;

export function jetonUret(): string {
  return randomBytes(24).toString('base64url');
}

function jetonKarmasi(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Jetondan 32 baytlık simetrik key. Jeton zaten rastgele, türetme için
// karma yeterli.
function sifrelemeAnahtari(token: string): Buffer {
  return createHash('sha256').update(`teslim:${token}`).digest();
}

function sifrele(acikMetin: string, token: string): string {
  const iv = randomBytes(12);
  const sifreleyici = createCipheriv('aes-256-gcm', sifrelemeAnahtari(token), iv);
  const bodyEl = Buffer.concat([sifreleyici.update(acikMetin, 'utf8'), sifreleyici.final()]);
  return [iv.toString('hex'), bodyEl.toString('hex'), sifreleyici.getAuthTag().toString('hex')].join(':');
}

function coz(yuk: string, token: string): string | null {
  try {
    const [ivHex, govdeHex, etiketHex] = yuk.split(':');
    if (!ivHex || !govdeHex || !etiketHex) return null;
    const cozucu = createDecipheriv(
      'aes-256-gcm', sifrelemeAnahtari(token), Buffer.from(ivHex, 'hex')
    );
    cozucu.setAuthTag(Buffer.from(etiketHex, 'hex'));
    return Buffer.concat([
      cozucu.update(Buffer.from(govdeHex, 'hex')), cozucu.final()
    ]).toString('utf8');
  } catch {
    // Yanlış token ya da bozuk kayıt — ikisi de aynı sonucu vermeli.
    return null;
  }
}

export type TeslimSonucu =
  | { ok: true; token: string; sonKullanma: string }
  | { ok: false; error: string };

// Anahtarı şifreleyip teslim kaydı açar, bağlantı jetonunu döner.
export async function teslimOlustur(
  keyId: string, userId: string, acikAnahtar: string
): Promise<TeslimSonucu> {
  const token = jetonUret();
  const sonKullanma = new Date(Date.now() + OMUR_SAAT * 3600 * 1000).toISOString();

  const { error } = await supabase.from('key_deliveries').insert([{
    key_id: keyId,
    user_id: userId,
    token_hash: jetonKarmasi(token),
    payload: sifrele(acikAnahtar, token),
    expires_at: sonKullanma
  }]);

  if (error) {
    return {
      ok: false,
      error: error.message.includes('key_deliveries')
        ? 'The key_deliveries table has not been created yet. Run key-teslim.sql.'
        : 'Could not prepare the handover link.'
    };
  }
  return { ok: true, token, sonKullanma };
}

export type AcmaSonucu =
  | { ok: true; key: string }
  | { ok: false; status: number; error: string };

// Bağlantıyı açar. Yalnızca kaydın sahibi açabiliyor ve yalnızca bir kez.
export async function openDelivery(token: string): Promise<AcmaSonucu> {
  const { data } = await supabase
    .from('key_deliveries')
    .select('id, user_id, payload, expires_at, opened_at')
    .eq('token_hash', jetonKarmasi(token))
    .limit(1);

  const record = (data ?? [])[0] as {
    id: string; user_id: string; payload: string;
    expires_at: string; opened_at: string | null;
  } | undefined;

  // Bulunamayan, açılmış ve süresi geçmiş kayıtlar AYNI cevabı veriyor:
  // farklı mesajlar geçerli bir bağlantının var olduğunu sızdırırdı.
  const yok = { ok: false as const, status: 404, error: 'This link is no longer valid.' };
  if (!record) return yok;
  if (record.opened_at) return yok;
  if (new Date(record.expires_at).getTime() < Date.now()) return yok;

  // Sahiplik kontrolü. Bağlantı sızsa bile başkası açamıyor.
  

  const acik = coz(record.payload, token);
  if (!acik) return yok;

  // Önce işaretle, sonra döndür: aynı anda iki request gelirse ikincisi
  // açılmış kayda düşsün.
  const { error } = await supabase
    .from('key_deliveries')
    .update({ opened_at: new Date().toISOString(), payload: '' })
    .eq('id', record.id).is('opened_at', null);
  if (error) return yok;

  return { ok: true, key: acik };
}

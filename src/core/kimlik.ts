// Hesap işlemleri: kullanıcı oluşturma, giriş doğrulama, oturum okuma.
//
// İki ayrı kullanıcı türü var ve bilerek ayrı tablolarda duruyorlar:
//
//   users        müşteri kullanıcıları — bir kuruluşa bağlı, yalnızca onun
//                verisini görür. client_id ZORUNLU.
//   admin_users  yönetici hesapları — hiçbir kuruluşa bağlı değil, her şeyi
//                görür ve değiştirir.
//
// Tek tabloda "client_id boşsa yönetici" demek kısa yoldu ama müşteri verisi
// her yerde client_id ile süzülüyor; o alan boş kaldığında süzgeç düşüyor.
// Ayrı tabloda sınır şemada çizili, bir kontrolün unutulması yetki vermiyor.

import { supabase } from '../services/db.js';
import {
  sifreKarmasi, sifreDogru, oturumUret, oturumCoz, parolaIzi, cerezOku
} from '../utils/hesap.js';

export type HesapTuru = 'musteri' | 'yonetici';

const TABLO: Record<HesapTuru, string> = {
  musteri: 'users',
  yonetici: 'admin_users'
};

export const CEREZ_ADI: Record<HesapTuru, string> = {
  musteri: 'portal_oturum',
  yonetici: 'panel_oturum'
};

function epostaDuzelt(e: string): string {
  return e.trim().toLowerCase();
}

// Şifre kuralları bilerek sade: uzunluk en etkili ölçüt, karmaşıklık kuralları
// (büyük harf, rakam, sembol) insanları tahmin edilebilir kalıplara itiyor.
export function sifreKusuru(sifre: string): string | null {
  if (sifre.length < 10) return 'Password must be at least 10 characters.';
  if (sifre.length > 200) return 'Password is too long.';
  return null;
}

export interface Hesap {
  id: string;
  email: string;
  clientId: string | null;
}

export async function hesapOlustur(
  tur: HesapTuru,
  eposta: string,
  sifre: string,
  clientId?: string
): Promise<{ ok: true; hesap: Hesap } | { ok: false; hata: string }> {
  const e = epostaDuzelt(eposta);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, hata: 'Enter a valid email address.' };

  const kusur = sifreKusuru(sifre);
  if (kusur) return { ok: false, hata: kusur };

  if (tur === 'musteri' && !clientId) {
    return { ok: false, hata: 'A customer user must belong to a customer.' };
  }

  // Veritabanı dizini son savunma; uygulamada da bakıyoruz. Yalnızca dizine
  // güvenmek, dizin bir ortamda kurulmadığında aynı adresle iki hesap
  // açılmasına ve girişin hangi hesaba bakacağını bilememesine yol açıyordu.
  const { data: mevcut } = await supabase
    .from(TABLO[tur]).select('id').eq('email', e).limit(1);
  if ((mevcut ?? []).length) {
    return { ok: false, hata: 'This email address is already registered.' };
  }

  const satir: Record<string, unknown> = {
    email: e,
    password_hash: await sifreKarmasi(sifre)
  };
  if (tur === 'musteri') satir.client_id = clientId;

  // Dönen sütunlar türe göre: admin_users'ta client_id yok, istemek sorguyu
  // düşürüyor.
  const { data, error } = await supabase
    .from(TABLO[tur]).insert([satir])
    .select(tur === 'musteri' ? 'id, email, client_id' : 'id, email')
    .single();

  if (error) {
    const cakisma = /duplicate|unique/i.test(String(error.message));
    return { ok: false, hata: cakisma ? 'This email address is already registered.' : 'Could not create the account.' };
  }

  // Sütun listesi çalışma anında seçildiği için Supabase'in tip çıkarımı
  // bunu çözemiyor; dönüşü açıkça belirtiyoruz.
  const d = data as unknown as { id: string; email: string; client_id?: string };
  return { ok: true, hesap: { id: d.id, email: d.email, clientId: d.client_id ?? null } };
}

export async function girisDogrula(
  tur: HesapTuru,
  eposta: string,
  sifre: string
): Promise<{ ok: true; hesap: Hesap; cerez: string } | { ok: false }> {
  const e = epostaDuzelt(eposta);

  // maybeSingle yerine limit(1): tabloda beklenmedik bir yinelenen satır
  // varsa maybeSingle hata veriyor ve giriş tamamen çalışmaz hale geliyordu.
  // Böyle bir durumda giriş çalışmaya devam etsin, sorun ayrıca görünsün.
  const { data: satirlar } = await supabase
    .from(TABLO[tur])
    .select(tur === 'musteri' ? 'id, email, password_hash, client_id' : 'id, email, password_hash')
    .eq('email', e)
    .order('created_at', { ascending: true })
    .limit(1);
  const data = (satirlar ?? [])[0] ?? null;

  // Hesap yoksa da bir karma doğrulaması yapıyoruz. Aksi halde var olmayan
  // e-posta anında, var olan geç cevap dönerdi ve bu fark hangi adreslerin
  // kayıtlı olduğunu sızdırırdı.
  const kayit = data as { id: string; email: string; password_hash: string; client_id?: string } | null;
  const karma = kayit?.password_hash
    ?? 'scrypt$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';

  const dogru = await sifreDogru(sifre, karma);
  if (!kayit || !dogru) return { ok: false };

  await supabase.from(TABLO[tur])
    .update({ last_login_at: new Date().toISOString() }).eq('id', kayit.id);

  const hesap: Hesap = { id: kayit.id, email: kayit.email, clientId: kayit.client_id ?? null };
  const cerez = oturumUret(
    { tur, kullaniciId: hesap.id, clientId: hesap.clientId },
    kayit.password_hash
  );
  return { ok: true, hesap, cerez };
}

// Çerezden oturumu çözüp hesabın hâlâ geçerli olduğunu doğruluyor.
//
// Çerezin imzası tutuyor olabilir ama hesap silinmiş ya da şifre değişmiş
// olabilir. Şifre değişikliğini karmanın izinden anlıyoruz: iz tutmuyorsa
// oturum düşüyor, yani şifre değiştirmek bütün eski çerezleri geçersiz kılıyor.
export async function oturumdakiHesap(
  tur: HesapTuru,
  cerezBasligi: string | undefined
): Promise<Hesap | null> {
  const o = oturumCoz(cerezOku(cerezBasligi, CEREZ_ADI[tur]));
  if (!o || o.tur !== tur) return null;

  const { data: bulunan } = await supabase
    .from(TABLO[tur])
    .select(tur === 'musteri' ? 'id, email, password_hash, client_id' : 'id, email, password_hash')
    .eq('id', o.kullaniciId)
    .limit(1);
  const data = (bulunan ?? [])[0] ?? null;

  const kayit = data as { id: string; email: string; password_hash: string; client_id?: string } | null;
  if (!kayit) return null;
  if (parolaIzi(kayit.password_hash) !== o.iz) return null;

  return { id: kayit.id, email: kayit.email, clientId: kayit.client_id ?? null };
}

export async function sifreDegistir(
  tur: HesapTuru,
  hesapId: string,
  eskiSifre: string | null,
  yeniSifre: string
): Promise<{ ok: true } | { ok: false; hata: string }> {
  const kusur = sifreKusuru(yeniSifre);
  if (kusur) return { ok: false, hata: kusur };

  const { data: kayitlar } = await supabase
    .from(TABLO[tur]).select('id, password_hash').eq('id', hesapId).limit(1);
  const data = (kayitlar ?? [])[0] ?? null;
  const kayit = data as { password_hash: string } | null;
  if (!kayit) return { ok: false, hata: 'Account not found.' };

  // eskiSifre null ise yönetici sıfırlaması: mevcut şifre sorulmuyor.
  if (eskiSifre !== null && !(await sifreDogru(eskiSifre, kayit.password_hash))) {
    return { ok: false, hata: 'Current password is not correct.' };
  }

  const { error } = await supabase
    .from(TABLO[tur])
    .update({ password_hash: await sifreKarmasi(yeniSifre) })
    .eq('id', hesapId);

  if (error) return { ok: false, hata: 'Could not update the password.' };
  return { ok: true };
}

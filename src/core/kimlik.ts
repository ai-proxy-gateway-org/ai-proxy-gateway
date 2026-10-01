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

import { supabase } from '../utils/supabaseClient.js';
import {
  sifreKarmasi, sifreDogru, oturumUret, oturumCoz, parolaIzi, cerezOku
} from '../utils/hesap.js';

export type HesapTuru = 'musteri' | 'admin';

const TABLO: Record<HesapTuru, string> = {
  musteri: 'users',
  admin: 'admin_users'
};

export const CEREZ_ADI: Record<HesapTuru, string> = {
  musteri: 'portal_oturum',
  admin: 'panel_oturum'
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
): Promise<{ ok: true; hesap: Hesap } | { ok: false; error: string }> {
  const e = epostaDuzelt(eposta);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: 'Enter a valid email address.' };

  const kusur = sifreKusuru(sifre);
  if (kusur) return { ok: false, error: kusur };

  if (tur === 'musteri' && !clientId) {
    return { ok: false, error: 'A customer user must belong to a customer.' };
  }

  // Veritabanı dizini son savunma; uygulamada da bakıyoruz. Yalnızca dizine
  // güvenmek, dizin bir ortamda kurulmadığında aynı adresle iki hesap
  // açılmasına ve girişin hangi hesaba bakacağını bilememesine path açıyordu.
  const { data: mevcut } = await supabase
    .from(TABLO[tur]).select('id').eq('email', e).limit(1);
  if ((mevcut ?? []).length) {
    return { ok: false, error: 'This email address is already registered.' };
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
    return { ok: false, error: cakisma ? 'This email address is already registered.' : 'Could not create the account.' };
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
  // varsa maybeSingle error veriyor ve giriş tamamen çalışmaz hale geliyordu.
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
  const record = data as { id: string; email: string; password_hash: string; client_id?: string } | null;
  const karma = record?.password_hash
    ?? 'scrypt$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';

  const dogru = await sifreDogru(sifre, karma);
  if (!record || !dogru) return { ok: false };

  await supabase.from(TABLO[tur])
    .update({ last_login_at: new Date().toISOString() }).eq('id', record.id);

  const hesap: Hesap = { id: record.id, email: record.email, clientId: record.client_id ?? null };
  const cerez = oturumUret(
    { tur, kullaniciId: hesap.id, clientId: hesap.clientId },
    record.password_hash
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

  const record = data as { id: string; email: string; password_hash: string; client_id?: string } | null;
  if (!record) return null;
  if (parolaIzi(record.password_hash) !== o.iz) return null;

  return { id: record.id, email: record.email, clientId: record.client_id ?? null };
}

export async function sifreDegistir(
  tur: HesapTuru,
  hesapId: string,
  eskiSifre: string | null,
  yeniSifre: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const kusur = sifreKusuru(yeniSifre);
  if (kusur) return { ok: false, error: kusur };

  const { data: records } = await supabase
    .from(TABLO[tur]).select('id, password_hash').eq('id', hesapId).limit(1);
  const data = (records ?? [])[0] ?? null;
  const record = data as { password_hash: string } | null;
  if (!record) return { ok: false, error: 'Account not found.' };

  // eskiSifre null ise yönetici sıfırlaması: mevcut şifre sorulmuyor.
  if (eskiSifre !== null && !(await sifreDogru(eskiSifre, record.password_hash))) {
    return { ok: false, error: 'Current password is not correct.' };
  }

  const { error } = await supabase
    .from(TABLO[tur])
    .update({ password_hash: await sifreKarmasi(yeniSifre) })
    .eq('id', hesapId);

  if (error) return { ok: false, error: 'Could not update the password.' };
  return { ok: true };
}

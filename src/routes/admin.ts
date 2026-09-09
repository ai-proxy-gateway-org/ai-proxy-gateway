// Yönetici paneli.
//
// Portalın kardeşi: aynı sunucu, aynı tasarım dili, farklı yol ve farklı yetki.
// Portal müşterinin kendi verisini gösterir; burası bütün müşterileri yönetir.
//
// Giriş, .env içindeki ADMIN_TOKEN ile. Taslak için yeterli — gerçek üründe
// yönetici hesapları ayrı bir kimlik sistemine bağlanmalı.

import type { Hono, Context } from 'hono';
import { STIL, YAZI_TIPI } from '../ui/stil.js';
import { supabase } from '../utils/supabaseClient.js';
import { createNewClient } from '../services/db.js';
import { teslimOlustur } from '../core/anahtarTeslim.js';
import { generateProxyKey, hashApiKey } from '../utils/auth.js';
import {
  hesapOlustur, sifreDegistir, sifreKusuru,
  girisDogrula, oturumdakiHesap, CEREZ_ADI
} from '../core/kimlik.js';
import { cerezYaz, cerezSil } from '../utils/hesap.js';
import {
  kaynakFiyatlari, liteFiyatlari, kaynakDurumu, olasiKarsiliklar,
  ikiKaynaktanOku, fiyatlaYenidenEslestir, liteAdaylari
} from '../core/priceSource.js';
import { priceList, invalidateCatalog, catalogInfo } from '../core/modelCatalog.js';
import { butceDurumu } from '../core/butce.js';
import { govdeOku } from '../utils/honoYardim.js';

// Ret mesajları müşteriye yol göstersin diye değiştirildi; eski kayıtlar
// eski metinle duruyor. Süzgeçler ikisini de tanımak zorunda, yoksa
// geçmiş talepler bir sürüm yükseltmesiyle görünmez oluyor.
function katalogRedMi(mesaj: string): boolean {
  return mesaj.includes('is not defined') || mesaj.includes('is not available on this gateway');
}
function yetkiRedMi(mesaj: string): boolean {
  return mesaj.includes('not authorized')
    || mesaj.includes('is not enabled for your account')
    // Fiyat tavanı reddi ayrı bir cümle kuruyor ("costs $30.00 per 1M output
    // tokens, above your limit of $20.00"). Bu da bir taleptir: kişi modeli
    // istedi, pahalı olduğu için geçemedi.
    || mesaj.includes('above your limit of');
}
// Sağlayıcının reddettiği istekler. Metin Türkçeden İngilizceye çevrildi;
// eski kayıtlar eski metinle duruyor, ikisi de tanınmalı.
function saglayiciRedMi(mesaj: string): boolean {
  return /Provider returned\s+\d{3}/.test(mesaj) || /Sağlayıcı\s+\d{3}/.test(mesaj);
}

// Yöneticinin şifre uydurması zayıf ve tekrar eden şifreler demek; rastgele
// üretip bir kez gösteriyoruz.
function uretilmisSifre(): string {
  const harfler = 'abcdefghijkmnopqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += harfler[Math.floor(Math.random() * harfler.length)];
  }
  return s;
}

// Panele iki yolla girilebiliyor:
//
//   1. Oturum çerezi — admin_users tablosundaki bir hesapla giriş yapılmış
//   2. ADMIN_TOKEN — tek paylaşılan jeton
//
// İkincisi acil durum kapısı olarak duruyor: ilk yönetici hesabı onunla
// açılıyor ve hesaplarla ilgili bir sorun çıkarsa panele girilebiliyor.
// Hesaplar yerleşince kaldırılacak — paylaşılan bir jetonda "kim ne yaptı"
// sorusunun cevabı yok.
type YoneticiKimligi = { yol: 'hesap'; id: string; email: string } | { yol: 'jeton' } | null;

async function yoneticiKimligi(c: Context): Promise<YoneticiKimligi> {
  const hesap = await oturumdakiHesap('yonetici', c.req.header('cookie'));
  if (hesap) return { yol: 'hesap', id: hesap.id, email: hesap.email };

  const beklenen = process.env.ADMIN_TOKEN;
  if (!beklenen || beklenen.trim() === '') return null;

  const baslik = String(c.req.header('authorization') ?? '');
  const jeton = baslik.startsWith('Bearer ') ? baslik.slice(7).trim() : '';
  // Sabit zamanlı karşılaştırma gerekmiyor: jeton uzun ve rastgele.
  return jeton === beklenen ? { yol: 'jeton' } : null;
}

// Paylaşılan jetonun yetkisi bilerek dar.
//
// Jeton acil durum kapısı: hesap tarafında bir sorun çıkarsa panele girilmeli.
// Ama onunla her şeyin yapılabilmesi, "kim ne yaptı" sorusunu cevapsız bırakan
// bir arka kapı demek — hesaplara geçmenin sebebi tam olarak buydu.
//
// Bu yüzden jeton yalnızca yönetici hesabı açmaya ve şifre sıfırlamaya yetiyor.
// Fiyat değiştirme, müşteri silme, anahtar üretme gibi işler hesap oturumu
// istiyor ve kimin yaptığı kayda geçebiliyor.
async function yoneticiMi(c: Context): Promise<boolean> {
  return (await yoneticiKimligi(c)) !== null;
}

async function hesapOturumuMu(c: Context): Promise<boolean> {
  const k = await yoneticiKimligi(c);
  return k?.yol === 'hesap';
}

const SAYFA = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin Console</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%232563eb'/%3E%3Ctext x='16' y='22' font-family='system-ui,sans-serif' font-size='13' font-weight='700' fill='white' text-anchor='middle'%3EAD%3C/text%3E%3C/svg%3E">
${YAZI_TIPI}
<style>${STIL}
  .markaSimge.yon { background:var(--mavi); color:#fff; }
  .formSatir { display:grid; grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));
               gap:1rem; }
  .formSatir label { display:flex; flex-direction:column; gap:.4rem;
                     font-size:.85rem; color:var(--ink-3); }
  .formSatir select, .formSatir input { padding:.6rem .8rem; font:inherit; font-size:.9rem;
    border:1px solid var(--line-2); border-radius:8px; background:var(--surface);
    color:var(--ink); width:100%; }
  .satirDugme { background:none; border:0; color:var(--mavi); font:inherit;
                font-size:.83rem; cursor:pointer; padding:.2rem .4rem; border-radius:5px; }
  .satirDugme:hover { background:var(--sunk); }
  .satirDugme.tehlike { color:var(--kirmizi); }
  td.islem { text-align:right; white-space:nowrap; }
  .girisSekme { display:flex; gap:.3rem; background:var(--sunk); padding:.25rem;
    border-radius:9px; margin:.6rem 0 1.1rem; }
  .girisSekme button { flex:1; padding:.45rem .6rem; font:inherit; font-size:.86rem;
    border:0; border-radius:7px; background:none; color:var(--ink-3); cursor:pointer; }
  .girisSekme button.secili { background:var(--surface); color:var(--ink); font-weight:500;
    box-shadow:0 1px 2px rgba(0,0,0,.06); }
  .alanEtiket { display:block; font-size:.85rem; color:var(--ink-3); }
  .alanEtiket input { margin-top:.35rem; }

  /* Model izin listesi: kutucuklar sığdıkça yan yana akıyor, uzun listede kaydırılıyor. */
  .secimKutu { display:flex; flex-wrap:wrap; gap:.45rem; max-height:14rem; overflow-y:auto;
    padding:.7rem; border:1px solid var(--line-2); border-radius:10px; background:var(--sunk); }
  .secim { display:inline-flex; align-items:center; gap:.45rem; font-size:.85rem;
    color:var(--ink-2); background:var(--surface); border:1px solid var(--line-2);
    border-radius:999px; padding:.35rem .75rem; cursor:pointer; user-select:none;
    white-space:nowrap; }
  .secim:has(input:checked) { border-color:var(--mavi); color:var(--ink); }
  .secim:hover { border-color:var(--mavi); }
  /* width:auto burada şart: paylaşılan stil dosyasında (stil.ts) her <input>
     için width:100% tanımlı. Bu kural olmadan checkbox flex satırında tüm
     genişliği kaplayacak şekilde büyüyor (Safari'de özellikle belirgin) ve
     yanındaki model adını/fiyatını görünmez kılıyor. Önceden yalnızca
     .yanpanelGovde içinde geçersiz kılınıyordu; Add person formu o sarmalayıcının
     dışında olduğu için bu hatayı alıyordu. */
  .secim input { accent-color:var(--mavi); margin:0; width:auto; }
  .secimKutu .secim .nokta-s { margin-right:0; }

  /* Model listesi hap yerine satır düzeninde.
     Her satırda modelin adı, fiyatı ve tavana göre durumu var; hap biçiminde
     nowrap olduğu için açıklamanın yarısı kesiliyordu. */
  .secimListe { display:block; }
  .secimListe .secim { display:flex; width:100%; white-space:normal;
    border-radius:8px; padding:.5rem .7rem; margin-bottom:.35rem;
    align-items:flex-start; line-height:1.45; }
  .secimListe .secim:last-child { margin-bottom:0; }
  /* Fiyat kuralıyla zaten açık olanlar: kutu boş olsa da çalışıyorlar. */
  .secimListe .secim.acik { background:var(--sunk); }
  /* İzin kutusundaki arama alanı. */
  .secimArama { flex:1; font:inherit; font-size:.85rem; padding:.4rem .6rem;
    border:1px solid var(--line-2); border-radius:8px;
    background:var(--surface); color:var(--ink); }
  .secimKutu > .secimListe { max-height:16rem; overflow-y:auto; }
  .secimListe .secim .hap { margin-left:.4rem; }
  /* Fiyat kuralıyla açılan modeller: karar değil, sonuç. */
  .rozet.fiyattan { opacity:.72; border-style:dashed; }
  /* Bütün model adları yazılıyor; sütun içinde sarmalı. */
  td .rozet { display:inline-block; margin:.1rem .25rem .1rem 0; }
  #kiTablo td:nth-child(2) { max-width:26rem; white-space:normal; }
  /* Şirket listesinde kapalı: işaretlemenin etkisi yok. */
  .secimListe .secim.engelli { opacity:.6; }
  /* Kilitli kutu normal görünüyor; yalnız imleç değişiyor. */
  .secimListe .secim input.kilit { cursor:default; }
  .secimListe .secim input { margin-top:.15rem; flex:none; }
  .secimListe .secim .yardim { margin-left:auto; padding-left:.9rem; text-align:right;
    flex:0 1 auto; min-width:0; overflow-wrap:break-word; }
  /* Flex öğelerinin varsayılan min-width:auto'su, uzun fiyat metninin küçülmeyi
     reddedip satırı devasa büyütmesine yol açıyordu — Safari'de Chrome'dan
     farklı hesaplanan bir davranış. min-width:0 küçülmeye izin veriyor. */
  .secimListe .secim .secimAd { min-width:0; overflow-wrap:break-word; }
  @media (max-width: 34rem) {
    .secimListe .secim { flex-wrap:wrap; }
    .secimListe .secim .yardim { margin-left:1.6rem; padding-left:0; text-align:left;
      flex-basis:100%; }
  }

  /* Teslim bağlantısı kutusu. */
  .ortuKatman { position:fixed; inset:0; z-index:80; display:flex;
    align-items:center; justify-content:center; padding:1.5rem;
    background:rgba(0,0,0,.55); }
  .ortuKart { width:100%; max-width:34rem; padding:1.5rem; border-radius:14px;
    background:var(--surface); border:1px solid var(--line-2);
    box-shadow:0 18px 48px rgba(0,0,0,.35); }

  /* Anahtar bir kez gösteriliyor; kırılmadan tamamı okunabilmeli. */
  .anahtarKutu { margin-top:.8rem; padding:.85rem 1rem; border-radius:10px;
    background:var(--sunk); border:1px solid var(--line-2); }
  .anahtarKutu code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:.82rem; color:var(--ink); word-break:break-all; line-height:1.6; }

  .yanpanelGovde input { padding:.6rem .8rem; font:inherit; font-size:.9rem;
    border:1px solid var(--line-2); border-radius:8px; background:var(--surface);
    color:var(--ink); width:100%; }
  .yanpanelGovde .secim input { width:auto; padding:0; }

  /* Kaydet çubuğu çekmecenin altına yapışık.
     Model listesi, fiyat tavanı ve bütçe alt alta durduğu için düğme
     ekranın dışında kalıyordu: kutucuk işaretlenip kaydedilmeden
     kapatılabiliyordu. */
  .kaydetCubugu { position:sticky; bottom:0; z-index:2;
    display:flex; gap:.6rem; align-items:center; flex-wrap:wrap;
    margin:1.1rem -1.4rem -1.4rem; padding:.9rem 1.4rem;
    background:var(--surface); border-top:1px solid var(--line-2); }
  .kaydetCubugu .degisti { font-size:.8rem; color:var(--mavi); margin-left:auto; }

  /* Kısa bildirim. Kaydetmenin bir şeyi düşürdüğünü söylemek için. */
  .bildirim { position:fixed; left:50%; bottom:1.6rem; transform:translateX(-50%);
    z-index:60; padding:.65rem 1.1rem; border-radius:999px; font-size:.85rem;
    background:var(--ink); color:var(--surface); box-shadow:0 6px 24px rgba(0,0,0,.28);
    opacity:0; transition:opacity .18s ease; pointer-events:none; }
  .bildirim.gorunur { opacity:1; }

  /* Dashboard */
  #oOzet { grid-template-columns:repeat(3,1fr); }
  @media (max-width:1180px) { #oOzet { grid-template-columns:repeat(2,1fr); } }
  @media (max-width:520px)  { #oOzet { grid-template-columns:1fr; } }
  .ikiSutun { display:grid; grid-template-columns:1fr 1fr; gap:1.25rem; margin-bottom:.5rem; }
  @media (max-width:1000px) { .ikiSutun { grid-template-columns:1fr; } }

  /* Sayıların yanındaki pay çubuğu: kim ne kadar harcıyor tek bakışta görünsün. */
  .oranCubuk { height:5px; border-radius:3px; background:var(--sunk); overflow:hidden; }
  .oranCubuk i { display:block; height:100%; background:var(--mavi); border-radius:3px; }

  .saglikSatir { display:flex; justify-content:space-between; align-items:center;
    gap:1.5rem; padding:.85rem 0; border-bottom:1px solid var(--line); }
  .saglikSatir:last-child { border-bottom:0; padding-bottom:0; }
  .saglikSatir:first-child { padding-top:0; }
  .saglikAd { font-size:.9rem; color:var(--ink); margin-bottom:.15rem; }
  .saglikSatir .hap { white-space:nowrap; }

  .aramaKutu { padding:.55rem .85rem; font:inherit; font-size:.9rem; width:20rem; max-width:100%;
    border:1px solid var(--line-2); border-radius:8px; background:var(--surface); color:var(--ink); }
  .aramaKutu:focus { outline:none; border-color:var(--mavi); }
  .onek { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.78rem;
    background:var(--sunk); padding:.1rem .4rem; border-radius:4px; }
  .onek.soluk { color:var(--ink-3); }

  /* Şifre kutusu.
     .dogrula'yı kullanıyordu ama o flex ve dikey ortalıyor; alan sıkışıyordu.
     Şifre yazarken hangi karakteri girdiğini görmek gerekiyor, o yüzden geniş
     ve tek aralıklı yazı tipiyle. Renkler iki temada da açıkça veriliyor. */
  .sifreKutu { display:block; margin-top:.8rem; padding:.9rem 1rem;
    border:1px solid var(--sari); border-radius:9px; background:var(--sari-soft); }
  .sifreKutu .sifreAlan { display:block; width:100%; margin-top:.5rem;
    padding:.65rem .85rem; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:1rem; letter-spacing:.02em;
    border:1px solid var(--line-2); border-radius:8px;
    background:var(--surface); color:var(--ink); }
  .sifreKutu .sifreAlan::placeholder { color:var(--ink-3); font-family:inherit;
    font-size:.9rem; letter-spacing:0; }
  .sifreKutu .sifreAlan:focus { outline:none; border-color:var(--mavi); }
  .sifreKutu .baslikkucuk { color:var(--ink); }
  .sifreKutu .yardim { color:var(--ink-3); }
  .sifreKutu .dugmeler { display:flex; gap:.6rem; margin-top:.8rem; }
  /* Ret mesajları tam gösteriliyor; hücreyi taşırmasın diye sarmalı. */
  .hataMetni { white-space:normal; text-align:left; line-height:1.45;
    max-width:32rem; display:inline-block; }
  .yanpanelGovde textarea { width:100%; padding:.6rem .8rem; font:inherit; font-size:.85rem;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; border:1px solid var(--line-2);
    border-radius:8px; background:var(--surface); color:var(--ink); resize:vertical; }
  .secimKutu button.secim { font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:.78rem; }
</style>
</head>
<body>

<div class="girisSayfa" id="girisEkran">
  <button class="temaKose" id="temaKose">
    <svg viewBox="0 0 24 24" id="temaKoseSimge"></svg>
    <span id="temaKoseYazi">Dark mode</span>
  </button>
  <div class="girisKutu">
    <div class="marka">
      <div class="markaSimge yon">AD</div>
      <div><div class="markaAd">AI Proxy</div></div>
    </div>
    <div class="kart">
      <div class="baslikkucuk">Admin Console</div>

      <div class="girisSekme" id="girisSekme">
        <button data-yol="hesap" class="secili">Email</button>
        <button data-yol="jeton">Token</button>
      </div>

      <div id="yolHesap">
        <label class="alanEtiket">Email
          <input id="yEposta" type="email" placeholder="you@company.com" autocomplete="username">
        </label>
        <label class="alanEtiket" style="margin-top:.7rem">Password
          <input id="ySifre" type="password" placeholder="••••••••••" autocomplete="current-password">
        </label>
        <button class="dugme koyu" id="btnHesap" style="width:100%;margin-top:.9rem">Sign in</button>
      </div>

      <div id="yolJeton" class="gizli">
        <div class="yardim" style="margin:.35rem 0 .9rem">
          The shared token still works. It is the way in if something goes wrong with
          accounts — but it cannot tell who did what.
        </div>
        <input id="jeton" type="password" placeholder="adm-..." autocomplete="off">
        <button class="dugme koyu" id="btn" style="width:100%;margin-top:.7rem">Sign in</button>
      </div>

      <div class="uyari gizli" id="hata"></div>
    </div>
  </div>
</div>

<div class="uygulama gizli" id="uygulama">
  <aside class="yanmenu">
    <div class="menuUst">
      <div class="marka" style="margin:0">
        <div class="markaSimge yon">AD</div>
        <div style="min-width:0">
          <div class="markaAd">AI Proxy</div>
          <div class="menuMusteri">Admin Console</div>
        </div>
      </div>
    </div>

    <div class="menuBaslik">Manage</div>
    <nav id="menu">
      <button data-bolum="ozet" class="secili">
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
        Dashboard</button>
      <button data-bolum="modeller">
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/></svg>
        Models</button>
      <button data-bolum="kisiler">
        <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6M17 11h5M19.5 8.5v5"/></svg>
        People</button>
      <button data-bolum="istekler">
        <svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
        Requests</button>
      <button data-bolum="yoneticiler">
        <svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.4-2.9 8.4-7 9.6C7.9 19.4 5 15.4 5 11V6z"/><path d="M9 12l2 2 4-4"/></svg>
        Administrators</button>
      <button data-bolum="fiyatlar">
        <svg viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Price audit</button>
    </nav>

    <div class="menuAlt">
      <nav>
        <button id="tema">
          <svg viewBox="0 0 24 24" id="temaSimge"></svg>
          <span id="temaYazi">Dark mode</span>
        </button>
        <button id="cikis">
          <svg viewBox="0 0 24 24"><path d="M15 4h4v16h-4M11 16l4-4-4-4M15 12H3"/></svg>
          Sign out</button>
      </nav>
    </div>
  </aside>

  <div class="icerikAlan">
    <div class="ustCubuk">
      <div>
        <h1 id="sayfaBaslik">Models</h1>
        <div class="altbilgi" id="sayfaAlt">Model catalog and pricing</div>
      </div>
      <div style="display:flex;gap:.6rem;align-items:center">
        <div class="segment gizli" id="filtre">
          <button data-gun="7">7 days</button>
          <button data-gun="30" class="secili">30 days</button>
          <button data-gun="0">All time</button>
        </div>
        <button class="dugme cerceveli" id="yenile">Refresh</button>
        <button class="dugme koyu" id="ekleAc">+ Add model</button>
        <button class="dugme koyu gizli" id="mEkleAc">+ Add person</button>
        <button class="dugme cerceveli gizli" id="disaAktar">Download CSV</button>
      </div>
    </div>

    <div class="govde">
      <div class="uyari gizli" id="jetonUyari">
        Signed in with the shared token. Only administrator accounts can be managed here —
        everything else needs an account, so the console can record who did what.
      </div>
      <div class="uyari gizli" id="uyari"></div>
      <div class="yukleniyor gizli" id="yukleniyor">Loading...</div>

      <section data-bolum="ozet">
        <div class="kart kartUyari gizli" id="oTalep" style="margin-bottom:1.25rem"></div>

        <div style="display:flex;justify-content:flex-end;margin-bottom:.6rem">
          <button class="dugme cerceveli" id="oYenile">Refresh</button>
        </div>
        <div class="metrikkart" id="oOzet" style="margin-bottom:1.25rem"></div>

        <div class="kart" style="margin-bottom:1.25rem">
          <div class="grafikUst">
            <div class="grafikbaslik" id="oGrafikBaslik">Daily spend</div>
            <div style="display:flex;align-items:center;gap:.85rem;flex-wrap:wrap">
              <div class="grafikOkuma" id="oGrafikOkuma"></div>
              <div class="segment" id="oFiltre">
                <button data-gun="7">7 days</button>
                <button data-gun="30" class="secili">30 days</button>
                <button data-gun="0">All time</button>
              </div>
            </div>
          </div>
          <div id="oGrafik"></div>
        </div>

        <div class="ikiSutun">
          <div>
            <div class="satirbasi" style="margin-top:0">
              <div class="baslikkucuk">Top customers</div>
              <div class="sayac" id="oMusteriSayac"></div>
            </div>
            <div class="tablokart">
              <div class="kaydir"><table id="oMusteriTablo"></table></div>
            </div>
          </div>
          <div>
            <div class="satirbasi" style="margin-top:0">
              <div class="baslikkucuk">Model usage</div>
              <div class="sayac" id="oModelSayac"></div>
            </div>
            <div class="tablokart">
              <div class="kaydir"><table id="oModelTablo"></table></div>
            </div>
          </div>
        </div>

        <div class="satirbasi">
          <div class="baslikkucuk">System health</div>
        </div>
        <div class="kart" id="oBakim"></div>
      </section>

      <section data-bolum="modeller" class="gizli">
      <div class="kart" style="margin-bottom:1.25rem">
        <div class="baslikkucuk" style="margin:0">How prices stay current</div>
        <div class="yardim" style="margin-top:.4rem;line-height:1.6">
          Every night at 03:00 each price is compared against two independent
          sources. When both agree, the new price is applied on its own &mdash;
          up or down, no approval needed. Spend is worked out from these
          numbers, so a stale price would quietly understate what we are
          actually spending.<br>
          Two cases still wait for a person, and they show up in
          <b>Price audit</b>: <b>a model only one source lists</b>, where there
          is nothing to cross-check against, and <b>a jump larger than 50%</b>,
          which is usually a glitch at the source.<br>
          <b>Set price</b> appears only on models no source carries at all.
          Everywhere else the nightly check owns the number.
        </div>
      </div>
      <div class="kart" style="margin-bottom:1.25rem">
        <div class="baslikkucuk" style="margin:0">How a model becomes usable</div>
        <div class="yardim" style="margin-top:.4rem;line-height:1.6">
          The nightly check adds every model it finds at the sources, with its
          price, and leaves it <b>in service</b>. Being in the catalog does not
          hand it to anyone &mdash; the <b>price limit</b> is what decides:
          under the limit it opens to whoever asks for it, above the limit the
          request is refused and lands on the Dashboard for your approval.<br>
          <b>Taking a model out of service</b> is the one manual override:
          nobody can call it, cheap or not, and the price limit never comes
          into it. Use it for a model you have decided against.
        </div>
      </div>
      <div class="satirbasi" style="margin-top:0">
        <div class="baslikkucuk">Models</div>
      </div>
      <div class="kart gizli" id="ekleKart" style="max-width:52rem;margin-bottom:1.25rem">
        <div class="baslikkucuk">Add a new model</div>
        <div class="yardim" style="margin:.35rem 0 1.2rem">
          Prices are entered per 1M tokens. New models start as inactive.
        </div>
        <div class="formSatir">
          <label>Provider
            <select id="yProvider">
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google</option>
            </select></label>
          <label>Model ID<input id="yModel" placeholder="gpt-5.5"></label>
          <label>Input price ($ / 1M)<input id="yGirdi" type="number" step="0.01" min="0" placeholder="2.50"></label>
          <label>Output price ($ / 1M)<input id="yCikti" type="number" step="0.01" min="0" placeholder="10.00"></label>
        </div>
        <div style="display:flex;gap:.6rem;margin-top:1.2rem">
          <button class="dugme koyu" id="ekleKaydet">Add model</button>
          <button class="dugme cerceveli" id="ekleIptal">Cancel</button>
        </div>
        <div class="uyari gizli" id="ekleHata"></div>
      </div>

      <div class="tablokart">
        <div class="kaydir"><table id="tablo"></table></div>
        <div class="bosdurum gizli" id="bos"></div>
      </div>
      <div class="yardim" style="margin-top:.8rem" id="altNot"></div>
      </section>

      <section data-bolum="kisiler" class="gizli">

        <div class="kart gizli" id="mEkleKart" style="max-width:52rem;margin-bottom:1.25rem">
          <div class="baslikkucuk">Add a person</div>
          <div class="yardim" style="margin:.35rem 0 1.2rem">
            They sign in to the portal with this address. A password is generated and
            shown once unless you set one.
          </div>
          <div class="formSatir">
            <label>Email<input id="kiEposta" placeholder="person@company.com"></label>
            <label>Password<input id="kiSifre" type="text" placeholder="optional"></label>
            <label>Role
              <select id="kiRol">
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </select></label>
          </div>
          <div class="yardim" style="margin-top:.7rem">
            Owners can manage people and keys. Everyone sees the company total either way.
          </div>

          <div class="bolumBaslik" style="margin-top:1.3rem;font-size:.85rem">
            Which models can they use?</div>
          <div class="secimKutu" id="kiModeller"></div>

          <div style="display:flex;gap:.6rem;margin-top:1.2rem">
            <button class="dugme koyu" id="kiEkleKaydet">Create person</button>
            <button class="dugme cerceveli" id="kiEkleIptal">Cancel</button>
          </div>
          <div class="uyari gizli" id="kiEkleHata"></div>
        </div>

        <div class="kart" id="politikaKart" style="margin-bottom:1.25rem"></div>

        <div class="satirbasi" style="margin-top:0">
          <div class="baslikkucuk">People</div>
          <div class="sayac" id="kiSayac"></div>
        </div>
        <div class="tablokart">
          <div class="kaydir"><table id="kiTablo"></table></div>
          <div class="bosdurum gizli" id="kiBos"></div>
        </div>
        <div class="yardim" style="margin-top:.8rem" id="kiAltNot"></div>

        <div class="satirbasi">
          <div class="baslikkucuk">Access requests</div>
          <div class="sayac" id="talepSayac"></div>
        </div>
        <div class="yardim" style="margin:-.3rem 0 .9rem">
          Someone called a model they could not use. Taken from rejected requests —
          no separate request form needed.
        </div>
        <div class="tablokart">
          <div class="kaydir"><table id="talepTablo"></table></div>
          <div class="bosdurum gizli" id="talepBos"></div>
        </div>

        <div class="satirbasi">
          <div class="baslikkucuk">Shared keys</div>
          <div class="sayac" id="ortakSayac"></div>
        </div>
        <div class="yardim" style="margin:-.3rem 0 .9rem">
          Keys with no owner — background services, cron jobs. Their spend counts
          towards the company but is not attributed to anyone.
        </div>
        <div class="tablokart">
          <div class="kaydir"><table id="ortakTablo"></table></div>
          <div class="bosdurum gizli" id="ortakBos"></div>
        </div>
      </section>

      <section data-bolum="yoneticiler" class="gizli">
        <div class="kart" style="max-width:52rem">
          <div class="baslikkucuk">Administrator accounts</div>
          <div class="yardim" style="margin:.35rem 0 1.1rem">
            Everyone here can sign in with their own email and password, so the console
            can tell who did what. The shared token still opens this page — but nothing
            else — as a way back in if accounts break.
          </div>
          <div id="yonListe"><div class="yardim">Loading...</div></div>
          <div class="formSatir" style="margin-top:1.1rem;grid-template-columns:1fr 1fr auto">
            <input id="yonEposta" placeholder="you@company.com">
            <input id="yonSifre" type="text" placeholder="password (optional)">
            <button class="dugme koyu" id="yonEkle">Add administrator</button>
          </div>
          <div class="yardim" style="margin-top:.4rem">
            Leave the password empty and one is generated for you. Either way it is
            shown once.
          </div>
          <div class="uyari gizli" id="yonHata"></div>
        </div>
      </section>

      <section data-bolum="fiyatlar" class="gizli">
        <div class="kart" id="fKaynak" style="margin-bottom:1.25rem"></div>

        <div class="satirbasi" style="margin-top:0">
          <div class="baslikkucuk">Catalog prices</div>
          <div class="sayac" id="fSayac"></div>
        </div>
        <div class="tablokart">
          <div class="kaydir"><table id="fTablo"></table></div>
        </div>
        <div class="yardim" style="margin-top:.8rem" id="fAltNot"></div>

        <div class="satirbasi">
          <div class="baslikkucuk">Recent activity</div>
          <div class="sayac" id="fOlaySayac"></div>
        </div>
        <div class="tablokart">
          <div class="kaydir"><table id="fOlayTablo"></table></div>
          <div class="bosdurum gizli" id="fOlayBos"></div>
        </div>
        <div class="yardim" style="margin-top:.8rem">
          The scheduled run happens daily at 03:00 and writes what it did here.
        </div>

        <div class="satirbasi">
          <div class="baslikkucuk">Requested but not in the catalog</div>
          <div class="sayac" id="fTalepSayac"></div>
        </div>
        <div class="tablokart">
          <div class="kaydir"><table id="fTalepTablo"></table></div>
          <div class="bosdurum gizli" id="fTalepBos"></div>
        </div>
        <div class="yardim" style="margin-top:.8rem">
          Taken from rejected requests: every 400 is a customer asking for a model we do not carry.
        </div>

        <div class="satirbasi">
          <div class="baslikkucuk">Failing at the provider</div>
          <div class="sayac" id="fHataSayac"></div>
        </div>
        <div class="tablokart">
          <div class="kaydir"><table id="fHataTablo"></table></div>
          <div class="bosdurum gizli" id="fHataBos"></div>
        </div>
        <div class="yardim" style="margin-top:.8rem">
          These models are active in our catalog but the provider rejects them —
          usually a sign the model was retired or renamed upstream.
        </div>
      </section>

      <section data-bolum="istekler" class="gizli">

        <div class="metrikkart" id="iOzet" style="margin-bottom:1rem"></div>

        <div class="satirbasi">
          <div class="baslikkucuk">Requests</div>
          <div class="sayac" id="iSayac"></div>
        </div>
        <div class="tablokart">
          <div class="kaydir"><table id="iTablo"></table></div>
          <div class="bosdurum gizli" id="iBos"></div>
        </div>
        <button class="dugme cerceveli gizli" id="iDaha" style="width:100%;margin-top:.75rem">Load more</button>
      </section>
    </div>
  </div>
</div>

<div class="perde gizli" id="perde"></div>
<aside class="yanpanel gizli" id="yanpanel">
  <div class="yanpanelUst">
    <div><h3 id="ypBaslik"></h3><div class="zaman" id="ypZaman"></div></div>
    <button class="kapat" id="ypKapat" aria-label="Close">&times;</button>
  </div>
  <div class="yanpanelGovde" id="ypGovde"></div>
</aside>

<script>
  let jeton = null, modeller = [];
  const $ = (id) => document.getElementById(id);
  const DEPO = 'proxy-admin';

  const AY = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
  const GUNES = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>';
  let temaSecimi = null;
  function temaUygula(secim) {
    const kok = document.documentElement;
    if (secim) kok.setAttribute('data-tema', secim); else kok.removeAttribute('data-tema');
    const koyu = secim ? secim === 'koyu' : matchMedia('(prefers-color-scheme: dark)').matches;
    const s = koyu ? GUNES : AY, y = koyu ? 'Light mode' : 'Dark mode';
    $('temaSimge').innerHTML = s; $('temaYazi').textContent = y;
    $('temaKoseSimge').innerHTML = s; $('temaKoseYazi').textContent = y;
  }
  function temaDegistir() {
    const kok = document.documentElement;
    const koyu = kok.getAttribute('data-tema') === 'koyu' ||
      (!kok.hasAttribute('data-tema') && matchMedia('(prefers-color-scheme: dark)').matches);
    temaSecimi = koyu ? 'acik' : 'koyu';
    try { localStorage.setItem('proxy-tema', temaSecimi); } catch (e) {}
    temaUygula(temaSecimi);
  }
  try { temaSecimi = localStorage.getItem('proxy-tema'); } catch (e) {}
  temaUygula(temaSecimi);

  const SAGLAYICI = { openai:'OpenAI', anthropic:'Anthropic', gemini:'Google' };
  const nokta = (p) => '<span class="nokta-s s-' + p + '"></span>';
  const milyon = (v) => v === null || v === undefined ? '—' : '$' + (Number(v) * 1000).toFixed(2);
  const gunTarih = (s) => s ? new Date(s).toLocaleDateString('en-GB',
    { day:'numeric', month:'short', year:'numeric' }) : '—';

  async function api(yol, secenek) {
    // Hesapla girildiyse jeton yok; kimlik çerezle taşınıyor.
    const bas = { 'content-type': 'application/json' };
    if (jeton) bas.authorization = 'Bearer ' + jeton;
    const c = await fetch('/admin/api' + yol, Object.assign({ headers: bas }, secenek || {}));

    // Oturum düştüyse ekranda "Unauthorized" bırakmak yerine giriş ekranına
    // dönüyoruz. En sık sebebi kendi şifreni sıfırlaman: şifre değişince
    // bütün oturumlar düşüyor, kendi oturumun dahil.
    if (c.status === 401) {
      oturumBitti();
      throw new Error('Your session ended. Sign in again.');
    }

    if (!c.ok) {
      const v = await c.json().catch(() => ({}));
      throw new Error(v.error || 'Request failed');
    }
    return c.json();
  }

  // Fiyatın nereden geldiğini tek bakışta söyleyen rozet.
  //
  // "Edit price neden var, fiyatlar zaten her gece güncellenmiyor mu"
  // sorusunun cevabı bu sütun: gece işi her fiyatı uygulamıyor. Zam,
  // tek kaynaklı model ve %50'yi aşan sıçrama insana bırakılıyor.
  function fiyatKaynagiHap(kaynak, kontrolTarihi) {
    if (kaynak === 'verified')
      return '<span class="hap ok" title="Both price sources agree">both sources</span>';
    if (kaynak === 'openrouter' || kaynak === 'litellm' || kaynak === 'source')
      return '<span class="hap" title="Only one source lists this model — ' +
        'changes wait for your approval">one source</span>';
    return '<span class="hap"' + (kontrolTarihi ? '' : ' style="opacity:.75"') +
      ' title="Typed in by hand. Nightly checks still compare it against the ' +
      'sources.">entered by hand</span>';
  }

  // Başlık yalnızca bir kez kuruluyor — her tabloCiz() çağrısında yeniden
  // kurulsaydı arama kutusuna yazarken her tuş vuruşunda kutu sıfırlanır,
  // imleç/odak kaybolurdu.
  //
  // Süzgeçler Excel'deki gibi: ayrı bir çubuk ya da satır değil, sütun
  // başlığının kendi içinde küçük bir ok. Ok'a tıklayınca o sütunun altına
  // bir panel açılıyor — panel <th>'nin kendi içinde durduğu için
  // (position:relative) ayrıca konumlandırma hesabı gerekmiyor.
  function mBaslikKur() {
    if ($('tablo').querySelector('thead')) return;

    const th = (etiket, sutun, panelIcerik) =>
      '<th class="sutunBaslik">' + etiket +
      (panelIcerik
        ? ' <button class="sutunOk" type="button" data-sutun="' + sutun + '">▾</button>' +
          '<div class="sutunFiltrePopup gizli" data-panel="' + sutun + '">' + panelIcerik +
          '<button class="temizle" type="button" data-temizle="' + sutun + '">Clear filter</button></div>'
        : '') +
      '</th>';

    $('tablo').innerHTML =
      '<thead><tr>' +
      th('Model', 'arama', '<input type="text" id="fArama" placeholder="Search models">') +
      th('Provider', 'saglayici',
        '<label><input type="checkbox" value="openai" checked> OpenAI</label>' +
        '<label><input type="checkbox" value="anthropic" checked> Anthropic</label>' +
        '<label><input type="checkbox" value="gemini" checked> Google</label>') +
      th('Input', 'girdi',
        '<div class="araGrubu"><input type="number" id="fGirdiMin" placeholder="Min" step="0.01" min="0">' +
        '<span>–</span><input type="number" id="fGirdiMax" placeholder="Max" step="0.01" min="0"></div>') +
      th('Output', 'cikti',
        '<div class="araGrubu"><input type="number" id="fCiktiMin" placeholder="Min" step="0.01" min="0">' +
        '<span>–</span><input type="number" id="fCiktiMax" placeholder="Max" step="0.01" min="0"></div>') +
      th('Price from', 'kaynak',
        '<label><input type="checkbox" value="verified" checked> Both sources</label>' +
        '<label><input type="checkbox" value="tek" checked> One source</label>' +
        '<label><input type="checkbox" value="elle" checked> Entered by hand</label>') +
      th('Last checked', 'kontrol',
        '<label><input type="radio" name="fKontrol" value="" checked> Any time</label>' +
        '<label><input type="radio" name="fKontrol" value="30"> Checked in last 30 days</label>' +
        '<label><input type="radio" name="fKontrol" value="90"> Stale (90+ days)</label>') +
      th('Status', 'durum',
        '<label><input type="checkbox" value="aktif" checked> In service</label>' +
        '<label><input type="checkbox" value="pasif" checked> Off</label>') +
      '<th></th>' +
      '</tr></thead><tbody></tbody>';

    // Ok'a tıklayınca ilgili panel açılır; açıkken tıklanırsa kapanır.
    // Başka bir yere tıklamak (ya da başka bir ok'a basmak) her zaman
    // açık olanı kapatıyor — aynı anda birden fazla panel açık durmuyor.
    $('tablo').querySelectorAll('.sutunOk').forEach(ok => {
      ok.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = $('tablo').querySelector('[data-panel="' + ok.dataset.sutun + '"]');
        const kapaliydi = panel.classList.contains('gizli');
        $('tablo').querySelectorAll('.sutunFiltrePopup').forEach(p => p.classList.add('gizli'));
        panel.classList.toggle('gizli', !kapaliydi);
      });
      ok.parentElement.querySelector('.sutunFiltrePopup')
        .addEventListener('click', (e) => e.stopPropagation());
    });
    document.addEventListener('click', () => {
      $('tablo').querySelectorAll('.sutunFiltrePopup').forEach(p => p.classList.add('gizli'));
    });

    $('tablo').querySelectorAll('.sutunFiltrePopup input').forEach(inp =>
      inp.addEventListener('input', tabloCiz));

    $('tablo').querySelectorAll('.temizle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = $('tablo').querySelector('[data-panel="' + btn.dataset.temizle + '"]');
        panel.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = true);
        panel.querySelectorAll('input[type="text"], input[type="number"]').forEach(i => i.value = '');
        panel.querySelectorAll('input[type="radio"]').forEach(r => r.checked = (r.value === ''));
        tabloCiz();
      });
    });
  }

  // fiyatKaynagiHap ile aynı üç kategori — "Price from" sütununun filtresi
  // ekranda görünenle birebir eşleşsin diye aynı ayrımı kullanıyor.
  function kaynakKategori(m) {
    if (m.fiyatKaynagi === 'verified') return 'verified';
    if (['openrouter', 'litellm', 'source'].includes(m.fiyatKaynagi)) return 'tek';
    return 'elle';
  }

  function tabloCiz() {
    if (!modeller.length) {
      $('tablo').innerHTML = '';
      $('bos').innerHTML = '<div class="simge">◷</div><h3>No models yet</h3>' +
        '<p>Add the first model to get started.</p>';
      $('bos').classList.remove('gizli');
      $('altNot').textContent = '';
      return;
    }
    $('bos').classList.add('gizli');
    mBaslikKur();

    // Her sütunun kendi paneli kendi süzgecini taşıyor. Bir onay kutusu
    // grubunda hepsi işaretliyse (varsayılan durum) o sütun hiç süzmüyor
    // demektir — kullanıcı en az birini kaldırınca gerçek süzgeç başlıyor.
    const arama = ($('fArama') ? $('fArama').value : '').trim().toLowerCase();
    const isaretli = (panel) => new Set(
      [...$('tablo').querySelectorAll('[data-panel="' + panel + '"] input:checked')]
        .map(c => c.value));
    const saglayiciSecili = isaretli('saglayici');
    const kaynakSecili = isaretli('kaynak');
    const durumSecili = isaretli('durum');
    const sayiDegeri = (id) => {
      const el = $(id);
      return el && el.value !== '' ? Number(el.value) : null;
    };
    const girdiMin = sayiDegeri('fGirdiMin'), girdiMax = sayiDegeri('fGirdiMax');
    const ciktiMin = sayiDegeri('fCiktiMin'), ciktiMax = sayiDegeri('fCiktiMax');
    const kontrolRadyo = $('tablo').querySelector('[data-panel="kontrol"] input:checked');
    const kontrolSecim = kontrolRadyo ? kontrolRadyo.value : '';
    const simdi = Date.now();

    const suz = (l) => l.filter(m => {
      if (arama && !(m.provider + '/' + m.model).toLowerCase().includes(arama)) return false;
      if (saglayiciSecili.size < 3 && !saglayiciSecili.has(m.provider)) return false;
      if (girdiMin !== null && (m.input_price ?? -1) < girdiMin) return false;
      if (girdiMax !== null && (m.input_price ?? Infinity) > girdiMax) return false;
      if (ciktiMin !== null && (m.output_price ?? -1) < ciktiMin) return false;
      if (ciktiMax !== null && (m.output_price ?? Infinity) > ciktiMax) return false;
      if (kaynakSecili.size < 3 && !kaynakSecili.has(kaynakKategori(m))) return false;
      if (kontrolSecim) {
        const gunSayisi = m.price_checked_at
          ? (simdi - new Date(m.price_checked_at).getTime()) / 86400000 : Infinity;
        if (kontrolSecim === '30' && gunSayisi > 30) return false;
        if (kontrolSecim === '90' && gunSayisi < 90) return false;
      }
      if (durumSecili.size < 2 && !durumSecili.has(m.is_active ? 'aktif' : 'pasif')) return false;
      return true;
    });
    const gosterilen = suz(modeller);

    $('tablo').querySelector('tbody').innerHTML =
      gosterilen.map(m =>
        '<tr data-id="' + m.id + '">' +
        '<td>' + nokta(m.provider) + m.model + '</td>' +
        '<td>' + (SAGLAYICI[m.provider] || m.provider) + '</td>' +
        '<td class="sayi">' + milyon(m.input_price) + '</td>' +
        '<td class="sayi">' + milyon(m.output_price) + '</td>' +
        '<td>' + fiyatKaynagiHap(m.fiyatKaynagi, m.price_checked_at) + '</td>' +
        '<td class="sayi">' + gunTarih(m.price_checked_at) + '</td>' +
        '<td>' + (m.is_active
          ? '<span class="hap ok">in service</span>'
          : '<span class="hap" title="Nobody can call this model until you ' +
            'switch it on">off</span>') + '</td>' +
        '<td class="islem">' +
          // Kaynaklar modeli tanıyorsa fiyatı gece işi yönetiyor; elle
          // düzenleme düğmesi orada yalnızca yanlış rakam girme fırsatı
          // olurdu. Düğme sadece hiçbir kaynağın tanımadığı satırlarda —
          // orada insandan başka bilgi verecek kimse yok.
          (m.fiyatKaynagi === 'manual'
            ? '<button class="satirDugme" data-eylem="fiyat">Set price</button>'
            : '') +
          '<button class="satirDugme' + (m.is_active ? ' tehlike' : '') + '" data-eylem="durum"' +
            ' title="' + (m.is_active
              ? 'Take it out of service — nobody will be able to call it'
              : 'Put it into service — the price limit then decides who may call it') + '">' +
            (m.is_active ? 'Take out of service' : 'Put into service') + '</button>' +
        '</td></tr>'
      ).join('');

    const aktifSayisi = modeller.filter(m => m.is_active).length;
    const pasifSayi = modeller.filter(m => !m.is_active).length;
    const fiyatsiz = modeller.filter(m => m.input_price === null || m.output_price === null).length;
    $('altNot').textContent =
      gosterilen.length + ' of ' + modeller.length + ' shown · ' +
      aktifSayisi + ' in service · ' + pasifSayi + ' taken out of service' +
      (fiyatsiz ? ' · ' + fiyatsiz + ' without a price — these cannot be activated' : '');
  }

  // ---------------- bölüm geçişi ----------------
  const BASLIK = {
    ozet:       ['Dashboard', 'Traffic, spend and system health'],
    modeller:   ['Models',    'Model catalog and pricing'],
    kisiler:    ['People',    'Who can use the gateway, and what they can reach'],
    istekler:   ['Requests',  'All requests across customers'],
    fiyatlar:     ['Price audit', 'Stored prices checked against a live source'],
    yoneticiler:  ['Administrators', 'Who can sign in to this console']
  };
  let bolum = 'ozet';

  let bildirimZaman = null;
  function bildir(metin) {
    let e = $('bildirim');
    if (!e) {
      e = document.createElement('div');
      e.id = 'bildirim'; e.className = 'bildirim';
      document.body.appendChild(e);
    }
    e.textContent = metin;
    e.classList.add('gorunur');
    clearTimeout(bildirimZaman);
    bildirimZaman = setTimeout(() => e.classList.remove('gorunur'), 2600);
  }

  function bolumGoster(yeni) {
    bolum = yeni;
    document.querySelectorAll('#menu button').forEach(b =>
      b.classList.toggle('secili', b.dataset.bolum === yeni));
    document.querySelectorAll('section[data-bolum]').forEach(s =>
      s.classList.toggle('gizli', s.dataset.bolum !== yeni));
    $('sayfaBaslik').textContent = BASLIK[yeni][0];
    $('sayfaAlt').textContent = BASLIK[yeni][1];
    $('ekleAc').classList.toggle('gizli', yeni !== 'modeller');
    $('mEkleAc').classList.toggle('gizli', false);
    $('mEkleAc').classList.toggle('gizli', yeni !== 'kisiler');
    $('disaAktar').classList.toggle('gizli', yeni !== 'istekler');
    // Dashboard artık kendi dönem seçicisini (grafiğin yanında) ve kendi
    // Refresh düğmesini (kartların üstünde) kullanıyor — üst çubuktaki
    // ortak olanlar yalnızca Requests sayfasında kalıyor.
    $('filtre').classList.toggle('gizli', yeni !== 'istekler');
    $('yenile').classList.toggle('gizli', yeni === 'ozet');
    if (yeni === 'ozet') { gunSekmeSenkron(); }
    // Sekmeye her girişte baştan yükleniyor. Önce yalnızca istekYukle
    // çağrılıyordu ama offset korunuyordu: "Load more" bastıysan sonraki
    // sayfayı çekiyor, yeni gelen istekler görünmüyordu.
    if (yeni === 'istekler') { offset = 0; iSatirlar = []; istekYukle(false); }
    if (yeni === 'kisiler') kisilerYukle();
    if (yeni === 'ozet') ozetYukle();
    if (yeni === 'fiyatlar') fiyatYukle();
    if (yeni === 'yoneticiler') yoneticileriYukle();
    // Models de her girişte tazeleniyor. Bellekte tutulsaydı, fiyat denetimi
    // ekranından yapılan bir değişiklikten sonra burada eski değer kalırdı.
    if (yeni === 'modeller' && modeller.length) yukle();
  }

  $('menu').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || !b.dataset.bolum) return;
    bolumGoster(b.dataset.bolum);
  });

  // ---------------- istekler ----------------
  let gun = 30, offset = 0, iToplam = 0, iSatirlar = [], fiyatlar = {}, musteriler = [];

  const para = (n) => { const v = Number(n);
    return '$' + (v === 0 ? '0.00' : v < 0.001 ? v.toFixed(6) : v < 1 ? v.toFixed(4) : v.toFixed(2)); };
  const bin = (n) => Number(n).toLocaleString('en-GB');
  // Müşteri adları veritabanından geliyor; HTML'e basmadan önce kaçırıyoruz.
  const kacir = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const tarih = (s) => new Date(s).toLocaleString('en-GB',
    { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });

  function durumHapi(k) {
    if (k.status === 'success') return '<span class="hap ok">success</span>';
    if (k.status === 'pending') return '<span class="hap bek">pending</span>';
    // Tam metin gösteriliyor: ret mesajları artık müşteriye ne yapması
    // gerektiğini anlatıyor, kesilince asıl bilgi kayboluyordu.
    // Hücre genişliği CSS'te sınırlı, uzun metin satır atlıyor.
    // Sebebi kaydedilmemiş eski kayıtlar var (error_message kolonu bağlanmadan
    // önce yazılmışlar). "error" demek yerine neden bilinmediğini söylüyoruz.
    return '<span class="hap err hataMetni">' +
      (k.error_message
        ? kacir(k.error_message)
        : 'error — reason was not recorded') + '</span>';
  }

  // Başlık ve süzgeç satırı yalnızca bir kez kuruluyor.
  //
  // Süzgeçler tablonun içine taşındı: sütun adının altında duran kutu,
  // sayfanın tepesindeki ayrı çubuktan daha okunur — hangi sütunu süzdüğün
  // bakınca belli oluyor. Bunun için başlık ile gövdeyi ayrı yönetmek
  // gerekiyor, yoksa her yüklemede kutular sıfırlanırdı.
  // Süzgeçler Models tablosundakiyle aynı desen: sütun başlığının içinde
  // küçük bir ok, tıklayınca altına açılan bir panel — ayrı bir satır ya da
  // sayfanın tepesinde ayrı bir çubuk değil. Time/Input/Output/Latency/Cost
  // sütunlarında ok yok: Time zaten sayfanın üstündeki dönem seçiciyle
  // (7/30/All time) kapsanıyor, diğer dördü için sunucu tarafında henüz
  // aralık süzgeci desteği yok — eklemek ayrı bir iş.
  function iBaslikKur() {
    if ($('iTablo').querySelector('thead')) return;
    const kutuStil = 'width:100%;font:inherit;font-size:.8rem;padding:.35rem .5rem;' +
      'border:1px solid var(--line-2);border-radius:6px;' +
      'background:var(--sunk);color:var(--ink)';
    const ok = (sutun, panelIcerik) =>
      ' <button class="sutunOk" type="button" data-sutun="' + sutun + '">▾</button>' +
      '<div class="sutunFiltrePopup gizli" data-panel="' + sutun + '" style="min-width:14rem">' +
      panelIcerik + '</div>';

    $('iTablo').innerHTML =
      '<thead><tr>' +
      '<th>Time</th>' +
      '<th class="sutunBaslik">Person' + ok('kisi',
        '<select id="fKisi" style="' + kutuStil + '"><option value="">Everyone</option></select>') +
      '</th>' +
      '<th class="sutunBaslik">Provider' + ok('saglayici',
        '<select id="fSaglayici" style="' + kutuStil + '">' +
          '<option value="">All providers</option>' +
          '<option value="openai">OpenAI</option>' +
          '<option value="anthropic">Anthropic</option>' +
          '<option value="gemini">Google</option></select>') +
      '</th>' +
      '<th class="sutunBaslik">Model' + ok('model',
        '<select id="fModel" style="' + kutuStil + '">' +
          '<option value="">All models</option></select>') +
      '</th>' +
      '<th>Input</th><th>Output</th><th>Latency</th><th>Cost</th>' +
      '<th class="sutunBaslik">Status' + ok('durum',
        '<select id="fDurum" style="' + kutuStil + '">' +
          '<option value="">All</option>' +
          '<option value="success">Success</option>' +
          '<option value="error">Error</option>' +
          '<option value="pending">Pending</option></select>') +
      '</th>' +
      '</tr></thead><tbody></tbody>';

    ['fKisi', 'fSaglayici', 'fDurum', 'fModel'].forEach(id =>
      $(id).addEventListener('change', () => {
        offset = 0; iSatirlar = []; istekYukle(false);
      }));

    $('iTablo').querySelectorAll('.sutunOk').forEach(dugme => {
      dugme.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = $('iTablo').querySelector('[data-panel="' + dugme.dataset.sutun + '"]');
        const kapaliydi = panel.classList.contains('gizli');
        $('iTablo').querySelectorAll('.sutunFiltrePopup').forEach(p => p.classList.add('gizli'));
        panel.classList.toggle('gizli', !kapaliydi);
      });
      dugme.parentElement.querySelector('.sutunFiltrePopup')
        .addEventListener('click', (e) => e.stopPropagation());
    });
    document.addEventListener('click', () => {
      $('iTablo').querySelectorAll('.sutunFiltrePopup').forEach(p => p.classList.add('gizli'));
    });
  }

  function iSatirCiz(kayitlar, ekle) {
    if (ekle) iSatirlar = iSatirlar.concat(kayitlar); else iSatirlar = kayitlar.slice();
    const bas = ekle ? iSatirlar.length - kayitlar.length : 0;
    const g = kayitlar.map((k, i) =>
      '<tr class="tiklanir" data-i="' + (bas + i) + '">' +
      '<td class="sayi">' + tarih(k.created_at) + '</td>' +
      '<td>' + (k.kisi
        ? kacir(k.kisi)
        : '<span class="yardim" title="Sent with a key that belongs to no one">' +
          (k.anahtarAdi ? kacir(k.anahtarAdi) : 'shared key') + '</span>') + '</td>' +
      '<td>' + nokta(k.provider) + (SAGLAYICI[k.provider] || k.provider) + '</td>' +
      '<td>' + k.model + '</td>' +
      '<td class="sayi">' + (k.input_tokens ?? 0) + '</td>' +
      '<td class="sayi">' + (k.output_tokens ?? 0) + '</td>' +
      '<td class="sayi">' + (k.latency_ms ?? 0) + ' ms</td>' +
      '<td class="sayi">' + para(k.cost ?? 0) + '</td>' +
      '<td>' + durumHapi(k) + '</td></tr>').join('');
    iBaslikKur();
    const govde = $('iTablo').querySelector('tbody');
    if (ekle) govde.insertAdjacentHTML('beforeend', g);
    else govde.innerHTML = g;
  }

  async function istekYukle(ekle) {
    $('uyari').classList.add('gizli');
    if (!ekle && !iSatirlar.length) $('yukleniyor').classList.remove('gizli');
    try {
      iBaslikKur();
      const s = new URLSearchParams({ gun: String(gun), offset: String(offset) });
      if ($('fKisi').value)      s.set('kisi',     $('fKisi').value);
      if ($('fSaglayici').value) s.set('provider', $('fSaglayici').value);
      if ($('fDurum').value)     s.set('durum',    $('fDurum').value);
      if ($('fModel').value)     s.set('model',    $('fModel').value);

      const v = await api('/requests?' + s.toString());
      fiyatlar = v.fiyatlar || fiyatlar;
      iToplam = v.toplam;

      if (!ekle) {
        // Liste döneme göre değişiyor (yalnızca isteği olan müşteriler), o yüzden
        // her yüklemede yeniden kuruluyor. Seçim korunuyor.
        if (v.kisiler) {
          const secili = $('fKisi').value;
          let secim = v.kisiler.slice();
          // Seçili kişi yeni listede yoksa seçim düşmesin diye ekliyoruz.
          if (secili && !secim.some(m => m.deger === secili)) {
            secim = secim.concat([{ deger: secili, label: secili + ' (0)' }]);
          }
          $('fKisi').innerHTML = '<option value="">Everyone</option>' +
            secim.map(m => '<option value="' + kacir(m.deger) + '">' +
              kacir(m.label) + '</option>').join('');
          $('fKisi').value = secili;
        }
        const o = v.ozet;
        const kart = (ad, deger, aciklama) => '<div class="metrik"><div class="ad">' + ad +
          '</div><div class="aciklama">' + aciklama + '</div><div class="sayi">' + deger + '</div></div>';
        $('iOzet').innerHTML =
          kart('Requests', bin(o.istek), 'in selected range') +
          kart('Errors', bin(o.hata), 'rejected or failed') +
          kart('Tokens', bin(o.token), 'input + output') +
          kart('Cost', para(o.maliyet), 'total amount');
      }

      if (!v.kayitlar.length && !ekle) {
        $('iTablo').innerHTML = '';
        $('iBos').innerHTML = '<div class="simge">◷</div><h3>No requests</h3>' +
          '<p>Nothing matches the selected filters.</p>';
        $('iBos').classList.remove('gizli');
        $('iSayac').textContent = ''; $('iDaha').classList.add('gizli');
      } else {
        $('iBos').classList.add('gizli');
        iSatirCiz(v.kayitlar, ekle);
        const gosterilen = offset + v.kayitlar.length;
        $('iSayac').textContent = gosterilen + ' / ' + iToplam;
        $('iDaha').classList.toggle('gizli', gosterilen >= iToplam);
      }
    } catch (e) {
      $('uyari').textContent = 'Could not load requests. ' + e.message;
      $('uyari').classList.remove('gizli');
    } finally { $('yukleniyor').classList.add('gizli'); }
  }

  // Dönem seçici artık iki yerde var: #filtre (Requests, üst çubukta) ve
  // #oFiltre (Dashboard, grafiğin yanında). İkisi de aynı paylaşılan gun
  // değişkenini kullanıyor — biri değişince öbürü de görsel olarak
  // senkron kalsın diye tek yerden güncelleniyor.
  function gunSekmeSenkron() {
    [$('filtre'), $('oFiltre')].forEach(el => {
      if (!el) return;
      [...el.children].forEach(b =>
        b.classList.toggle('secili', Number(b.dataset.gun) === gun));
    });
  }
  function gunSec(yeniGun) {
    gun = yeniGun; offset = 0; iSatirlar = [];
    gunSekmeSenkron();
    if (bolum === 'ozet') ozetYukle(); else istekYukle(false);
  }
  $('filtre').addEventListener('click', e => {
    const d = e.target.closest('button'); if (!d) return;
    gunSec(Number(d.dataset.gun));
  });
  $('oFiltre').addEventListener('click', e => {
    const d = e.target.closest('button'); if (!d) return;
    gunSec(Number(d.dataset.gun));
  });
  $('oYenile').addEventListener('click', ozetYukle);
  $('iDaha').addEventListener('click', async () => {
    $('iDaha').disabled = true; $('iDaha').textContent = 'Loading...';
    offset += 50; await istekYukle(true);
    $('iDaha').disabled = false; $('iDaha').textContent = 'Load more';
  });

  // ---------------- istek detayı: hesap doğrulama ----------------
  // Teslim bağlantısını gösteren kutu.
  //
  // alert() yerine gerçek bir kart: bağlantı uzun, seçilebilir olmalı ve
  // kopyalama düğmesi lazım. Ayrıca bunun bir ANAHTAR olmadığını yazmak
  // gerekiyor — yanlışlıkla "anahtar bu" diye saklanmasın.
  function teslimBagiGoster(eposta, bag, sonKullanma) {
    const kutu = document.createElement('div');
    kutu.className = 'ortuKatman';
    kutu.innerHTML =
      '<div class="ortuKart">' +
      '<div class="baslikkucuk">Key created for ' + kacir(eposta) + '</div>' +
      '<div class="yardim" style="margin:.4rem 0 1rem;line-height:1.6">' +
      'The key itself was not shown to you and cannot be recovered from here. ' +
      'Send the link below to ' + kacir(eposta) + '. They open it while signed ' +
      'in to the portal and the key appears once.<br>' +
      'The link opens a single time' +
      (sonKullanma ? ' and expires on ' +
        new Date(sonKullanma).toLocaleString('en-GB',
          { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') +
      '.</div>' +
      '<div class="anahtarKutu"><code id="teslimBag">' + kacir(bag) + '</code></div>' +
      '<div style="display:flex;gap:.6rem;margin-top:1rem;align-items:center">' +
      '<button class="dugme koyu" id="teslimKopyala">Copy link</button>' +
      '<button class="dugme cerceveli" id="teslimKapat">Done</button>' +
      '<span class="yardim" id="teslimNot"></span></div></div>';
    document.body.appendChild(kutu);

    kutu.querySelector('#teslimKopyala').onclick = async () => {
      try {
        await navigator.clipboard.writeText(bag);
        kutu.querySelector('#teslimNot').textContent = 'Copied';
      } catch {
        // Panoya erişim engelliyse seçmek de bir yol.
        const r = document.createRange();
        r.selectNodeContents(kutu.querySelector('#teslimBag'));
        const sec = window.getSelection();
        sec.removeAllRanges(); sec.addRange(r);
        kutu.querySelector('#teslimNot').textContent = 'Selected — copy it';
      }
    };
    kutu.querySelector('#teslimKapat').onclick = () => kutu.remove();
  }

  function detayAc(k) {
    const ad = k.provider + '/' + k.model;
    const f = fiyatlar[ad];
    const gi = k.input_tokens ?? 0, ci = k.output_tokens ?? 0;
    const kayitli = Number(k.cost ?? 0);

    $('ypBaslik').innerHTML = nokta(k.provider) + ad;
    $('ypZaman').textContent = (k.musteri ? k.musteri + ' · ' : '') +
      new Date(k.created_at).toLocaleString('en-GB',
        { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit', second:'2-digit' });

    let govde = '<div class="bolumBaslik">Summary</div><dl class="ozellik">' +
      '<dt>Status</dt><dd>' + durumHapi(k) + '</dd>' +
      '<dt>Latency</dt><dd>' + (k.latency_ms ?? 0) + ' ms</dd>' +
      '<dt>Input tokens</dt><dd>' + bin(gi) + '</dd>' +
      '<dt>Output tokens</dt><dd>' + bin(ci) + '</dd></dl>';

    if (k.status === 'error') {
      govde += '<div class="bolumBaslik">Why it was rejected</div>' +
        (k.error_message
          ? '<div class="dogrula err">' + kacir(k.error_message) + '</div>'
          : '<div class="dogrula bek">The reason was not recorded. This request ' +
            'predates error logging.</div>');
    }

    if (k.status === 'pending') {
      govde += '<div class="bolumBaslik">Cost</div>' +
        '<div class="dogrula bek">This request was not fully recorded. ' +
        'Token counts and cost are missing.</div>';
    } else if (k.status === 'error' && !(k.input_tokens || k.output_tokens)) {
      // Reddedilen istekte hesaplanacak bir şey yok. Fiyat eksikliği mesajı
      // burada yanıltıcıydı: sorun fiyatın olmaması değil, isteğin hiç
      // çalışmamış olması.
      govde += '<div class="bolumBaslik">Cost</div>' +
        '<div class="dogrula bek">No cost — the request was rejected before it ' +
        'reached the provider, so no tokens were used.</div>';
    } else if (!f) {
      govde += '<div class="bolumBaslik">Cost</div>' +
        '<div class="dogrula err">⚠ No price defined for this model, cost cannot be computed.</div>';
    } else {
      // Kaydın kendi fiyatı varsa onunla doğruluyoruz. Bugünkü fiyatla
      // hesaplamak, fiyat sonradan değiştiyse doğru kaydı yanlış gösteriyordu.
      const kayitliFiyat = k.input_price_used !== null && k.input_price_used !== undefined
        ? { input: Number(k.input_price_used), output: Number(k.output_price_used ?? 0) }
        : null;
      const kullanilan = kayitliFiyat || f;

      const gm = (gi / 1000) * kullanilan.input, cm = (ci / 1000) * kullanilan.output;
      const yeni = gm + cm;
      const uyar = Math.abs(yeni - kayitli) < 0.0000005;

      // Kaydın fiyatı bugünkü katalog fiyatından farklıysa bunu ayrıca
      // belirtiyoruz: kayıt doğru ama fiyat o tarihten sonra değişmiş.
      const fiyatDegismis = kayitliFiyat &&
        (Math.abs(kayitliFiyat.input - f.input) > 0.0000001 ||
         Math.abs(kayitliFiyat.output - f.output) > 0.0000001);

      govde += '<div class="bolumBaslik">Cost breakdown</div><div class="hesap">' +
        '<div class="sat"><span>input ' + bin(gi) + ' ÷ 1000 × $' + kullanilan.input + '</span><span>' + para(gm) + '</span></div>' +
        '<div class="sat"><span>output ' + bin(ci) + ' ÷ 1000 × $' + kullanilan.output + '</span><span>' + para(cm) + '</span></div>' +
        '<div class="cizgi"></div>' +
        '<div class="sat toplam"><span>recomputed</span><span>' + para(yeni) + '</span></div>' +
        '<div class="sat toplam"><span>stored value</span><span>' + para(kayitli) + '</span></div></div>' +
        (uyar
          ? '<div class="dogrula ok">✓ Verified — recomputed from the price recorded with this request.</div>'
          : '<div class="dogrula err">✗ Mismatch between the stored cost and the recomputed value.</div>') +
        (fiyatDegismis
          ? '<div class="dogrula bek">The catalog price has changed since this request: ' +
            'now $' + f.input + ' / $' + f.output + ' per 1K. Past records are not restated.</div>'
          : '') +
        (!kayitliFiyat
          ? '<div class="yardim" style="margin-top:.6rem">This record predates price tracking, ' +
            'so the check uses the current catalog price and may not reflect what was charged.</div>'
          : '');
    }

    $('ypGovde').innerHTML = govde;
    panelAc();
  }

  function panelAc() {
    $('perde').classList.remove('gizli'); $('yanpanel').classList.remove('gizli');
    requestAnimationFrame(() => {
      $('perde').classList.add('acik'); $('yanpanel').classList.add('acik');
    });
  }
  function detayKapat() {
    $('perde').classList.remove('acik'); $('yanpanel').classList.remove('acik');
    setTimeout(() => { $('perde').classList.add('gizli'); $('yanpanel').classList.add('gizli'); }, 180);
  }
  $('perde').addEventListener('click', detayKapat);
  $('ypKapat').addEventListener('click', detayKapat);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') detayKapat(); });
  $('iTablo').addEventListener('click', e => {
    const tr = e.target.closest('tr.tiklanir'); if (!tr) return;
    const k = iSatirlar[Number(tr.dataset.i)]; if (k) detayAc(k);
  });


  // Model kutucukları. Katalogdaki aktif modellerden kuruluyor; fiyatı da
  // yazıyor ki "hangisi pahalı" görünsün.
  // Model izin kutusu.
  //
  // Katalog 100'ü aştıktan sonra düz liste kullanılamaz hale geldi: aradığın
  // modeli bulmak için kaydırmak gerekiyordu. Üç şey değişti — arama kutusu,
  // işaretlilerin üste alınması ve seçimin BELLEKTE tutulması.
  //
  // Seçimin bellekte tutulması şart: liste süzülünce görünmeyen satırların
  // kutuları DOM'dan siliniyor. Seçimi DOM'dan okusaydık, arama yapıp
  // kaydeden biri görünmeyen bütün izinleri sessizce silerdi.
  const secimDurumu = new Map();

  function modelSecimKutusu(kapsayici, secili, tavan) {
    const aktif = modeller.filter(m => m.is_active);
    if (!aktif.length) {
      kapsayici.innerHTML = '<div class="yardim">No active models in the catalog yet.</div>';
      return;
    }

    const secim = new Set(secili);
    secimDurumu.set(kapsayici.id, secim);
    let arama = '';

    const ciz = () => {
      const tavanVar = tavan !== null && tavan !== undefined;
      const eslesen = aktif.filter(m =>
        !arama || (m.provider + '/' + m.model).toLowerCase().includes(arama));

      // İşaretliler üstte: kişiye verilmiş izinler asıl bakılan şey, aramanın
      // altında kaybolmamalı. Sonra fiyata göre ucuzdan pahalıya.
      const sirali = eslesen.slice().sort((a, b) => {
        const sa = secim.has(a.provider + '/' + a.model) ? 0 : 1;
        const sb = secim.has(b.provider + '/' + b.model) ? 0 : 1;
        return sa - sb || (a.output_price || 0) - (b.output_price || 0);
      });

      const satirlar = sirali.map(m => {
        const anahtar = m.provider + '/' + m.model;
        const fiyat = (m.output_price || 0) * 1000;
        const isaretli = secim.has(anahtar);
        const ucuz = tavanVar && fiyat <= tavan;
        return '<label class="secim">' +
          '<input type="checkbox" value="' + kacir(anahtar) + '"' +
          (isaretli ? ' checked' : '') + '>' +
          nokta(m.provider) + '<span class="secimAd">' + kacir(m.model) + '</span>' +
          ' <span class="yardim">$' + fiyat.toFixed(2) + '/1M' +
          (isaretli
            ? ''
            : ucuz
              ? ' &middot; under the limit — opens by itself the first time they ask for it'
              : tavanVar
                ? ' &middot; over the limit — tick to grant it'
                : ' &middot; no price limit set, so only a tick opens it') +
          '</span></label>';
      }).join('');

      kapsayici.innerHTML =
        '<div class="yardim" style="margin:0 0 .5rem">' +
        'Prices are dollars per million output tokens. A model under the price ' +
        'limit opens on its own the first time this person asks for it; anything ' +
        'above the limit needs a tick here.</div>' +
        '<div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.6rem">' +
        '<input class="secimArama" placeholder="Search models" value="' + kacir(arama) + '">' +
        '<span class="yardim secimSayac" style="white-space:nowrap">' +
        secim.size + ' ticked · ' + eslesen.length +
        (arama ? ' of ' + aktif.length : '') + ' shown</span></div>' +
        '<div class="secimListe">' +
        (sirali.length ? satirlar : '<div class="yardim">No model matches that.</div>') +
        '</div>';

      const kutu = kapsayici.querySelector('.secimArama');
      kutu.addEventListener('input', () => {
        arama = kutu.value.trim().toLowerCase();
        const konum = kutu.selectionStart;
        ciz();
        const yeni = kapsayici.querySelector('.secimArama');
        yeni.focus(); yeni.setSelectionRange(konum, konum);
      });

      // Tik değiştiğinde belleğe yazıyoruz ama yeniden çizmiyoruz: sıralama
      // işaretlileri üste aldığı için satır parmağın altından kayardı.
      const sayacKutusu = kapsayici.querySelector('.secimSayac');
      kapsayici.querySelectorAll('input[type=checkbox]').forEach(i => {
        i.addEventListener('change', () => {
          if (i.checked) secim.add(i.value); else secim.delete(i.value);
          sayacKutusu.textContent = secim.size + ' ticked · ' + eslesen.length +
            (arama ? ' of ' + aktif.length : '') + ' shown';
        });
      });
    };

    kapsayici.classList.remove('secimListe');
    ciz();
  }

  const secilenModeller = (kapsayici) => {
    const secim = secimDurumu.get(kapsayici.id);
    return secim ? [...secim] : [];
  };

  // ---------------- kişiler ----------------
  //
  // Panelin ana ekranı. Servis şirket içinde kullanılıyor; yönetilen şey
  // kişiler: kim neye erişebiliyor, ne harcamış.
  //
  // Şirket (clients) arka planda tek satır olarak duruyor ve "politika"
  // olarak sunuluyor: herkes için üst sınır. Tablo kaldırılmadı çünkü
  // ileride takım kavramı gerekebilir.
  let kisiler = [], sirket = null, ortak = null, talepler = [];

  // Bir kişinin gerçekten çağırabildiği modeller.
  //
  // İki yol var ve ikisi de sayılıyor:
  //   1. kişinin listesinde işaretli VE şirket listesinde de açık
  //   2. fiyatı etkin tavanın altında (işaret gerekmiyor)
  // Sıralama önce işaretliler, çünkü onlar bilinçli kararlar.
  // Kişinin gerçekten erişebildiği modeller = kendi listesi.
  //
  // Eskiden buraya "fiyatı tavanın altında olan her model" de ekleniyordu,
  // çünkü tavan herkese açık bir kuraldı. Artık tavan bir onay kuralı: ucuz
  // bir modeli ilk çağıran kişiye o model yazılıyor. Yani liste kimin neye
  // eriştiğini doğrudan gösteriyor, türetmeye gerek kalmadı.
  function etkinModeller(k) {
    return (k.allowed_models || [])
      .filter(m => modeller.some(x => x.is_active && x.provider + '/' + x.model === m))
      .map(m => ({ ad: m, fiyattan: false }));
  }

  // Kalan bütçeyi tek satırda özetliyor. Sayılar Redis sayacından geliyor;
  // dönem bitince sayaç kendiliğinden sıfırlanıyor.

  // Kalan tutar, sınırdan ayırt edilebilecek kadar hassas yazılıyor.
  //
  // para() basamak sayısını değerin kendi büyüklüğüne göre seçiyor: 4.999836
  // bir doların üstünde olduğu için "$5.00" oluyordu ve "$0.000164 of $5 ·
  // $5.00 left" satırı hiç harcama yapılmamış gibi okunuyordu. Harcama varsa
  // kalan sınıra eşit görünmemeli.
  const paraKalan = (kalan, sinir) => {
    const k = Number(kalan), s = Number(sinir);
    for (const basamak of [2, 4, 6]) {
      const y = k.toFixed(basamak);
      if (k >= s || Number(y) < s) return '$' + y;
    }
    return '$' + k.toFixed(6);
  };

  function butceOzet(b) {
    if (!b) return '';
    const parca = [];
    if (b.gunlukSinir !== null) {
      const kalan = Math.max(0, b.gunlukSinir - b.gunlukHarcama);
      parca.push('today ' + para(b.gunlukHarcama) + ' of $' + b.gunlukSinir +
        ' · ' + paraKalan(kalan, b.gunlukSinir) + ' left');
    }
    if (b.aylikSinir !== null) {
      const kalan = Math.max(0, b.aylikSinir - b.aylikHarcama);
      parca.push('this month ' + para(b.aylikHarcama) + ' of $' + b.aylikSinir +
        ' · ' + paraKalan(kalan, b.aylikSinir) + ' left');
    }
    return parca.join(' — ') || 'no limit set';
  }

  function politikaCiz() {
    if (!sirket) { $('politikaKart').innerHTML = ''; return; }
    const tavan = sirket.max_output_price;

    $('politikaKart').innerHTML =
      '<div class="baslikkucuk">Company rules</div>' +
      '<div class="yardim" style="margin:.35rem 0 1.1rem">' +
      'The defaults for everyone at ' + kacir(sirket.name) + '. ' +
      'A person can be given tighter limits on their own row; whichever is ' +
      'lower applies.</div>' +

      // Şirket model listesi kaldırıldı: modeli tamamen kapatmak Models
      // sekmesindeki aktiflik bayrağının işi, kişiye açmak da kişi satırının.
      // Aradaki üçüncü liste hiçbir şey eklemiyor, sadece sessiz hata
      // üretiyordu.
      '<div class="bolumBaslik" style="font-size:.85rem">Price limit</div>' +
      '<div class="yardim" style="margin:.3rem 0 .7rem">' +
      'The default for everyone. Any model priced under this works without ' +
      'approval, so a cheap new model is usable the day it appears; anything ' +
      'above it is refused and shows up as a request. A person can be given a ' +
      'lower limit, or an individual exception, on their own row. ' +
      'This is a rate per million tokens, unrelated to the budget below.</div>' +
      '<div class="formSatir" style="grid-template-columns:1fr 2fr">' +
      '<label>Highest price allowed<input id="poTavan" type="number" step="0.01" min="0" ' +
      'placeholder="no cap" value="' + (tavan ? (tavan * 1000).toFixed(2) : '') + '"></label>' +
      '<div class="yardim" style="align-self:end;padding-bottom:.55rem">' +
      'dollars per million output tokens</div></div>' +

      '<div class="bolumBaslik" style="margin-top:1.4rem;font-size:.85rem">Company budget</div>' +
      '<div class="yardim" style="margin:.3rem 0 .7rem">' +
      'Requests stop when this is used up. The daily figure keeps a runaway script ' +
      'from burning the month in an hour.</div>' +
      '<div class="formSatir" style="grid-template-columns:1fr 1fr 2fr">' +
      '<label>Per month<input id="poAy" type="number" step="1" min="0" placeholder="none" value="' +
        (sirket.monthly_budget ?? '') + '"></label>' +
      '<label>Per day<input id="poGun" type="number" step="1" min="0" placeholder="none" value="' +
        (sirket.daily_budget ?? '') + '"></label>' +
      '<div class="yardim" style="align-self:end;padding-bottom:.55rem">' +
      butceOzet(sirket.butce) + '</div></div>' +

      '<div style="display:flex;gap:.6rem;margin-top:1.2rem">' +
      '<button class="dugme koyu" id="poKaydet">Save rules</button></div>' +
      '<div class="uyari gizli" id="poHata"></div>';

    $('poKaydet').onclick = async () => {
      $('poKaydet').disabled = true;
      const t = $('poTavan').value.trim();
      try {
        const ay = $('poAy').value.trim(), gun = $('poGun').value.trim();
        await api('/customers/' + sirket.id, { method: 'PATCH', body: JSON.stringify({
          max_output_price: t === '' ? null : Number(t) / 1000,
          monthly_budget: ay === '' ? null : Number(ay),
          daily_budget: gun === '' ? null : Number(gun)
        })});
        await kisilerYukle();
      } catch (e) {
        $('poHata').textContent = e.message; $('poHata').classList.remove('gizli');
      } finally { $('poKaydet').disabled = false; }
    };
  }

  function kisiTabloCiz() {
    $('kiSayac').textContent = kisiler.length + (kisiler.length === 1 ? ' person' : ' people');
    if (!kisiler.length) {
      $('kiTablo').innerHTML = '';
      $('kiBos').innerHTML = '<div class="simge">◷</div><h3>No people yet</h3>' +
        '<p>Add someone so they can sign in to the portal and get a key.</p>';
      $('kiBos').classList.remove('gizli');
      $('kiAltNot').textContent = '';
      return;
    }
    $('kiBos').classList.add('gizli');

    $('kiTablo').innerHTML =
      '<thead><tr><th>Person</th><th>Can use</th><th>Today</th><th>This month</th>' +
      '<th>Keys</th><th class="sayi">Requests</th><th>Last seen</th><th></th></tr></thead><tbody>' +
      kisiler.map((k, i) => {
        const izinli = k.allowed_models || [];
        const canli = (k.anahtarlar || []).filter(a => a.is_active).length;
        const u = k.kullanim || {};
        const b = k.butce;

        // Sütun GERÇEKTEN kullanabildiklerini gösteriyor, sadece işaretli
        // listeyi değil. İkisi aynı şey değil: fiyat tavanının altındaki
        // modeller hiç işaretlenmeden çalışıyor. Önce yalnızca işaretliler
        // yazılıyordu ve sütun "Can use" dediği hâlde yalan söylüyordu —
        // Umur gpt-4o kullanabiliyordu ama listede yoktu.
        const etkin = etkinModeller(k);
        const modelYazi = etkin.length
          ? etkin.map(m =>
              '<span class="rozet' + (m.fiyattan ? ' fiyattan' : '') + '"' +
              ' title="' + (m.fiyattan ? 'Open because its price is under the limit'
                                       : 'Ticked for this person') + '">' +
              kacir(m.ad.split('/')[1]) + '</span>').join('')
          : '<span class="hap bek">nothing</span>';

        return '<tr class="tiklanir" data-i="' + i + '">' +
          '<td>' + kacir(k.email) +
            (k.role === 'owner' ? ' <span class="hap ok">owner</span>' : '') + '</td>' +
          '<td>' + modelYazi + '</td>' +
          // Harcama ile bütçe aynı dönemden okunuyor: yan yana duran iki sayı
          // farklı dönemleri gösterirse karşılaştırılamaz.
          '<td class="sayi">' + (b && b.gunlukSinir !== null
            ? para(b.gunlukHarcama) + ' <span class="yardim">/ $' + b.gunlukSinir + '</span>' +
              (b.asildi === 'gunluk' ? ' <span class="hap err">used up</span>' : '')
            : para((b && b.gunlukHarcama) || 0)) + '</td>' +
          '<td class="sayi">' + (b && b.aylikSinir !== null
            ? para(b.aylikHarcama) + ' <span class="yardim">/ $' + b.aylikSinir + '</span>' +
              (b.asildi === 'aylik' ? ' <span class="hap err">used up</span>' : '')
            : para((b && b.aylikHarcama) || 0)) + '</td>' +
          '<td>' + (canli ? canli : '<span class="hap">none</span>') + '</td>' +
          '<td class="sayi">' + bin(u.istek || 0) +
            ((u.hata || 0) ? ' <span class="hap err">' + u.hata + '</span>' : '') + '</td>' +
          '<td class="sayi">' + (u.son ? gunTarih(u.son) : '—') + '</td>' +
          '<td class="islem"><button class="satirDugme" data-ac="' + i + '">Manage</button></td></tr>';
      }).join('') + '</tbody>';

    const izinsiz = kisiler.filter(k => !(k.allowed_models || []).length && !k.max_output_price).length;
    const anahtarsiz = kisiler.filter(k => !(k.anahtarlar || []).length).length;
    $('kiAltNot').textContent =
      (izinsiz ? izinsiz + ' with no model access — their requests are rejected' : 'Everyone has model access') +
      (anahtarsiz ? ' · ' + anahtarsiz + ' without a key' : '');
  }

  function ortakTabloCiz() {
    const liste = (ortak && ortak.anahtarlar) || [];
    $('ortakSayac').textContent = liste.length + (liste.length === 1 ? ' key' : ' keys');
    if (!liste.length) {
      $('ortakTablo').innerHTML = '';
      $('ortakBos').innerHTML = '<div class="simge">◷</div><h3>No shared keys</h3>' +
        '<p>Every key belongs to someone.</p>';
      $('ortakBos').classList.remove('gizli');
      return;
    }
    $('ortakBos').classList.add('gizli');
    const u = (ortak && ortak.kullanim) || {};
    $('ortakTablo').innerHTML =
      '<thead><tr><th>Key</th><th>Environment</th><th>Created</th><th>Status</th></tr></thead><tbody>' +
      liste.map(a => '<tr>' +
        '<td>' + (a.key_prefix ? '<code class="onek">' + kacir(a.key_prefix) + '…</code> ' : '') +
          kacir(a.label || 'unnamed') + '</td>' +
        '<td>' + kacir(a.environment) + '</td>' +
        '<td class="sayi">' + gunTarih(a.created_at) + '</td>' +
        '<td>' + (a.is_active ? '<span class="hap ok">active</span>'
                              : '<span class="hap">revoked</span>') + '</td></tr>').join('') +
      '</tbody>';
    $('ortakSayac').textContent = liste.length + ' keys · ' + bin(u.istek || 0) + ' requests';
  }

  function talepCiz() {
    $('talepSayac').textContent = talepler.length + ' pending';
    if (!talepler.length) {
      $('talepTablo').innerHTML = '';
      $('talepBos').innerHTML = '<div class="simge">◷</div><h3>Nothing pending</h3>' +
        '<p>No one has been turned away from a model.</p>';
      $('talepBos').classList.remove('gizli');
      return;
    }
    $('talepBos').classList.add('gizli');
    $('talepTablo').innerHTML =
      '<thead><tr><th>Person</th><th>Model</th><th>Why it was refused</th>' +
      '<th class="sayi">Attempts</th><th>Last try</th><th></th></tr></thead><tbody>' +
      talepler.map((t, i) => {
        // Her sebebin çözümü farklı; düğme de ona göre.
        const sebepler = {
          'not-granted':   ['Not ticked for this person', 'Allow'],
          'too-expensive': ['Pricier than their price limit', 'Allow'],
          'model-inactive':['Model is switched off in the catalog', 'Allow'],
          'not-in-catalog':['Not in the catalog at all', 'Allow']
        };
        const [aciklama, dugme] = sebepler[t.sebep] || ['Refused', 'Allow'];
        return '<tr>' +
        '<td>' + kacir(t.musteri) + '</td>' +
        '<td>' + nokta(t.provider) + kacir(t.model) + '</td>' +
        '<td>' + aciklama +
          (t.sebep === 'model-inactive'
            ? '<br><span class="yardim">Switch it on under Models first</span>'
            : t.sebep === 'not-in-catalog'
              ? '<br><span class="yardim">Add it under Models first</span>'
              : '') + '</td>' +
        '<td class="sayi">' + bin(t.adet) + '</td>' +
        '<td class="sayi">' + gunTarih(t.son) + '</td>' +
        '<td class="islem">' +
          (t.sebep === 'not-in-catalog'
            ? '<span class="yardim">—</span>'
            : '<button class="satirDugme" data-talep="' + i + '">' + dugme + '</button>') +
        '</td></tr>';
      }).join('') + '</tbody>';
  }

  async function kisilerYukle() {
    $('uyari').classList.add('gizli');
    if (!kisiler.length) $('yukleniyor').classList.remove('gizli');
    try {
      // Katalog da lazım: "Can use" sütunu ve izin kutuları fiyatlara
      // bakıyor. Models sekmesine hiç girilmeden People açılırsa liste boş
      // kalıyordu.
      const [v, t, mm] = await Promise.all([
        api('/people'), api('/access-requests'), api('/models')
      ]);
      kisiler = v.kisiler; sirket = v.sirket; ortak = v.ortak;
      talepler = t.talepler;
      modeller = mm.modeller;
      politikaCiz(); kisiTabloCiz(); ortakTabloCiz(); talepCiz();
    } catch (e) {
      $('uyari').textContent = e.message;
      $('uyari').classList.remove('gizli');
    } finally {
      $('yukleniyor').classList.add('gizli');
    }
  }

  // Kişi detayı: erişim, anahtarlar, hesap işlemleri.
  function kisiAc(k) {
    const u = k.kullanim || {};
    $('ypBaslik').textContent = k.email;
    $('ypZaman').textContent = (k.role === 'owner' ? 'Owner' : 'Member') + ' since ' +
      new Date(k.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const tavan = k.max_output_price;
    $('ypGovde').innerHTML =
      '<div class="bolumBaslik">Usage</div><dl class="ozellik">' +
      '<dt>Requests</dt><dd>' + bin(u.istek || 0) + '</dd>' +
      '<dt>Cost</dt><dd>' + para(u.maliyet || 0) + '</dd>' +
      '<dt>Last request</dt><dd>' + (u.son
        ? new Date(u.son).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
        : 'never') + '</dd></dl>' +

      '<div class="bolumBaslik">Which models they can use</div>' +
      '<div class="yardim" style="margin-bottom:.7rem">' +
      'Applies to requests sent with the keys this person owns. Ticked means ' +
      'open to them. Cheap models tick themselves the first time they are ' +
      'asked for; expensive ones wait for you.</div>' +
      '<div id="ypModeller" class="secimKutu"></div>' +
      '<div class="bolumBaslik" style="margin-top:1.3rem;font-size:.85rem">Price limit</div>' +
      '<div class="yardim" style="margin:.3rem 0 .7rem">' +
      'Decides <b>which</b> models they may use, not how much they may spend. ' +
      'Anything cheaper than this works without being ticked above. ' +
      'This is a rate per million tokens — a single reply costs a tiny fraction ' +
      'of it, so it never eats into the budget below.</div>' +
      '<div class="formSatir" style="grid-template-columns:1fr 2fr">' +
      '<label>Highest price<input id="ypTavan" type="number" step="0.01" min="0" ' +
      'placeholder="no cap" value="' + (tavan ? (tavan * 1000).toFixed(2) : '') + '"></label>' +
      '<div class="yardim" style="align-self:end;padding-bottom:.55rem">' +
      'dollars per million output tokens</div></div>' +
      '<div class="bolumBaslik" style="margin-top:1.4rem;font-size:.85rem">Budget</div>' +
      '<div class="yardim" style="margin:.3rem 0 .7rem">' +
      'Real money actually spent. Requests stop once it runs out. Switching to a ' +
      'pricier model does not use any of it up on its own.<br>' + butceOzet(k.butce) + '</div>' +
      '<div class="formSatir" style="grid-template-columns:1fr 1fr">' +
      '<label>Per month<input id="ypAy" type="number" step="1" min="0" placeholder="company default" value="' +
        (k.monthly_budget ?? '') + '"></label>' +
      '<label>Per day<input id="ypGun" type="number" step="1" min="0" placeholder="company default" value="' +
        (k.daily_budget ?? '') + '"></label></div>' +

      '<div class="kaydetCubugu">' +
      '<button class="dugme koyu" id="ypKaydet">Save access</button>' +
      '<button class="dugme cerceveli" id="ypRol">' +
        (k.role === 'owner' ? 'Make member' : 'Make owner') + '</button>' +
      '<button class="dugme cerceveli tehlike" id="ypSil">Remove</button>' +
      '<span class="degisti gizli" id="ypDegisti">Unsaved changes</span></div>' +
      '<div class="uyari gizli" id="ypHata"></div>' +

      '<div class="bolumBaslik" style="margin-top:1.8rem">Keys</div>' +
      '<div class="hesap" id="ypAnahtarlar">' +
      ((k.anahtarlar || []).length
        ? k.anahtarlar.map(a =>
            '<div class="sat"><span>' +
            (a.key_prefix ? '<code class="onek">' + kacir(a.key_prefix) + '…</code> ' : '') +
            kacir(a.label || 'unnamed') + ' · ' + kacir(a.environment) + ' · ' +
            gunTarih(a.created_at) + '</span><span>' +
            (a.is_active
              ? '<button class="satirDugme tehlike" data-anahtar="' + a.id + '">Revoke</button>'
              : '<span class="hap">revoked</span>') + '</span></div>').join('')
        : '<div class="sat"><span>No key yet</span><span></span></div>') + '</div>' +
      // Ad ve ortam burada seçiliyor. Önce ikisi de sabitti: her anahtar
      // adsız ve "production" olarak çıkıyordu. Adsız anahtarlar listede
      // "unnamed" diye birikiyor, hangisinin ne olduğu anlaşılmıyordu.
      '<div class="formSatir" style="grid-template-columns:2fr 1fr;margin-top:.7rem">' +
      '<label>Name<input id="ypAnahtarAd" placeholder="e.g. ' +
        kacir((k.email || '').split('@')[0]) + '-prod"></label>' +
      '<label>Environment<select id="ypAnahtarOrtam">' +
        '<option value="production">production</option>' +
        '<option value="development">development</option>' +
        '<option value="local">local</option>' +
      '</select></label></div>' +
      '<label class="secim" style="margin-top:.7rem"><input type="checkbox" id="ypEskiKapat">Revoke existing keys</label>' +
      '<button class="dugme cerceveli" id="ypYeniAnahtar" style="margin-top:.7rem">Issue key</button>' +

      '<div class="bolumBaslik" style="margin-top:1.8rem">Account</div>' +
      '<div class="dugmeler" style="display:flex;gap:.6rem">' +
      '<button class="dugme cerceveli" id="ypEposta">Change email</button>' +
      '<button class="dugme cerceveli" id="ypSifre">Reset password</button></div>';

    modelSecimKutusu($('ypModeller'), k.allowed_models || [], (() => {
      const kt = k.max_output_price, st = sirket && sirket.max_output_price;
      const e = (kt != null && st != null) ? Math.min(kt, st) : (kt != null ? kt : st);
      return e == null ? null : e * 1000;
    })());
    panelAc();

    // Bir şey değiştiği anda çubukta belirsin — kaydetmeden kapatmayı önler.
    ['ypModeller', 'ypTavan', 'ypAy', 'ypGun'].forEach(id => {
      const e = $(id);
      if (e) e.addEventListener('change', () => $('ypDegisti').classList.remove('gizli'));
    });

    $('ypKaydet').onclick = async () => {
      const t = $('ypTavan').value.trim();
      $('ypKaydet').disabled = true;
      try {
        const ay = $('ypAy').value.trim(), gun = $('ypGun').value.trim();
        await api('/users/' + k.id + '/permissions', { method: 'PATCH', body: JSON.stringify({
          allowed_models: secilenModeller($('ypModeller')),
          max_output_price: t === '' ? null : Number(t) / 1000,
          monthly_budget: ay === '' ? null : Number(ay),
          daily_budget: gun === '' ? null : Number(gun)
        })});
        // kisilerYukle talepleri de yeniden çekiyor; verilen izin varsa
        // talep hem buradan hem Dashboard şeridinden düşüyor.
        const oncekiTalep = talepler.length;
        await kisilerYukle();
        detayKapat();
        if (talepler.length < oncekiTalep) {
          const dusen = oncekiTalep - talepler.length;
          bildir(dusen + (dusen === 1 ? ' access request' : ' access requests') + ' cleared');
        }
      } catch (e) {
        $('ypHata').textContent = e.message; $('ypHata').classList.remove('gizli');
      } finally { $('ypKaydet').disabled = false; }
    };

    $('ypRol').onclick = async () => {
      try {
        await api('/users/' + k.id, { method: 'PATCH',
          body: JSON.stringify({ role: k.role === 'owner' ? 'member' : 'owner' }) });
        await kisilerYukle(); detayKapat();
      } catch (e) { $('ypHata').textContent = e.message; $('ypHata').classList.remove('gizli'); }
    };

    $('ypSil').onclick = async () => {
      if (!confirm('Remove ' + k.email + '? Keys they own stay active and become shared.')) return;
      try {
        await api('/users/' + k.id, { method: 'DELETE' });
        await kisilerYukle(); detayKapat();
      } catch (e) { $('ypHata').textContent = e.message; $('ypHata').classList.remove('gizli'); }
    };

    $('ypEposta').onclick = () => epostaKutusuAc($('ypEposta'), k.email, async (yeni) => {
      await api('/users/' + k.id, { method: 'PATCH', body: JSON.stringify({ email: yeni }) });
      await kisilerYukle(); detayKapat();
    });

    $('ypSifre').onclick = () => sifreSifirlamaAc($('ypSifre'), async (yeni) => {
      const v = await api('/users/' + k.id, { method: 'PATCH', body: JSON.stringify({ password: yeni }) });
      alert('New password: ' + v.sifre + '\\n\\nShown once — copy it now.');
    });

    $('ypYeniAnahtar').onclick = async () => {
      const kapat = $('ypEskiKapat').checked;
      if (kapat && !confirm('Existing keys stop working immediately. Continue?')) return;
      try {
        const v = await api('/customers/' + k.client_id + '/keys', {
          method: 'POST', body: JSON.stringify({
            eskileriKapat: kapat,
            user_id: k.id,
            environment: $('ypAnahtarOrtam').value,
            label: $('ypAnahtarAd').value.trim() || undefined
          })
        });
        await kisilerYukle();
        // Sahibi olan anahtarlarda açık değer bize hiç gelmiyor; teslim
        // bağlantısı geliyor. Bağlantıyı iletiyoruz, anahtarı yalnızca sahibi
        // görüyor. Sahipsiz anahtarlarda teslim edilecek kişi olmadığı için
        // eski davranış sürüyor.
        if (v.teslimJetonu) {
          teslimBagiGoster(k.email,
            location.origin + '/portal/reveal/' + v.teslimJetonu, v.sonKullanma);
        } else {
          alert('New key:\\n\\n' + v.anahtar + '\\n\\nShown once — copy it now.' +
            (v.teslimHatasi ? '\\n\\n' + v.teslimHatasi : ''));
        }
        detayKapat();
      } catch (e) { $('ypHata').textContent = e.message; $('ypHata').classList.remove('gizli'); }
    };

    $('ypAnahtarlar').onclick = async (e) => {
      const d = e.target.closest('[data-anahtar]'); if (!d) return;
      if (!confirm('Revoke this key? Requests using it will be rejected.')) return;
      try {
        await api('/keys/' + d.dataset.anahtar, { method: 'PATCH', body: JSON.stringify({ is_active: false }) });
        await kisilerYukle();
        const yeni = kisiler.find(x => x.id === k.id);
        if (yeni) kisiAc(yeni);
      } catch (err) { $('ypHata').textContent = err.message; $('ypHata').classList.remove('gizli'); }
    };
  }

  $('kiTablo').addEventListener('click', e => {
    const d = e.target.closest('[data-ac]') || e.target.closest('tr.tiklanir');
    if (!d) return;
    const i = Number(d.dataset.ac !== undefined ? d.dataset.ac : d.dataset.i);
    const k = kisiler[i];
    if (k) kisiAc(k);
  });

  $('talepTablo').addEventListener('click', async (e) => {
    const d = e.target.closest('[data-talep]'); if (!d) return;
    const t = talepler[Number(d.dataset.talep)]; if (!t) return;
    if (!confirm('Allow ' + t.musteri + ' to use ' + t.modelAnahtar + '?')) return;
    d.disabled = true;
    try {
      // Talep kişiye ait: iznini o kişinin listesine ekliyoruz.
      const kisi = t.userId
        ? kisiler.find(x => x.id === t.userId)
        : kisiler.find(x => x.email === t.musteri);
      if (kisi) {
        await api('/users/' + kisi.id + '/permissions', {
          method: 'PATCH',
          body: JSON.stringify({
            allowed_models: [...new Set([...(kisi.allowed_models || []), t.modelAnahtar])]
          })
        });
      } else {
        await api('/customers/' + t.clientId + '/allow', {
          method: 'POST', body: JSON.stringify({ model: t.modelAnahtar })
        });
      }
      await kisilerYukle();
    } catch (err) {
      $('uyari').textContent = err.message;
      $('uyari').classList.remove('gizli');
      d.disabled = false;
    }
  });

  // Yeni kişi.
  $('mEkleAc').addEventListener('click', () => {
    $('mEkleKart').classList.toggle('gizli');
    if (!$('mEkleKart').classList.contains('gizli')) {
      // Varsayılan olarak şirketin izin verdiği modeller işaretli geliyor:
      // en sık istenen bu, ve boş bırakılırsa kişi hiçbir şey yapamıyor.
      modelSecimKutusu($('kiModeller'), (sirket && sirket.allowed_models) || [],
        sirket && sirket.max_output_price != null ? sirket.max_output_price * 1000 : null);
      $('kiEposta').focus();
    }
  });
  $('kiEkleIptal').addEventListener('click', () => {
    $('mEkleKart').classList.add('gizli');
    $('kiEkleHata').classList.add('gizli');
    $('kiEposta').value = ''; $('kiSifre').value = '';
  });
  $('kiEkleKaydet').addEventListener('click', async () => {
    const e = $('kiEposta').value.trim();
    if (!e) return;
    $('kiEkleKaydet').disabled = true; $('kiEkleHata').classList.add('gizli');
    try {
      const v = await api('/customers/' + sirket.id + '/users', {
        method: 'POST',
        body: JSON.stringify({ email: e, role: $('kiRol').value, password: $('kiSifre').value })
      });
      // Model erişimi hesap açıldıktan sonra veriliyor: hesabın kimliği
      // olmadan izin yazılamıyor.
      await api('/users/' + v.kullanici.id + '/permissions', {
        method: 'PATCH',
        body: JSON.stringify({ allowed_models: secilenModeller($('kiModeller')) })
      });
      $('kiEkleIptal').click();
      await kisilerYukle();
      alert('Account created — ' + v.kullanici.email + '\\n\\nPassword: ' + v.sifre +
            '\\n\\nShown once. Send it over a channel you trust.');
    } catch (err) {
      $('kiEkleHata').textContent = err.message;
      $('kiEkleHata').classList.remove('gizli');
    } finally { $('kiEkleKaydet').disabled = false; }
  });

  // ---------------- genel bakış ----------------
  let oSeri = [];

  function oOku(g) {
    if (!g) { $('oGrafikOkuma').innerHTML = ''; return; }
    const t = new Date(g.gun + 'T00:00:00').toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short' });
    $('oGrafikOkuma').innerHTML = t + ' · <b>' + bin(g.istek) + ' requests</b> · <b>' +
      para(g.maliyet) + '</b>' + (g.hata ? ' · <b>' + g.hata + ' errors</b>' : '');
  }

  // Portaldaki grafikle aynı çizim: alan + çizgi, sabit dört kılavuz,
  // etiketler seyrekleştirilerek üst üste binmesi önleniyor.
  function oGrafikCiz(seri) {
    oSeri = seri || [];
    if (oSeri.length < 2) { $('oGrafik').innerHTML = ''; oOku(null); return; }

    const G = 1000, Y = 250, sag = 16, ust = 14, alt = 34, sol = 84;
    const icG = G - sol - sag, icY = Y - ust - alt;
    const enY = Math.max(...oSeri.map(d => d.maliyet), 0);
    const tavan = (() => { if (enY <= 0) return 1;
      const u = Math.pow(10, Math.floor(Math.log10(enY)));
      for (const k of [1,2,5,10]) if (enY <= k*u) return k*u; return 10*u; })();
    const x = (i) => sol + (i / (oSeri.length - 1)) * icG;
    const y = (v) => ust + icY - (v / tavan) * icY;
    const bas = tavan < 0.01 ? 4 : tavan < 1 ? 3 : 2;

    let g = '';
    for (let k = 0; k <= 4; k++) {
      const d = (tavan/4)*k, yy = y(d);
      g += '<line class="' + (k===0?'taban':'kilavuz') + '" x1="'+sol+'" y1="'+yy+'" x2="'+(G-sag)+'" y2="'+yy+'"/>'
         + '<text class="eksenyazi" x="'+(sol-14)+'" y="'+(yy+4)+'" text-anchor="end">$'+d.toFixed(bas)+'</text>';
    }

    const nk = oSeri.map((d,i) => x(i)+','+y(d.maliyet)).join(' ');
    g += '<polygon class="dolgu" points="'+sol+','+y(0)+' '+nk+' '+(G-sag)+','+y(0)+'"/>'
       + '<polyline class="cizgi" points="'+nk+'"/>';
    oSeri.forEach((d,i) => { if (d.istek) g += '<circle class="nokta" cx="'+x(i)+'" cy="'+y(d.maliyet)+'" r="3.5"/>'; });

    const kisa = (t) => new Date(t+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    const adim = Math.max(1, Math.ceil(oSeri.length / 8));
    const yazilan = [];
    for (let i = 0; i < oSeri.length; i += adim) yazilan.push(i);
    const sonI = oSeri.length - 1, sonY = yazilan[yazilan.length - 1];
    if (sonI - sonY >= Math.ceil(adim * 0.6)) yazilan.push(sonI);
    else if (sonI !== sonY) yazilan[yazilan.length - 1] = sonI;
    for (const i of yazilan)
      g += '<text class="eksenyazi" x="'+x(i)+'" y="'+(Y-8)+'" text-anchor="middle">'+kisa(oSeri[i].gun)+'</text>';

    g += '<line id="oImlec" class="imlec gizli" y1="'+ust+'" y2="'+(ust+icY)+'"/>'
       + '<circle id="oVurgu" class="vurgu gizli" r="5"/>';
    const gen = icG / (oSeri.length - 1);
    oSeri.forEach((d,i) => {
      g += '<rect class="yakala" data-i="'+i+'" x="'+(x(i)-gen/2)+'" y="'+ust+'" width="'+gen+'" height="'+icY+'"/>';
    });

    $('oGrafik').innerHTML = '<svg class="cizim" viewBox="0 0 '+G+' '+Y+'">'+g+'</svg>';

    const zirve = oSeri.reduce((a,b) => b.maliyet > a.maliyet ? b : a, oSeri[0]);
    oOku(zirve.istek ? zirve : null);

    const svg = $('oGrafik').querySelector('svg');
    svg.addEventListener('mousemove', e => {
      const hedef = e.target.closest('.yakala'); if (!hedef) return;
      const i = Number(hedef.dataset.i), d = oSeri[i];
      $('oImlec').setAttribute('x1', x(i)); $('oImlec').setAttribute('x2', x(i));
      $('oImlec').classList.remove('gizli');
      $('oVurgu').setAttribute('cx', x(i)); $('oVurgu').setAttribute('cy', y(d.maliyet));
      $('oVurgu').classList.toggle('gizli', !d.istek);
      oOku(d);
    });
    svg.addEventListener('mouseleave', () => {
      $('oImlec').classList.add('gizli'); $('oVurgu').classList.add('gizli');
      const z = oSeri.reduce((a,b) => b.maliyet > a.maliyet ? b : a, oSeri[0]);
      oOku(z.istek ? z : null);
    });
  }

  // Payı görünür kılan ince çubuk: sayılar yan yana kıyaslanabilsin.
  function oran(deger, enBuyuk) {
    const p = enBuyuk > 0 ? Math.max(2, (deger / enBuyuk) * 100) : 0;
    return '<div class="oranCubuk"><i style="width:' + p.toFixed(1) + '%"></i></div>';
  }

  function oTablolar(v) {
    const m = v.musteriler.slice(0, 8);
    const enM = Math.max(...m.map(x => x.maliyet), 0);
    $('oMusteriSayac').textContent = v.musteriler.length + ' active';
    $('oMusteriTablo').innerHTML = m.length
      ? '<thead><tr><th>Customer</th><th class="sayi">Requests</th><th class="sayi">Cost</th><th></th></tr></thead><tbody>' +
        m.map(x => '<tr><td>' + kacir(x.ad) + '</td>' +
          '<td class="sayi">' + bin(x.istek) + (x.hata ? ' <span class="hap err">' + x.hata + '</span>' : '') + '</td>' +
          '<td class="sayi">' + para(x.maliyet) + '</td>' +
          '<td style="width:6rem">' + oran(x.maliyet, enM) + '</td></tr>').join('') + '</tbody>'
      : '<tbody><tr><td class="yardim">No traffic in this period.</td></tr></tbody>';

    const md = v.modeller.slice(0, 8);
    const enD = Math.max(...md.map(x => x.maliyet), 0);
    $('oModelSayac').textContent = v.modeller.length + ' in use';
    $('oModelTablo').innerHTML = md.length
      ? '<thead><tr><th>Model</th><th class="sayi">Requests</th><th class="sayi">Cost</th><th></th></tr></thead><tbody>' +
        md.map(x => '<tr><td>' + nokta(x.provider) + kacir(x.ad.split('/')[1]) + '</td>' +
          '<td class="sayi">' + bin(x.istek) + (x.hata ? ' <span class="hap err">' + x.hata + '</span>' : '') + '</td>' +
          '<td class="sayi">' + para(x.maliyet) + '</td>' +
          '<td style="width:6rem">' + oran(x.maliyet, enD) + '</td></tr>').join('') + '</tbody>'
      : '<tbody><tr><td class="yardim">No traffic in this period.</td></tr></tbody>';
  }

  // Sağlık satırları: sorun varsa uyarı rengi, yoksa sessiz kalıyor.
  function oBakimCiz(b, k) {
    const satir = (etiket, deger, sorunlu, ipucu) =>
      '<div class="saglikSatir">' +
      '<div><div class="saglikAd">' + etiket + '</div>' +
      '<div class="yardim">' + ipucu + '</div></div>' +
      '<div class="' + (sorunlu ? 'hap bek' : 'hap ok') + '">' + deger + '</div></div>';

    $('oBakim').innerHTML =
      satir('Models without a price', b.fiyatsizModel + ' of ' + b.toplamModel,
            b.fiyatsizModel > 0, 'These cannot be activated — cost would be recorded as zero.') +
      satir('Inactive models', b.pasifModel + ' of ' + b.toplamModel,
            false, 'Present in the catalog but not usable by anyone.') +
      satir('Customers with no allowed model', b.izinsizMusteri + ' of ' + b.toplamMusteri,
            b.izinsizMusteri > 0, 'Every request from these customers is rejected with 403.') +
      satir('Suspended customers', b.askidaMusteri + ' of ' + b.toplamMusteri,
            false, 'Access is closed until reactivated.') +
      satir('Prices not verified recently', b.bayatFiyat + ' of ' + b.toplamModel,
            b.bayatFiyat > 0,
            'Not checked against a source in ' + b.bayatGun + ' days. ' +
            'A stale price silently over- or under-charges customers.') +
      satir('Incomplete request records', bin(b.bekleyenIstek),
            b.bekleyenIstek > 0, 'Started but never completed — tokens and cost are missing.') +
      // Kaynak 'model_catalog' değilse veritabanı okunamamış, yedeğe düşülmüş demek.
      satir('Catalog source', k.source + ' · ' + k.modelCount + ' models',
            k.source !== 'model_catalog',
            k.source === 'model_catalog'
              ? 'Read from the database. Cache refreshed ' + k.ageSeconds + 's ago and dropped whenever a model changes.'
              : 'The database could not be read — running on a fallback list. Prices may be stale.');
  }

  // Panodaki bekleyen erişim talebi şeridi.
  function talepSeridiCiz(liste) {
    const kutu = $('oTalep');
    if (!liste.length) { kutu.classList.add('gizli'); return; }
    kutu.classList.remove('gizli');

    const kisiSayisi = new Set(liste.map(t => t.musteri)).size;
    const ilk = liste.slice(0, 3).map(t =>
      '<div style="margin:.25rem 0"><b>' + kacir(t.musteri) + '</b> &rarr; ' +
      kacir(t.modelAnahtar) + ' <span class="yardim">(' + t.adet +
      (t.adet === 1 ? ' try' : ' tries') + ')</span></div>').join('');

    kutu.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap">' +
      '<div><div class="baslikkucuk" style="margin:0">' +
      liste.length + (liste.length === 1 ? ' model waiting for approval' : ' models waiting for approval') +
      '</div><div class="yardim" style="margin:.3rem 0 .5rem">' +
      'From ' + kisiSayisi + (kisiSayisi === 1 ? ' person' : ' people') +
      ' who called a model they cannot use yet.</div>' + ilk +
      (liste.length > 3 ? '<div class="yardim" style="margin-top:.3rem">and ' +
        (liste.length - 3) + ' more</div>' : '') +
      '</div><button class="dugme koyu" id="oTalepGit" style="flex:0 0 auto">Review in People</button></div>';

    $('oTalepGit').onclick = () => bolumGoster('kisiler');
  }

  async function ozetYukle() {
    $('uyari').classList.add('gizli');
    $('yukleniyor').classList.remove('gizli');
    try {
      // Talepler panoda da gösteriliyor: bekleyen bir onay varsa yöneticinin
      // People sekmesine girmesini beklemek yerine açılışta görmesi lazım.
      const [v, t] = await Promise.all([
        api('/overview?gun=' + gun),
        api('/access-requests').catch(() => ({ talepler: [] }))
      ]);
      const o = v.ozet;
      talepSeridiCiz(t.talepler || []);
      // ton: bir metriğin "kötü" olduğunu sayıya renk vererek belli eder —
      // aynı beyaz ağırlıkta durunca göz taraması yapan biri fark etmiyordu.
      const kart = (ad, deger, aciklama, ton) => '<div class="metrik"><div class="ad">' + ad +
        '</div><div class="aciklama">' + aciklama + '</div><div class="sayi' +
        (ton ? ' ' + ton : '') + '">' + deger + '</div></div>';
      const oran = o.istek ? (o.hata / o.istek * 100) : 0;
      // Eşikler bütçe çubuklarındaki (%80 uyarı, %100 kritik) mantıkla aynı
      // aile — panelde zaten yerleşik bir dil, burada da tutarlı olsun diye.
      const oranTonu = oran >= 15 ? 'tehlike' : oran >= 5 ? 'uyari' : '';
      $('oOzet').innerHTML =
        kart('Requests', bin(o.istek), 'in selected range') +
        kart('Error rate', oran.toFixed(1) + '%', bin(o.hata) + ' rejected or failed', oranTonu) +
        kart('Tokens', bin(o.token), 'input + output') +
        kart('Cost', para(o.maliyet), 'total amount') +
        kart('Avg latency', bin(o.ortSure) + ' ms', 'across completed requests') +
        kart('Active customers', bin(o.aktifMusteri), 'sent at least one request');

      $('oGrafikBaslik').textContent =
        (gun === 0 ? 'All time' : 'Last ' + gun + ' days') + ' — daily spend';
      oGrafikCiz(v.seri);
      oTablolar(v);
      oBakimCiz(v.bakim, v.katalog);
    } catch (e) {
      $('uyari').textContent = 'Could not load the dashboard. ' + e.message;
      $('uyari').classList.remove('gizli');
    } finally {
      $('yukleniyor').classList.add('gizli');
    }
  }


  // ---------------- fiyat denetimi ----------------
  let fiyatVeri = null;

  const DURUM_YAZI = {
    uyuyor:         ['ok',  'matches'],
    ucuzlamis:      ['bek', 'cheaper at source'],
    zamlanmis:      ['err', 'more expensive at source'],
    ayrisiyor:      ['err', 'sources disagree'],
    eslesmemis:     ['',    'not mapped'],
    'kaynakta-yok': ['bek', 'name gone from source'],
    'kaynak-yok':   ['',    'source unavailable']
  };

  function fKaynakCiz(k) {
    const satir = (ad, o) =>
      '<div class="saglikSatir"><div><div class="saglikAd">' + ad + '</div>' +
      '<div class="yardim">' + (o.erisilebilir
        ? o.modelSayisi + ' models, fetched ' + o.yasSaniye + 's ago'
        : 'unreachable — stored prices are untouched') + '</div></div>' +
      '<div class="hap ' + (o.erisilebilir ? 'ok' : 'err') + '">' +
      (o.erisilebilir ? 'live' : 'down') + '</div></div>';

    $('fKaynak').innerHTML =
      '<div class="baslikkucuk">Sources</div>' +
      '<div class="yardim" style="margin:.35rem 0 1rem">' +
      'Two independent lists. A price is applied automatically only when both agree, ' +
      'or when only one carries the model and the price went down.</div>' +
      satir('OpenRouter', k.openrouter) +
      satir('LiteLLM', k.litellm) +
      '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1.1rem">' +
      '<button class="dugme koyu" id="fDususUygula">Apply price drops</button>' +
      '<button class="dugme cerceveli" id="fRematch">Repair broken mappings</button>' +
      '<button class="dugme cerceveli" id="fYenile">Check again</button></div>' +
      '<div class="yardim" style="margin-top:.7rem">' +
      'Drops are applied without asking: leaving them means overcharging customers. ' +
      'Increases always wait for your approval.</div>' +
      '<div class="uyari gizli" id="fSonuc"></div>';

    $('fDususUygula').addEventListener('click', () => fUygula({ sadeceDususler: true }));
    $('fYenile').addEventListener('click', fiyatYukle);
    $('fRematch').addEventListener('click', fYenidenEslestir);
  }

  // Fiyat denetimi süzgeçleri. Katalog 100'ü aştıktan sonra "hangi modelde
  // sorun var" sorusu gözle taranamıyor.
  let fDurumSuz = '', fAramaSuz = '', fOlaySuz = '', fSagSuz = '';

  // Başlık yalnızca bir kez kuruluyor — Models/Requests tablolarındaki aynı
  // desen: sütun başlığının içinde ok, tıklayınca altına panel açılıyor.
  // Eskiden arama kutusuna her tuş vuruşunda tüm tablo (başlık dahil) yeniden
  // kuruluyor, sonra elle odak/imleç geri veriliyordu — artık gerek yok,
  // başlık sabit kaldığı için input hiç yeniden yaratılmıyor.
  function fBaslikKur() {
    if ($('fTablo').querySelector('thead')) return;
    const kutuStil = 'width:100%;font:inherit;font-size:.8rem;padding:.35rem .5rem;' +
      'border:1px solid var(--line-2);border-radius:6px;' +
      'background:var(--sunk);color:var(--ink)';
    const ok = (sutun, panelIcerik) =>
      ' <button class="sutunOk" type="button" data-sutun="' + sutun + '">▾</button>' +
      '<div class="sutunFiltrePopup gizli" data-panel="' + sutun + '" style="min-width:14rem">' +
      panelIcerik + '</div>';

    $('fTablo').innerHTML =
      '<thead><tr>' +
      '<th class="sutunBaslik">Model' + ok('arama',
        '<input type="text" id="fAra" placeholder="Search models" style="' + kutuStil + '">') +
      '</th>' +
      '<th class="sutunBaslik">Provider' + ok('saglayici',
        '<select id="fSagSuz" style="' + kutuStil + '">' +
          '<option value="">All providers</option>' +
          '<option value="openai">OpenAI</option>' +
          '<option value="anthropic">Anthropic</option>' +
          '<option value="gemini">Google</option></select>') +
      '</th>' +
      '<th>Mapped to</th><th class="sayi">Ours</th><th class="sayi">Source</th>' +
      '<th class="sutunBaslik">Status' + ok('durum',
        '<select id="fDurumSuz" style="' + kutuStil + '">' +
          '<option value="">All statuses</option>' +
          '<option value="uyuyor">Matches the source</option>' +
          '<option value="fark">Price differs</option>' +
          '<option value="eslesmemis">Not mapped</option>' +
          '<option value="tekkaynak">Only one source</option></select>') +
      '</th>' +
      '<th>Checked</th><th></th>' +
      '</tr></thead><tbody></tbody>';

    $('fAra').addEventListener('input', () => {
      fAramaSuz = $('fAra').value.trim().toLowerCase();
      fTabloCiz(fiyatVeri);
    });
    $('fSagSuz').addEventListener('change', () => {
      fSagSuz = $('fSagSuz').value;
      fTabloCiz(fiyatVeri);
    });
    $('fDurumSuz').addEventListener('change', () => {
      fDurumSuz = $('fDurumSuz').value;
      fTabloCiz(fiyatVeri);
    });

    $('fTablo').querySelectorAll('.sutunOk').forEach(dugme => {
      dugme.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = $('fTablo').querySelector('[data-panel="' + dugme.dataset.sutun + '"]');
        const kapaliydi = panel.classList.contains('gizli');
        $('fTablo').querySelectorAll('.sutunFiltrePopup').forEach(p => p.classList.add('gizli'));
        panel.classList.toggle('gizli', !kapaliydi);
      });
      dugme.parentElement.querySelector('.sutunFiltrePopup')
        .addEventListener('click', (e) => e.stopPropagation());
    });
    document.addEventListener('click', () => {
      $('fTablo').querySelectorAll('.sutunFiltrePopup').forEach(p => p.classList.add('gizli'));
    });
  }

  function fTabloCiz(v) {
    const m1000 = (x) => x === null || x === undefined ? '—' : '$' + (Number(x) * 1000).toFixed(2);
    const tumu = v.karsilastirma;
    const k = tumu.filter(x => {
      if (fSagSuz && x.provider !== fSagSuz) return false;
      if (fDurumSuz === 'uyuyor' && x.durum !== 'uyuyor') return false;
      if (fDurumSuz === 'fark' && !['ucuzlamis', 'zamlanmis', 'ayrisiyor'].includes(x.durum)) return false;
      if (fDurumSuz === 'eslesmemis' &&
          !['eslesmemis', 'kaynakta-yok', 'kaynak-yok'].includes(x.durum)) return false;
      if (fDurumSuz === 'tekkaynak' && x.dogrulandi) return false;
      if (fAramaSuz && !(x.provider + '/' + x.model).toLowerCase().includes(fAramaSuz)) return false;
      return true;
    });
    const sorunlu = tumu.filter(x =>
      ['ucuzlamis', 'zamlanmis', 'ayrisiyor'].includes(x.durum)).length;
    const eslesmemis = tumu.filter(x =>
      ['eslesmemis', 'kaynakta-yok', 'kaynak-yok'].includes(x.durum)).length;

    $('fSayac').textContent = k.length === tumu.length
      ? tumu.length + ' models'
      : k.length + ' of ' + tumu.length + ' models';

    fBaslikKur();

    $('fTablo').querySelector('tbody').innerHTML =
      k.map((x, i) => {
        const [renk, yazi] = DURUM_YAZI[x.durum] || ['', x.durum];
        const kimlikler = (x.orIds || []).concat(x.liteIds || []);
        return '<tr data-i="' + i + '">' +
          '<td>' + nokta(x.provider) + kacir(x.model) +
            (x.dogrulandi ? ' <span class="hap ok">2 sources</span>' : '') + '</td>' +
          '<td>' + (SAGLAYICI[x.provider] || x.provider) + '</td>' +
          '<td>' + (kimlikler.length
            ? '<code class="onek">' + kacir(kimlikler[0]) + '</code>' +
              (kimlikler.length > 1 ? ' <span class="yardim">+' + (kimlikler.length - 1) + '</span>' : '')
            : '<span class="yardim">—</span>') + '</td>' +
          '<td class="sayi">' + m1000(x.bizimGirdi) + ' / ' + m1000(x.bizimCikti) + '</td>' +
          '<td class="sayi">' + (x.kaynakGirdi === null ? '—'
            : m1000(x.kaynakGirdi) + ' / ' + m1000(x.kaynakCikti)) + '</td>' +
          '<td><span class="hap ' + renk + '">' + yazi + '</span></td>' +
          '<td class="sayi">' + gunTarih(x.kontrolTarihi) + '</td>' +
          '<td class="islem">' +
            '<button class="satirDugme" data-eylem="esle">Mapping</button>' +
            ((x.durum === 'ucuzlamis' || x.durum === 'zamlanmis')
              ? '<button class="satirDugme" data-eylem="uygula">Apply source price</button>'
              : '') +
          '</td></tr>';
      }).join('');

    $('fAltNot').textContent =
      (sorunlu ? sorunlu + ' price' + (sorunlu === 1 ? '' : 's') + ' differ from the source'
               : 'All mapped prices match their source') +
      (eslesmemis ? ' · ' + eslesmemis + ' without a working mapping — these are never compared' : '');

    const h = v.saglayiciHatalari || [];
    $('fHataSayac').textContent = h.length + ' model' + (h.length === 1 ? '' : 's');
    if (!h.length) {
      $('fHataTablo').innerHTML = '';
      $('fHataBos').innerHTML = '<div class="simge">◷</div><h3>Nothing failing</h3>' +
        '<p>No catalog model is being rejected by its provider.</p>';
      $('fHataBos').classList.remove('gizli');
    } else {
      $('fHataBos').classList.add('gizli');
      $('fHataTablo').innerHTML =
        '<thead><tr><th>Model</th><th class="sayi">Failures</th><th>Last seen</th>' +
        '<th>Provider said</th></tr></thead><tbody>' +
        h.map(x => '<tr>' +
          '<td>' + nokta(x.provider) + kacir(x.model) + '</td>' +
          '<td class="sayi">' + bin(x.adet) + '</td>' +
          '<td class="sayi">' + gunTarih(x.son) + '</td>' +
          '<td><span class="hap err">HTTP ' + (x.kod || '?') + '</span></td></tr>').join('') + '</tbody>';
    }

    const t = v.talepler;
    $('fTalepSayac').textContent = t.length + ' model' + (t.length === 1 ? '' : 's');
    if (!t.length) {
      $('fTalepTablo').innerHTML = '';
      $('fTalepBos').innerHTML = '<div class="simge">◷</div><h3>Nothing requested</h3>' +
        '<p>No customer asked for a model outside the catalog.</p>';
      $('fTalepBos').classList.remove('gizli');
      return;
    }
    $('fTalepBos').classList.add('gizli');
    $('fTalepTablo').innerHTML =
      '<thead><tr><th>Model</th><th class="sayi">Attempts</th><th>Last try</th>' +
      '<th>Source price</th></tr></thead><tbody>' +
      t.map(x => '<tr>' +
        '<td>' + nokta(x.provider) + kacir(x.model) + '</td>' +
        '<td class="sayi">' + bin(x.adet) + '</td>' +
        '<td class="sayi">' + gunTarih(x.son) + '</td>' +
        '<td>' + (x.onerilenKaynak
          ? m1000(x.onerilenGirdi) + ' / ' + m1000(x.onerilenCikti) +
            ' <span class="yardim">' + kacir(x.onerilenKaynak) + '</span>'
          : '<span class="yardim">not found at source</span>') + '</td></tr>').join('') + '</tbody>';
  }

  // Eşleştirme paneli. Kimlikler artık liste: sağlayıcı ad değiştirdiğinde
  // eskisi ve yenisi birlikte tutulabilsin diye her satır ayrı bir ad.
  function fEsleAc(x) {
    const dizi = (a) => (a && a.length ? a.join('\\n') : '');
    $('ypBaslik').textContent = x.provider + '/' + x.model;
    $('ypZaman').textContent = 'Source mapping';

    $('ypGovde').innerHTML =
      '<div class="yardim" style="margin-bottom:1rem">' +
      'One name per line. They are tried in order, so an old name can stay ' +
      'while a new one is added — the switch then costs nothing.</div>' +

      (x.onerilenEslesme
        ? '<div class="dogrula bek">Suggested: <b>' + kacir(x.onerilenEslesme.kimlik) + '</b> — ' +
          'its price ($' + (x.onerilenEslesme.girdi * 1000).toFixed(2) + ' / $' +
          (x.onerilenEslesme.cikti * 1000).toFixed(2) + ') is close to the last known value.</div>'
        : '') +

      '<div class="bolumBaslik">OpenRouter</div>' +
      '<textarea id="ypOr" rows="3" placeholder="openai/gpt-4o">' + kacir(dizi(x.orIds)) + '</textarea>' +

      '<div class="bolumBaslik" style="margin-top:1.2rem">LiteLLM</div>' +
      '<textarea id="ypLite" rows="2" placeholder="gpt-4o">' + kacir(dizi(x.liteIds)) + '</textarea>' +
      '<div class="yardim" style="margin-top:.35rem">' +
      'Second source. When both agree on a price it is applied automatically.</div>' +

      (x.adaylar && x.adaylar.length
        ? '<div class="bolumBaslik" style="margin-top:1.5rem">Candidates at OpenRouter</div>' +
          '<div class="secimKutu">' + x.adaylar.map(a =>
            '<button class="secim" data-aday="' + kacir(a) + '">' + kacir(a) + '</button>').join('') + '</div>'
        : '') +

      (x.not ? '<div class="yardim" style="margin-top:1.2rem">' + kacir(x.not) + '</div>' : '') +

      '<div style="display:flex;gap:.6rem;margin-top:1.2rem">' +
      '<button class="dugme koyu" id="ypEsleKaydet">Save mapping</button>' +
      '<button class="dugme cerceveli" id="ypEsleTemizle">Clear</button></div>' +
      '<div class="uyari gizli" id="ypHata"></div>';

    // Aday düğmesi OpenRouter kutusuna satır ekliyor, üzerine yazmıyor.
    $('ypGovde').addEventListener('click', e => {
      const d = e.target.closest('[data-aday]'); if (!d) return;
      e.preventDefault();
      const mevcut = $('ypOr').value.split('\\n').map(t => t.trim()).filter(Boolean);
      if (!mevcut.includes(d.dataset.aday)) mevcut.push(d.dataset.aday);
      $('ypOr').value = mevcut.join('\\n');
    });

    panelAc();

    const kaydet = async (bosalt) => {
      const ayir = (t) => t.split('\\n').map(x => x.trim()).filter(Boolean);
      try {
        await api('/prices/map', { method: 'POST', body: JSON.stringify({
          id: x.id,
          source_ids:  bosalt ? [] : ayir($('ypOr').value),
          litellm_ids: bosalt ? [] : ayir($('ypLite').value)
        })});
        detayKapat();
        await fiyatYukle();
      } catch (e) {
        $('ypHata').textContent = e.message; $('ypHata').classList.remove('gizli');
      }
    };
    $('ypEsleKaydet').addEventListener('click', () => kaydet(false));
    $('ypEsleTemizle').addEventListener('click', () => kaydet(true));
  }

  const OLAY_RENK = { price: 'ok', mapping: '', warning: 'bek', run: '' };

  async function fOlaylariCiz() {
    let v;
    try { v = await api('/price-events'); } catch (e) { return; }
    const o = v.olaylar || [];

    // Zamanlanmış çalışma yapılmamışsa panel açılışında bir kez tetikliyoruz.
    // Cron yalnızca canlıda çalışıyor; yerelde ya da bir aksama olduğunda
    // denetimin hiç yapılmaması yerine gecikmeli yapılması yeğ.
    const sonCalisma = o.find(x => x.tur === 'run');
    const gecti = !sonCalisma ||
      (Date.now() - new Date(sonCalisma.created_at).getTime()) > 24 * 3600 * 1000;
    if (gecti && !v.tabloYok) {
      try {
        await api('/cron/prices');
        v = await api('/price-events');
      } catch (e) { /* denetim başarısızsa liste yine de gösterilsin */ }
    }

    const liste = v.olaylar || [];
    $('fOlaySayac').textContent = liste.length ? liste.length + ' entries' : '';
    if (!liste.length) {
      $('fOlayTablo').innerHTML = '';
      $('fOlayBos').innerHTML = '<div class="simge">◷</div><h3>No activity yet</h3>' +
        '<p>' + (v.tabloYok
          ? 'The price_events table has not been created yet.'
          : 'The first scheduled run has not happened.') + '</p>';
      $('fOlayBos').classList.remove('gizli');
      return;
    }
    $('fOlayBos').classList.add('gizli');
    const m = (x) => x === null || x === undefined ? '' : '$' + (Number(x) * 1000).toFixed(2);
    $('fOlayTablo').innerHTML =
      '<thead><tr><th>When</th><th>Type</th><th>Model</th><th>Change</th>' +
      '<th>What happened</th></tr></thead><tbody>' +
      liste.slice(0, 25).map(x => '<tr>' +
        '<td class="sayi">' + new Date(x.created_at).toLocaleString('en-GB',
          { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</td>' +
        '<td><span class="hap ' + (OLAY_RENK[x.tur] || '') + '">' + kacir(x.tur) + '</span>' +
          (x.tetikleyen === 'cron' ? ' <span class="yardim">auto</span>' : '') + '</td>' +
        '<td>' + kacir(x.model || '—') + '</td>' +
        '<td class="sayi">' + (x.eski_girdi !== null && x.eski_girdi !== undefined
          ? m(x.eski_girdi) + '/' + m(x.eski_cikti) + ' → ' + m(x.yeni_girdi) + '/' + m(x.yeni_cikti)
          : '—') + '</td>' +
        '<td>' + kacir(x.aciklama || '') + '</td></tr>').join('') + '</tbody>';
  }

  // Müşterinin portal kullanıcıları.
  // E-posta değiştirme kutusu. Adres giriş kimliği olduğu için değiştirmek
  // girişi de değiştiriyor — kutu bunu söylüyor.
  function epostaKutusuAc(dugme, mevcut, uygula) {
    document.querySelectorAll('.sifreKutu').forEach(x => x.remove());

    const kutu = document.createElement('div');
    kutu.className = 'sifreKutu';
    kutu.innerHTML =
      '<div class="baslikkucuk" style="font-size:.85rem">Email address</div>' +
      '<input id="epYeni" class="sifreAlan" type="email" spellcheck="false" ' +
      'autocapitalize="off" autocorrect="off" value="' + kacir(mevcut) + '">' +
      '<div class="yardim" style="margin-top:.5rem">' +
      'This is what they sign in with. The password stays the same.</div>' +
      '<div class="dugmeler">' +
      '<button class="dugme koyu" id="epKaydet">Save</button>' +
      '<button class="dugme cerceveli" id="epIptal">Cancel</button></div>';

    const satir = dugme.closest('.sat') || dugme.parentNode;
    satir.after(kutu);
    dugme.disabled = true;
    $('epYeni').focus();

    const kapat = () => { kutu.remove(); dugme.disabled = false; };
    $('epIptal').onclick = kapat;
    $('epKaydet').onclick = async () => {
      $('epKaydet').disabled = true;
      try { await uygula($('epYeni').value); } catch (err) {
        kutu.insertAdjacentHTML('beforeend',
          '<div class="uyari" style="margin-top:.6rem">' + kacir(err.message) + '</div>');
        $('epKaydet').disabled = false;
        return;
      }
      kapat();
    };
    $('epYeni').onkeydown = (e) => { if (e.key === 'Enter') $('epKaydet').click(); };
  }

  // Şifre sıfırlama kutusu.
  //
  // Eskiden düğme doğrudan rastgele bir şifre üretiyordu. Yönetici bazen
  // kendi belirlediği bir şifreyi vermek istiyor (telefonda okumak,
  // müşterinin hazırladığı bir şifreyi kullanmak gibi), o yüzden alan açık —
  // ama boş bırakılırsa yine üretiliyor, çünkü elle uydurulan şifreler zayıf
  // ve tekrar eden oluyor.
  function sifreSifirlamaAc(dugme, uygula) {
    // Aynı anda birden çok kutu açılmasın.
    document.querySelectorAll('.sifreKutu').forEach(x => x.remove());

    const kutu = document.createElement('div');
    kutu.className = 'sifreKutu';
    kutu.innerHTML =
      '<div class="baslikkucuk" style="font-size:.85rem">New password</div>' +
      '<input id="sfYeni" class="sifreAlan" type="text" spellcheck="false" ' +
      'autocapitalize="off" autocorrect="off" autocomplete="off" ' +
      'placeholder="leave empty to generate one">' +
      '<div class="yardim" style="margin-top:.5rem">' +
      'At least 10 characters. Shown as you type so you can read it out. ' +
      'The current password stops working immediately and all their open sessions ' +
      'are signed out.</div>' +
      '<div class="dugmeler">' +
      '<button class="dugme koyu" id="sfKaydet">Set password</button>' +
      '<button class="dugme cerceveli" id="sfIptal">Cancel</button></div>';

    const satir = dugme.closest('.sat') || dugme.parentNode;
    satir.after(kutu);
    dugme.disabled = true;
    $('sfYeni').focus();

    const kapat = () => { kutu.remove(); dugme.disabled = false; };
    $('sfIptal').onclick = kapat;
    $('sfKaydet').onclick = async () => {
      $('sfKaydet').disabled = true;
      try {
        await uygula($('sfYeni').value);
      } catch (e) {
        kutu.insertAdjacentHTML('beforeend',
          '<div class="uyari" style="margin-top:.6rem">' + kacir(e.message) + '</div>');
        $('sfKaydet').disabled = false;
        return;
      }
      kapat();
    };
    $('sfYeni').onkeydown = (e) => { if (e.key === 'Enter') $('sfKaydet').click(); };
  }


  // Kırılan eşleştirmeleri fiyat sürekliliğiyle onarır.
  async function fYenidenEslestir() {
    const d = $('fRematch');
    d.disabled = true; d.textContent = 'Checking...';
    try {
      const v = await api('/prices/rematch', { method: 'POST', body: JSON.stringify({}) });
      await fiyatYukle();
      const not = $('fSonuc');
      if (!not) return;
      not.classList.remove('gizli');
      not.innerHTML = (v.baglanan.length
        ? v.baglanan.map(b => kacir(b.model) + ' → ' + kacir(b.kimlik) +
            ' <span class="yardim">(' + b.sapma + ' from the last known price)</span>').join('<br>')
        : 'No broken mapping could be repaired automatically.') +
        (v.belirsiz.length
          ? '<br><br>Left alone: ' + v.belirsiz.map(b =>
              kacir(b.model) + ' <span class="yardim">— ' + kacir(b.sebep) + '</span>').join(', ')
          : '');
    } catch (e) {
      $('uyari').textContent = e.message;
      $('uyari').classList.remove('gizli');
    } finally {
      const b = $('fRematch');
      if (b) { b.disabled = false; b.textContent = 'Repair broken mappings'; }
    }
  }

  async function fUygula(govde) {
    try {
      const v = await api('/prices/apply', { method: 'POST', body: JSON.stringify(govde) });
      await fiyatYukle();
      const not = $('fSonuc');
      if (!not) return;
      not.classList.remove('gizli');
      not.innerHTML = (v.uygulanan.length
        ? v.uygulanan.map(u => kacir(u.model) + ' ' + u.eski + ' → ' + u.yeni +
            ' <span class="yardim">(' + kacir(u.kaynak) + ')</span>').join('<br>')
        : 'Nothing to update — no mapped model is cheaper at its source.') +
        ((v.atlanan && v.atlanan.length)
          ? '<br><br>Skipped: ' + v.atlanan.map(a =>
              kacir(a.model) + ' <span class="yardim">— ' + kacir(a.sebep) + '</span>').join(', ')
          : '');
    } catch (e) {
      $('uyari').textContent = e.message;
      $('uyari').classList.remove('gizli');
    }
  }

  $('fTablo').addEventListener('click', e => {
    const d = e.target.closest('[data-eylem]'); if (!d) return;
    const x = fiyatVeri.karsilastirma[Number(d.closest('tr').dataset.i)]; if (!x) return;
    if (d.dataset.eylem === 'esle') fEsleAc(x);
    else fUygula({ id: x.id });
  });

  async function fiyatYukle() {
    $('uyari').classList.add('gizli');
    $('yukleniyor').classList.remove('gizli');
    try {
      fiyatVeri = await api('/prices');
      fKaynakCiz(fiyatVeri.kaynaklar);
      fTabloCiz(fiyatVeri);
      await fOlaylariCiz();
    } catch (e) {
      $('uyari').textContent = e.message;
      $('uyari').classList.remove('gizli');
      $('fKaynak').innerHTML = '';
      $('fTablo').innerHTML = '';
      $('fTalepTablo').innerHTML = '';
    } finally {
      $('yukleniyor').classList.add('gizli');
    }
  }

  // ---------------- yönetici hesapları ----------------
  //
  // Jetonla girilmişse yalnızca bu ekran çalışıyor: paylaşılan jeton acil
  // durum kapısı, arkasından her şeyin yapılabilmesi "kim ne yaptı" sorusunu
  // cevapsız bırakırdı.
  let girisYolu = 'hesap';

  function jetonKisitiUygula() {
    const jetonla = girisYolu === 'jeton';
    document.querySelectorAll('#menu button[data-bolum]').forEach(b => {
      const izinli = !jetonla || b.dataset.bolum === 'yoneticiler';
      b.disabled = !izinli;
      b.style.opacity = izinli ? '' : '.4';
    });
    $('jetonUyari').classList.toggle('gizli', !jetonla);
    if (jetonla) bolumGoster('yoneticiler');
  }

  // Oturum düştüğünde giriş ekranına dön ve sebebini söyle.
  function oturumBitti(mesaj) {
    jeton = null; modeller = [];
    try { localStorage.removeItem(DEPO); } catch (e) {}
    $('uygulama').classList.add('gizli');
    $('girisEkran').classList.remove('gizli');
    $('hata').textContent = mesaj ||
      'Your session ended — this happens right after your own password is reset. ' +
      'Sign in with the new one.';
    $('hata').classList.remove('gizli');
  }

  async function yoneticileriYukle() {
    const kutu = $('yonListe');
    $('yonHata').classList.add('gizli');
    try {
      const v = await api('/admins');
      const liste = v.yoneticiler || [];
      kutu.innerHTML = liste.length
        ? '<div class="hesap">' + liste.map(y =>
            '<div class="sat"><span>' + kacir(y.email) +
            '<br><span class="yardim">' +
            (y.last_login_at ? 'last signed in ' + gunTarih(y.last_login_at) : 'never signed in') +
            '</span></span><span>' +
            '<button class="satirDugme" data-yon-eposta="' + y.id + '">Change email</button>' +
            '<button class="satirDugme" data-yon-sifre="' + y.id + '">Reset password</button>' +
            (liste.length > 1
              ? '<button class="satirDugme tehlike" data-yon-sil="' + y.id + '">Remove</button>'
              : '') +
            '</span></div>').join('') + '</div>'
        : '<div class="yardim">No administrator accounts yet. Add one — the shared token ' +
          'is meant to be a fallback, not the way in.</div>';

      kutu.onclick = async (e) => {
        const eps = e.target.closest('[data-yon-eposta]');
        const sif = e.target.closest('[data-yon-sifre]');
        const sil = e.target.closest('[data-yon-sil]');
        try {
          if (eps) {
            const y = liste.find(x => x.id === eps.dataset.yonEposta);
            epostaKutusuAc(eps, y ? y.email : '', async (yeniEposta) => {
              await api('/admins/' + eps.dataset.yonEposta, {
                method: 'PATCH', body: JSON.stringify({ email: yeniEposta })
              });
              await yoneticileriYukle();
            });
          }
          if (sif) {
            sifreSifirlamaAc(sif, async (yeni) => {
              const v2 = await api('/admins/' + sif.dataset.yonSifre, {
                method: 'PATCH', body: JSON.stringify({ password: yeni })
              });
              await yoneticileriYukle();
              yonSifreGoster('Password reset', v2.sifre);
            });
          }
          if (sil) {
            if (!confirm('Remove this administrator?')) return;
            await api('/admins/' + sil.dataset.yonSil, { method: 'DELETE' });
            await yoneticileriYukle();
          }
        } catch (err) {
          $('yonHata').textContent = err.message;
          $('yonHata').classList.remove('gizli');
        }
      };
    } catch (e) {
      kutu.innerHTML = '<div class="uyari">' + kacir(e.message) + '</div>';
    }
  }

  function yonSifreGoster(baslik, sifre) {
    const alan = document.createElement('div');
    alan.className = 'sifreKutu';
    alan.innerHTML = '<div class="baslikkucuk" style="font-size:.85rem">' + baslik + '</div>' +
      '<div class="anahtarKutu" style="margin-top:.6rem"><code>' + kacir(sifre) + '</code></div>' +
      '<div class="yardim" style="margin-top:.5rem">Shown once — copy it now.</div>';
    $('yonListe').parentNode.insertBefore(alan, $('yonListe').nextSibling);
  }

  $('yonEkle').addEventListener('click', async () => {
    const e = $('yonEposta').value.trim();
    if (!e) return;
    $('yonEkle').disabled = true; $('yonHata').classList.add('gizli');
    try {
      const v = await api('/admins', {
        method: 'POST',
        body: JSON.stringify({ email: e, password: $('yonSifre').value })
      });
      $('yonEposta').value = ''; $('yonSifre').value = '';
      await yoneticileriYukle();
      yonSifreGoster('Administrator added — ' + v.yonetici.email, v.sifre);
    } catch (err) {
      $('yonHata').textContent = err.message;
      $('yonHata').classList.remove('gizli');
    } finally { $('yonEkle').disabled = false; }
  });

  async function yukle() {
    $('uyari').classList.add('gizli');
    if (!modeller.length) $('yukleniyor').classList.remove('gizli');
    try {
      modeller = (await api('/models')).modeller;
      tabloCiz();
    } catch (e) {
      $('uyari').textContent = 'Could not load models. ' + e.message;
      $('uyari').classList.remove('gizli');
    } finally {
      $('yukleniyor').classList.add('gizli');
    }
  }

  $('tablo').addEventListener('click', async (e) => {
    const d = e.target.closest('[data-eylem]'); if (!d) return;
    const id = d.closest('tr').dataset.id;
    const m = modeller.find(x => x.id === id); if (!m) return;

    if (d.dataset.eylem === 'durum') {
      if (!m.is_active && (m.input_price === null || m.output_price === null)) {
        alert('Set a price before activating this model.');
        return;
      }
      d.disabled = true;
      try { await api('/models/' + id, { method:'PATCH',
              body: JSON.stringify({ is_active: !m.is_active }) }); await yukle(); }
      catch (err) { alert(err.message); d.disabled = false; }
      return;
    }

    if (d.dataset.eylem === 'fiyat') {
      const g = prompt('Input price for ' + m.model + ' ($ per 1M tokens)',
        m.input_price === null ? '' : (Number(m.input_price) * 1000).toFixed(2));
      if (g === null) return;
      const c = prompt('Output price for ' + m.model + ' ($ per 1M tokens)',
        m.output_price === null ? '' : (Number(m.output_price) * 1000).toFixed(2));
      if (c === null) return;
      const gs = Number(g), cs = Number(c);
      if (!(gs >= 0) || !(cs >= 0)) { alert('Enter valid numbers.'); return; }
      try {
        await api('/models/' + id, { method:'PATCH',
          body: JSON.stringify({ input_price: gs / 1000, output_price: cs / 1000 }) });
        await yukle();
      } catch (err) { alert(err.message); }
    }
  });

  // Süzgeç kontrolleri (arama, sağlayıcı, fiyat, kaynak, durum) artık
  // tabloyla birlikte dinamik kuruluyor (mBaslikKur) — sayfa yüklenirken
  // DOM'da henüz yoklar, burada bağlamak hataya yol açardı.

  $('ekleAc').addEventListener('click', () => {
    $('ekleKart').classList.toggle('gizli');
    $('ekleHata').classList.add('gizli');
    if (!$('ekleKart').classList.contains('gizli')) $('yModel').focus();
  });
  $('ekleIptal').addEventListener('click', () => $('ekleKart').classList.add('gizli'));

  $('ekleKaydet').addEventListener('click', async () => {
    const model = $('yModel').value.trim();
    if (!model) { $('ekleHata').textContent = 'Model ID is required.';
                  $('ekleHata').classList.remove('gizli'); return; }
    const g = $('yGirdi').value.trim(), c = $('yCikti').value.trim();
    const govde = { provider: $('yProvider').value, model,
      input_price: g === '' ? null : Number(g) / 1000,
      output_price: c === '' ? null : Number(c) / 1000 };
    $('ekleKaydet').disabled = true;
    try {
      await api('/models', { method:'POST', body: JSON.stringify(govde) });
      $('yModel').value = ''; $('yGirdi').value = ''; $('yCikti').value = '';
      $('ekleKart').classList.add('gizli');
      await yukle();
    } catch (err) {
      $('ekleHata').textContent = err.message;
      $('ekleHata').classList.remove('gizli');
    } finally { $('ekleKaydet').disabled = false; }
  });

  async function girisYap(hazir) {
    const saklı = typeof hazir === 'string' ? hazir : null;
    const d = saklı || $('jeton').value.trim(); if (!d) return;
    $('btn').disabled = true; $('hata').classList.add('gizli');
    jeton = d;
    try {
      await api('/models');
      try { localStorage.setItem(DEPO, JSON.stringify({ a: d, t: Date.now() })); } catch (e) {}
      $('girisEkran').classList.add('gizli');
      $('uygulama').classList.remove('gizli');
      girisYolu = 'jeton';
      jetonKisitiUygula();
    } catch (e) {
      jeton = null;
      try { localStorage.removeItem(DEPO); } catch (err) {}
      if (!saklı) {
        $('hata').textContent = 'Token not recognized.';
        $('hata').classList.remove('gizli');
      }
    } finally { $('btn').disabled = false; }
  }

  async function hesapGirisi() {
    const e = $('yEposta').value.trim(), sf = $('ySifre').value;
    if (!e || !sf) return;
    $('btnHesap').disabled = true; $('hata').classList.add('gizli');
    try {
      const c = await fetch('/admin/api/session', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: e, password: sf })
      });
      const v = await c.json();
      if (!c.ok) {
        $('hata').textContent = v.error || 'Sign-in failed.';
        $('hata').classList.remove('gizli');
        return;
      }
      jeton = null;
      try { localStorage.removeItem(DEPO); } catch (err) {}
      $('ySifre').value = '';
      $('girisEkran').classList.add('gizli');
      $('uygulama').classList.remove('gizli');
      girisYolu = 'hesap';
      jetonKisitiUygula();
      // Model listesi Customers ekranındaki izin kutucukları için de gerekli.
      await yukle();
      bolumGoster(bolum);
    } catch (err) {
      $('hata').textContent = 'Could not reach the server.';
      $('hata').classList.remove('gizli');
    } finally { $('btnHesap').disabled = false; }
  }

  $('girisSekme').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    [...$('girisSekme').children].forEach(x => x.classList.toggle('secili', x === b));
    $('yolHesap').classList.toggle('gizli', b.dataset.yol !== 'hesap');
    $('yolJeton').classList.toggle('gizli', b.dataset.yol !== 'jeton');
    $('hata').classList.add('gizli');
  });

  $('btnHesap').addEventListener('click', hesapGirisi);
  $('yEposta').addEventListener('keydown', e => { if (e.key === 'Enter') $('ySifre').focus(); });
  $('ySifre').addEventListener('keydown', e => { if (e.key === 'Enter') hesapGirisi(); });

  $('btn').addEventListener('click', () => girisYap());
  $('jeton').addEventListener('keydown', e => { if (e.key === 'Enter') girisYap(); });
  $('yenile').addEventListener('click', () => {
    if (bolum === 'istekler') { offset = 0; iSatirlar = []; istekYukle(false); }
    else if (bolum === 'ozet') ozetYukle();
    else if (bolum === 'kisiler') kisilerYukle();
    else if (bolum === 'fiyatlar') fiyatYukle();
    else yukle();
  });
  $('disaAktar').addEventListener('click', async () => {
    const d = $('disaAktar');
    d.disabled = true; d.textContent = 'Preparing...';
    try {
      const s = new URLSearchParams({ gun: String(gun) });
      if ($('fKisi').value)      s.set('kisi',     $('fKisi').value);
      if ($('fSaglayici').value) s.set('provider', $('fSaglayici').value);
      if ($('fDurum').value)     s.set('durum',    $('fDurum').value);

      // api() JSON bekliyor; CSV metin döndüğü için doğrudan fetch.
      const c = await fetch('/admin/api/export?' + s.toString(),
        { headers: { authorization: 'Bearer ' + jeton } });
      if (!c.ok) throw new Error('server');
      const metin = await c.text();
      const bag = document.createElement('a');
      bag.href = URL.createObjectURL(new Blob([metin], { type: 'text/csv;charset=utf-8' }));
      bag.download = 'requests-' + new Date().toISOString().slice(0, 10) + '.csv';
      bag.click();
      URL.revokeObjectURL(bag.href);
    } catch (e) {
      $('uyari').textContent = 'Could not prepare the file.';
      $('uyari').classList.remove('gizli');
    } finally {
      d.disabled = false; d.textContent = 'Download CSV';
    }
  });

  $('tema').addEventListener('click', temaDegistir);
  $('temaKose').addEventListener('click', temaDegistir);
  $('cikis').addEventListener('click', async () => {
    try { await fetch('/admin/api/session', { method: 'DELETE' }); } catch (e) {}
    jeton = null; $('jeton').value = ''; $('ySifre').value = ''; modeller = [];
    try { localStorage.removeItem(DEPO); } catch (e) {}
    $('uygulama').classList.add('gizli'); $('girisEkran').classList.remove('gizli');
  });

  try {
    // Önce oturum çerezi: hesapla girilmişse jeton saklamaya gerek yok.
    (async () => {
      try {
        const c = await fetch('/admin/api/me');
        if (c.ok) {
          const v = await c.json();
          // Jetonla girilmişse çerez yok; saklanan jetona düşülüyor.
          if (v.yol === 'hesap') {
            $('girisEkran').classList.add('gizli');
            $('uygulama').classList.remove('gizli');
            girisYolu = 'hesap';
            jetonKisitiUygula();
            await yukle();
            bolumGoster(bolum);
            return;
          }
        }
      } catch (e) { /* sunucuya ulaşılamadıysa jeton yoluna düş */ }

      const ham = localStorage.getItem(DEPO);
      if (!ham) return;
      const { a, t } = JSON.parse(ham);
      if (a && t && Date.now() - t < 12 * 60 * 60 * 1000) girisYap(a);
      else localStorage.removeItem(DEPO);
    })();
  } catch (e) {}
</script>
</body>
</html>`;

export function adminRoutes(app: Hono) {
  app.get('/admin', async (c) => {
    return c.html(SAYFA);
  });

  app.get('/admin/api/models', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const { data, error } = await supabase
      .from('model_catalog')
      .select('id, provider, model, input_price, output_price, is_active, ' +
              'price_checked_at, price_source, updated_at')
      .order('provider', { ascending: true })
      .order('model', { ascending: true });
    if (error) return c.json({ error: 'Could not read the catalog.' }, 500 as any);

    // Tabloda "fiyat nereden geldi" sütunu bu alandan besleniyor. Sütunu
    // eklerken alanı select'e koymayı atlamıştım: her satır boş geliyor,
    // rozet de boşu "elle girilmiş" sayıp hepsini aynı gösteriyordu.
    return c.json({
      modeller: ((data ?? []) as unknown as Array<Record<string, unknown>>).map((m) => ({
        ...m,
        fiyatKaynagi: (m.price_source as string | null) ?? 'manual'
      }))
    });
  });


  // Fiyatlar 1000 token başına saklanıyor, panel formu 1M başına alıp bölüyor.
  // Uca doğrudan 1M değeri gönderilirse fiyat bin kat şişer ve maliyet sessizce
  // yanlış yazılır. Bugün bilinen en pahalı modeller 1M başına ~$100 civarında,
  // yani 1K başına ~$0.1. Sınırı bunun on katına koyuyoruz: gerçek bir fiyatı
  // engellemez, birim hatasını yakalar.
  const FIYAT_TAVANI = 1;

  function fiyatKusuru(girdi: unknown, cikti: unknown): string | null {
    for (const [ad, v] of [['Input', girdi], ['Output', cikti]] as const) {
      if (v === null || v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return ad + ' price must be a positive number.';
      if (n > FIYAT_TAVANI) {
        return ad + ' price looks like a unit error: ' + n + ' per 1K tokens is $' +
          (n * 1000).toFixed(0) + ' per 1M. Enter the price per 1K tokens.';
      }
    }
    return null;
  }

  app.post('/admin/api/models', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const g = (await govdeOku<{
      provider?: string; model?: string;
      input_price?: number | null; output_price?: number | null;
    }>(c)) ?? {};
    if (!g?.provider || !g?.model?.trim()) {
      return c.json({ error: 'Provider and model ID are required.' }, 400 as any);
    }

    const kusur = fiyatKusuru(g.input_price, g.output_price);
    if (kusur) return c.json({ error: kusur }, 400 as any);

    const { data, error } = await supabase
      .from('model_catalog')
      .insert([{
        provider: g.provider,
        model: g.model.trim(),
        input_price: g.input_price ?? null,
        output_price: g.output_price ?? null,
        // Yeni model bilerek PASİF başlıyor: fiyatı girilip gözden geçirilmeden
        // kullanıma açılmasın. wf-ortak §4 kontrolsüz erişimi yasaklıyor.
        is_active: false,
        price_checked_at: (g.input_price ?? null) === null ? null : new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      const cakisma = String(error.message).includes('duplicate');
      return c.json({
        error: cakisma ? 'This model already exists in the catalog.' : 'Could not add the model.'
      }, cakisma ? 409 : 500 as any);
    }
    // Katalog değişti; önbellek eskidi.
    invalidateCatalog();
    return c.json({ model: data });
  });

  app.patch('/admin/api/models/:id', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const id = c.req.param('id');
    const g = (await govdeOku<{
      input_price?: number; output_price?: number; is_active?: boolean;
    }>(c)) ?? {};

    const kusur = fiyatKusuru(g.input_price, g.output_price);
    if (kusur) return c.json({ error: kusur }, 400 as any);

    const guncelleme: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof g.input_price === 'number') {
      guncelleme.input_price = g.input_price;
      // Fiyat elle girildiğinde "ne zaman kontrol edildi" damgası tazeleniyor.
      guncelleme.price_checked_at = new Date().toISOString();
    }
    if (typeof g.output_price === 'number') guncelleme.output_price = g.output_price;
    if (typeof g.is_active === 'boolean') guncelleme.is_active = g.is_active;

    const { data, error } = await supabase
      .from('model_catalog')
      .update(guncelleme)
      .eq('id', id)
      .select()
      .single();

    if (error) return c.json({ error: 'Could not update the model.' }, 500 as any);
    // Fiyat ya da aktiflik değişti; önbellek eskidi.
    invalidateCatalog();
    return c.json({ model: data });
  });

  // Bütün müşterilerin istekleri. Portaldaki uçla aynı mantık ama client_id
  // filtresi anahtardan değil, yöneticinin seçiminden geliyor.
  //
  // Portalda olduğu gibi iki sorgu: özet dönemin tamamından, tablo sayfa sayfa.
  app.get('/admin/api/requests', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const s = c.req.query();
    const gun = Number(s.gun ?? 30);
    const offset = Math.max(0, Number(s.offset ?? 0));
    const SAYFA = 50;
    const baslangic = gun > 0
      ? new Date(Date.now() - gun * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const filtrele = (q: any) => {
      let x = q;
      if (baslangic) x = x.gte('created_at', baslangic);
      if (s.client) x = x.eq('client_id', s.client);
      if (s.provider) x = x.eq('provider', s.provider);
      if (s.durum) x = x.eq('status', s.durum);
      // Model süzgeci "sağlayıcı/model" biçiminde geliyor: aynı ad iki
      // sağlayıcıda bulunabildiği için yalnız model adı belirsiz kalırdı.
      if (s.model) {
        const [sag, ...kalan] = s.model.split('/');
        x = x.eq('provider', sag).eq('model', kalan.join('/'));
      }
      return x;
    };

    // İsteği kim attı? Ağ geçidi kişiyi görmüyor, anahtarı görüyor; anahtarın
    // sahibi isteği atan kişi. Tek şirketli kurulumda "Customer" sütunu hep
    // aynı adı yazıyordu, asıl sorulan "bunu kim yaptı" idi.
    const { data: anahtarSahipleri } = await supabase
      .from('client_keys').select('id, user_id, label');
    const { data: kisiSatirlari } = await supabase.from('users').select('id, email');
    const kisiAdi = new Map(
      ((kisiSatirlari ?? []) as Array<{ id: string; email: string }>)
        .map((k) => [k.id, k.email])
    );
    const anahtarKisisi = new Map<string, { id: string; email: string } | null>();
    const anahtarEtiketi = new Map<string, string | null>();
    for (const a of (anahtarSahipleri ?? []) as Array<{
      id: string; user_id: string | null; label: string | null;
    }>) {
      anahtarEtiketi.set(a.id, a.label);
      anahtarKisisi.set(a.id, a.user_id && kisiAdi.has(a.user_id)
        ? { id: a.user_id, email: String(kisiAdi.get(a.user_id)) }
        : null);
    }

    // 1) Dönemin tamamı — özet için
    const { data: tumu, error: h1 } = await filtrele(
      supabase.from('logs')
        .select('status, input_tokens, output_tokens, cost')
        .limit(10000) as any
    );
    if (h1) return c.json({ error: 'Could not read requests.' }, 500 as any);

    const donem = (tumu ?? []) as Array<{
      status: string; input_tokens: number | null;
      output_tokens: number | null; cost: number | null;
    }>;
    const ozet = donem.reduce(
      (a, k) => ({
        istek: a.istek + 1,
        hata: a.hata + (k.status === 'error' ? 1 : 0),
        token: a.token + (k.input_tokens ?? 0) + (k.output_tokens ?? 0),
        maliyet: a.maliyet + Number(k.cost ?? 0)
      }),
      { istek: 0, hata: 0, token: 0, maliyet: 0 }
    );

    // 2) Görüntülenecek sayfa
    const { data: sayfa, error: h2 } = await filtrele(
      supabase.from('logs')
        .select('client_id, key_id, provider, model, status, input_tokens, output_tokens, cost, latency_ms, created_at, error_message, input_price_used, output_price_used')
        .order('created_at', { ascending: false })
        .range(offset, offset + SAYFA - 1) as any
    );
    if (h2) return c.json({ error: 'Could not read requests.' }, 500 as any);

    // Müşteri adları — logs tablosunda yalnızca client_id var.
    const { data: musteriler } = await supabase
      .from('clients')
      .select('id, name')
      .order('name', { ascending: true });

    const adlar = new Map(
      ((musteriler ?? []) as Array<{ id: string; name: string }>).map((m) => [m.id, m.name])
    );

    // Filtre listesi. clients tablosunda istek atmamış ve adı tekrar eden
    // satırlar var; hepsini listelemek listeyi okunmaz yapıyor. Bu yüzden
    // yalnızca dönemde isteği olan müşterileri, istek sayısıyla gösteriyoruz.
    //
    // Sayım müşteri filtresinden bağımsız olmalı — yoksa bir müşteri seçilince
    // liste tek satıra düşer. O yüzden ayrı bir sorgu.
    let sayimSorgu: any = supabase.from('logs').select('client_id').limit(10000);
    if (baslangic) sayimSorgu = sayimSorgu.gte('created_at', baslangic);
    if (s.provider) sayimSorgu = sayimSorgu.eq('provider', s.provider);
    if (s.durum) sayimSorgu = sayimSorgu.eq('status', s.durum);
    const { data: sayimlar } = await sayimSorgu;

    const sayac = new Map<string, number>();
    for (const k of (sayimlar ?? []) as Array<{ client_id: string }>) {
      const id = String(k.client_id);
      sayac.set(id, (sayac.get(id) ?? 0) + 1);
    }

    // Aynı ad birden çok müşteride varsa kimliğin ilk parçasını ekleyip ayırıyoruz.
    const adSayisi = new Map<string, number>();
    for (const id of sayac.keys()) {
      const ad = adlar.get(id) ?? 'Unknown';
      adSayisi.set(ad, (adSayisi.get(ad) ?? 0) + 1);
    }

    const filtreMusterileri = [...sayac.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, adet]) => {
        const ad = adlar.get(id) ?? 'Unknown';
        const etiket = (adSayisi.get(ad) ?? 0) > 1 ? `${ad} · ${id.slice(0, 8)}` : ad;
        return { id, name: ad, label: `${etiket} (${adet})`, adet };
      });

    const kayitlar = ((sayfa ?? []) as Array<Record<string, unknown>>).map((k) => {
      const anahtar = k.key_id ? String(k.key_id) : null;
      const sahip = anahtar ? anahtarKisisi.get(anahtar) ?? null : null;
      return {
        ...k,
        musteri: adlar.get(String(k.client_id)) ?? null,
        kisi: sahip ? sahip.email : null,
        anahtarAdi: anahtar ? anahtarEtiketi.get(anahtar) ?? null : null
      };
    }).filter((k) => {
      // Kişi süzgeci kayıtlar hazırlandıktan sonra uygulanıyor: kişi ile
      // kayıt arasındaki bağ anahtar üzerinden kuruluyor, tek bir SQL
      // koşuluyla ifade edilemiyor.
      if (!s.kisi) return true;
      if (s.kisi === 'yok') return k.kisi === null;
      return k.kisi === s.kisi;
    });

    // Model süzgecinin seçenekleri. Müşteri sayımıyla aynı gerekçe: seçim
    // yapılınca liste tek satıra düşmesin diye model filtresi bu sayıma
    // uygulanmıyor.
    let modelSayimSorgu: any = supabase.from('logs').select('provider, model').limit(10000);
    if (baslangic) modelSayimSorgu = modelSayimSorgu.gte('created_at', baslangic);
    if (s.client) modelSayimSorgu = modelSayimSorgu.eq('client_id', s.client);
    if (s.durum) modelSayimSorgu = modelSayimSorgu.eq('status', s.durum);
    const { data: modelSayimlari } = await modelSayimSorgu;

    const modelSayac = new Map<string, number>();
    for (const k of (modelSayimlari ?? []) as Array<{ provider: string; model: string }>) {
      const ad = `${k.provider}/${k.model}`;
      modelSayac.set(ad, (modelSayac.get(ad) ?? 0) + 1);
    }
    const filtreModelleri = [...modelSayac.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([ad, adet]) => ({ ad, label: `${ad.split('/')[1]} (${adet})` }));

    // Kişi süzgecinin seçenekleri, dönemdeki istek sayılarıyla.
    let kisiSayimSorgu: any = supabase.from('logs').select('key_id').limit(10000);
    if (baslangic) kisiSayimSorgu = kisiSayimSorgu.gte('created_at', baslangic);
    if (s.durum) kisiSayimSorgu = kisiSayimSorgu.eq('status', s.durum);
    const { data: kisiSayimlari } = await kisiSayimSorgu;

    const kisiSayac = new Map<string, number>();
    let sahipsiz = 0;
    for (const k of (kisiSayimlari ?? []) as Array<{ key_id: string | null }>) {
      const sahip = k.key_id ? anahtarKisisi.get(String(k.key_id)) ?? null : null;
      if (!sahip) { sahipsiz += 1; continue; }
      kisiSayac.set(sahip.email, (kisiSayac.get(sahip.email) ?? 0) + 1);
    }
    const filtreKisileri = [...kisiSayac.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([eposta, adet]) => ({ deger: eposta, label: `${eposta} (${adet})` }));
    if (sahipsiz) {
      filtreKisileri.push({ deger: 'yok', label: `Shared or unattributed (${sahipsiz})` });
    }

    return c.json({
      ozet,
      kayitlar,
      toplam: ozet.istek,
      offset,
      musteriler: filtreMusterileri,
      modeller: filtreModelleri,
      kisiler: filtreKisileri,
      fiyatlar: await priceList()
    });
  });

  // ---------------- müşteriler ----------------
  //
  // Müşteri oluşturma bugüne kadar test.ts betiğiyle elle yapılıyordu; bu
  // yüzden veritabanında adı tekrar eden, izni boş satırlar birikti.
  // Buradan oluşturulunca ad, tür ve izinler tek yerden kontrollü giriliyor.

  app.get('/admin/api/customers', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const { data: musteriler, error } = await supabase
      .from('clients')
      .select('id, name, is_active, client_type, allowed_domains, allowed_models, max_output_price, created_at')
      .order('created_at', { ascending: false });
    if (error) return c.json({ error: 'Could not read customers.' }, 500 as any);

    // Anahtarlar. key_hash'i dışarı vermiyoruz — özet bile olsa gereksiz.
    //
    // key_prefix sonradan eklenen bir sütun. Göç çalıştırılmamışsa sorgu hata
    // verir; o durumda öneksiz okuyoruz ki ekran tamamen çökmesin.
    let anahtarlar: unknown[] | null = null;
    const ilk = await supabase
      .from('client_keys')
      .select('id, client_id, environment, is_active, created_at, key_prefix, label, user_id')
      .order('created_at', { ascending: false });
    if (ilk.error) {
      const geri = await supabase
        .from('client_keys')
        .select('id, client_id, environment, is_active, created_at')
        .order('created_at', { ascending: false });
      anahtarlar = geri.data;
    } else {
      anahtarlar = ilk.data;
    }

    // İstek sayısı ve son istek zamanı.
    const { data: kayitlar } = await supabase
      .from('logs').select('client_id, created_at').limit(10000);

    const sayac = new Map<string, { adet: number; son: string | null }>();
    for (const k of (kayitlar ?? []) as Array<{ client_id: string; created_at: string }>) {
      const id = String(k.client_id);
      const o = sayac.get(id) ?? { adet: 0, son: null };
      o.adet += 1;
      if (!o.son || k.created_at > o.son) o.son = k.created_at;
      sayac.set(id, o);
    }

    const anahtarlarPer = new Map<string, unknown[]>();
    for (const a of (anahtarlar ?? []) as Array<{ client_id: string }>) {
      const dizi = anahtarlarPer.get(String(a.client_id)) ?? [];
      dizi.push(a);
      anahtarlarPer.set(String(a.client_id), dizi);
    }

    const liste = ((musteriler ?? []) as Array<Record<string, unknown>>).map((m) => {
      const id = String(m.id);
      const say = sayac.get(id) ?? { adet: 0, son: null };
      return { ...m, anahtarlar: anahtarlarPer.get(id) ?? [], istek: say.adet, sonIstek: say.son };
    });

    return c.json({ musteriler: liste });
  });

  app.post('/admin/api/customers', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const g = (await govdeOku<{
      name?: string; environment?: string; client_type?: string;
      allowed_models?: string[]; allowed_domains?: string[];
    }>(c)) ?? {};
    const ad = String(g.name ?? '').trim();
    if (!ad) return c.json({ error: 'Customer name is required.' }, 400 as any);

    // Anahtar üretimi ve karma Umur'un createNewClient işlevinde; onu çağırıyoruz
    // ki anahtar mantığı tek yerde kalsın.
    const sonuc = await createNewClient(ad, String(g.environment ?? 'production'));
    if (!sonuc.success || !sonuc.clientId) {
      return c.json({ error: 'Could not create the customer.' }, 500 as any);
    }

    // createNewClient yalnızca adı yazıyor; izinleri ayrıca geçiyoruz.
    const { data: guncel, error: h } = await supabase
      .from('clients')
      .update({
        client_type: String(g.client_type ?? 'server-based'),
        allowed_models: Array.isArray(g.allowed_models) ? g.allowed_models : [],
        allowed_domains: Array.isArray(g.allowed_domains) ? g.allowed_domains : []
      })
      .eq('id', sonuc.clientId)
      .select('id, name, is_active, client_type, allowed_domains, allowed_models, created_at')
      .single();

    if (h) return c.json({ error: 'Customer created but permissions could not be saved.' }, 500 as any);

    // Anahtarı createNewClient üretti; öneki burada işliyoruz ki o işlev
    // (Umur'un dosyası) olduğu gibi kalsın. Sütun yoksa sessizce geçiyoruz.
    await supabase.from('client_keys')
      .update({ key_prefix: String(sonuc.plainApiKey).slice(0, 12) })
      .eq('client_id', sonuc.clientId);

    // Açık anahtar yalnızca burada dönüyor; veritabanında karması duruyor.
    return c.json({ musteri: { ...guncel, anahtarlar: [], istek: 0, sonIstek: null }, anahtar: sonuc.plainApiKey });
  });

  app.patch('/admin/api/customers/:id', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const id = c.req.param('id');
    const g = (await govdeOku<{
      name?: string; is_active?: boolean; client_type?: string;
      allowed_models?: string[]; allowed_domains?: string[];
      max_output_price?: number | null;
      monthly_budget?: number | null; daily_budget?: number | null;
    }>(c)) ?? {};

    const guncelleme: Record<string, unknown> = {};
    if (g.monthly_budget !== undefined) {
      guncelleme.monthly_budget = g.monthly_budget === null ? null : Number(g.monthly_budget);
    }
    if (g.daily_budget !== undefined) {
      guncelleme.daily_budget = g.daily_budget === null ? null : Number(g.daily_budget);
    }
    if (g.max_output_price !== undefined) {
      // Panelde 1M başına giriliyor, veritabanında 1K başına saklanıyor —
      // model_catalog ile aynı ölçek.
      guncelleme.max_output_price =
        g.max_output_price === null ? null : Number(g.max_output_price);
    }
    if (typeof g.name === 'string' && g.name.trim()) guncelleme.name = g.name.trim();
    if (typeof g.is_active === 'boolean') guncelleme.is_active = g.is_active;
    if (typeof g.client_type === 'string') guncelleme.client_type = g.client_type;
    if (Array.isArray(g.allowed_models)) guncelleme.allowed_models = g.allowed_models;
    if (Array.isArray(g.allowed_domains)) guncelleme.allowed_domains = g.allowed_domains;
    if (!Object.keys(guncelleme).length) {
      return c.json({ error: 'Nothing to update.' }, 400 as any);
    }

    const { data, error } = await supabase
      .from('clients').update(guncelleme).eq('id', id)
      .select('id, name, is_active, client_type, allowed_domains, allowed_models, max_output_price, created_at')
      .single();
    if (error) return c.json({ error: 'Could not update the customer.' }, 500 as any);
    return c.json({ musteri: data });
  });

  // Yeni anahtar. Kaybolan anahtar geri getirilemez (yalnızca karması saklanıyor),
  // bu yüzden çözüm yenisini vermek. Eskisi isteğe bağlı olarak kapatılıyor.
  app.post('/admin/api/customers/:id/keys', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const id = c.req.param('id');
    const g = (await govdeOku<{
      environment?: string; eskileriKapat?: boolean; user_id?: string | null; label?: string;
    }>(c)) ?? {};

    const { data: musteri } = await supabase
      .from('clients').select('id').eq('id', id).single();
    if (!musteri) return c.json({ error: 'Customer not found.' }, 404 as any);

    // Yalnızca o kişinin anahtarları iptal ediliyor; başkasının anahtarını
    // kapatmak yan etki olurdu.
    if (g.eskileriKapat) {
      let kapat = supabase.from('client_keys')
        .update({ is_active: false }).eq('client_id', id);
      if (g.user_id) kapat = kapat.eq('user_id', g.user_id);
      await kapat;
    }

    const acik = generateProxyKey();
    const satir: Record<string, unknown> = {
      client_id: id,
      key_hash: hashApiKey(acik),
      environment: String(g.environment ?? 'production'),
      key_prefix: acik.slice(0, 12)
    };
    // Sahibi olan anahtar o kişinin kullanımı sayılıyor; sahipsizler ortak.
    if (g.user_id) satir.user_id = g.user_id;
    if (g.label) satir.label = String(g.label).trim();

    let ekleme = await supabase.from('client_keys').insert([satir])
      .select('id, client_id, environment, is_active, created_at, key_prefix, label, user_id').single();
    if (ekleme.error) {
      // key_prefix sütunu yoksa öneksiz yazıyoruz.
      delete satir.key_prefix;
      ekleme = await supabase.from('client_keys').insert([satir])
        .select('id, client_id, environment, is_active, created_at').single() as typeof ekleme;
    }
    const { data, error } = ekleme;

    if (error) return c.json({ error: 'Could not issue a key.' }, 500 as any);

    // Anahtarın sahibi varsa açık değeri yöneticiye DÖNMÜYORUZ; şifrelenip
    // tek kullanımlık bir bağlantıya konuyor. Yönetici bağlantıyı iletiyor,
    // anahtarı yalnızca sahibi görüyor.
    //
    // Sahipsiz (ortak servis) anahtarlarında teslim edilecek bir kişi yok;
    // orada açık değer yöneticide kalıyor, başka yolu yok.
    const kayit = data as { id: string } | null;
    if (g.user_id && kayit) {
      const teslim = await teslimOlustur(kayit.id, String(g.user_id), acik);
      if (teslim.ok) {
        return c.json({
          anahtarKaydi: data,
          teslimJetonu: teslim.jeton,
          sonKullanma: teslim.sonKullanma
        });
      }
      // Teslim kaydı açılamadıysa anahtarı kaybetmemek için açık dönüyoruz;
      // aksi halde üretilmiş ama kimsenin ulaşamayacağı bir anahtar kalırdı.
      return c.json({ anahtarKaydi: data, anahtar: acik, teslimHatasi: teslim.hata });
    }

    return c.json({ anahtarKaydi: data, anahtar: acik });
  });

  app.patch('/admin/api/keys/:id', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const id = c.req.param('id');
    const g = (await govdeOku<{ is_active?: boolean }>(c)) ?? {};
    if (typeof g.is_active !== 'boolean') {
      return c.json({ error: 'is_active is required.' }, 400 as any);
    }

    const { data, error } = await supabase
      .from('client_keys').update({ is_active: g.is_active }).eq('id', id)
      .select('id, client_id, environment, is_active, created_at').single();
    if (error) return c.json({ error: 'Could not update the key.' }, 500 as any);
    return c.json({ anahtarKaydi: data });
  });

  // ---------------- genel bakış ----------------
  //
  // Requests ekranı tek tek kayıtları gösteriyor; burası aynı verinin
  // toplamı: kim harcıyor, hangi model, sistemde bakım isteyen ne var.
  app.get('/admin/api/overview', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const s = c.req.query();
    const gun = Number(s.gun ?? 30);
    const baslangic = gun > 0
      ? new Date(Date.now() - gun * 24 * 60 * 60 * 1000).toISOString()
      : null;

    let sorgu: any = supabase
      .from('logs')
      .select('client_id, provider, model, status, input_tokens, output_tokens, cost, latency_ms, created_at')
      .limit(10000);
    if (baslangic) sorgu = sorgu.gte('created_at', baslangic);
    const { data: kayitlar, error } = await sorgu;
    if (error) return c.json({ error: 'Could not read the overview.' }, 500 as any);

    type Kayit = {
      client_id: string; provider: string; model: string; status: string;
      input_tokens: number | null; output_tokens: number | null;
      cost: number | null; latency_ms: number | null; created_at: string;
    };
    const veri = (kayitlar ?? []) as Kayit[];

    const { data: musteriler } = await supabase
      .from('clients').select('id, name, is_active, allowed_models');
    const adlar = new Map(
      ((musteriler ?? []) as Array<{ id: string; name: string }>).map((m) => [m.id, m.name])
    );

    const { data: katalogSatirlari } = await supabase
      .from('model_catalog').select('provider, model, input_price, output_price, is_active, price_checked_at');

    // Toplamlar
    const ozet = veri.reduce(
      (a, k) => ({
        istek: a.istek + 1,
        hata: a.hata + (k.status === 'error' ? 1 : 0),
        bekleyen: a.bekleyen + (k.status === 'pending' ? 1 : 0),
        token: a.token + (k.input_tokens ?? 0) + (k.output_tokens ?? 0),
        maliyet: a.maliyet + Number(k.cost ?? 0),
        sure: a.sure + (k.latency_ms ?? 0),
        sureli: a.sureli + (k.latency_ms ? 1 : 0)
      }),
      { istek: 0, hata: 0, bekleyen: 0, token: 0, maliyet: 0, sure: 0, sureli: 0 }
    );

    // Günlük seri. Boş günler de diziye giriyor, yoksa grafik zamanı yanlış
    // ölçekler — portaldaki grafikle aynı mantık.
    const gunAnahtar = (t: string) => t.slice(0, 10);
    const gunluk = new Map<string, { istek: number; maliyet: number; hata: number }>();
    for (const k of veri) {
      const g = gunAnahtar(k.created_at);
      const o = gunluk.get(g) ?? { istek: 0, maliyet: 0, hata: 0 };
      o.istek += 1;
      o.maliyet += Number(k.cost ?? 0);
      o.hata += k.status === 'error' ? 1 : 0;
      gunluk.set(g, o);
    }
    const ilk = veri.length
      ? veri.reduce((a, k) => (k.created_at < a ? k.created_at : a), veri[0]!.created_at).slice(0, 10)
      : null;
    const seri: Array<{ gun: string; istek: number; maliyet: number; hata: number }> = [];
    if (ilk) {
      const bas = baslangic ? new Date(baslangic) : new Date(ilk + 'T00:00:00Z');
      const son = new Date();
      for (const d = new Date(bas); d <= son; d.setUTCDate(d.getUTCDate() + 1)) {
        const g = d.toISOString().slice(0, 10);
        seri.push({ gun: g, ...(gunluk.get(g) ?? { istek: 0, maliyet: 0, hata: 0 }) });
      }
    }

    // Müşteri ve model kırılımı
    const topla = <T extends string>(anahtar: (k: Kayit) => T) => {
      const m = new Map<T, { istek: number; hata: number; token: number; maliyet: number }>();
      for (const k of veri) {
        const a = anahtar(k);
        const o = m.get(a) ?? { istek: 0, hata: 0, token: 0, maliyet: 0 };
        o.istek += 1;
        o.hata += k.status === 'error' ? 1 : 0;
        o.token += (k.input_tokens ?? 0) + (k.output_tokens ?? 0);
        o.maliyet += Number(k.cost ?? 0);
        m.set(a, o);
      }
      return m;
    };

    const musteriKirilim = [...topla((k) => String(k.client_id)).entries()]
      .map(([id, o]) => ({ id, ad: adlar.get(id) ?? 'Unknown', ...o }))
      .sort((a, b) => b.maliyet - a.maliyet || b.istek - a.istek);

    const modelKirilim = [...topla((k) => `${k.provider}/${k.model}`).entries()]
      .map(([ad, o]) => ({ ad, provider: ad.split('/')[0], ...o }))
      .sort((a, b) => b.maliyet - a.maliyet || b.istek - a.istek);

    // Bakım isteyen noktalar. Panelin varlık sebebi bunları görünür kılmak.
    const katalog = (katalogSatirlari ?? []) as Array<{
      provider: string; model: string;
      input_price: number | null; output_price: number | null;
      is_active: boolean; price_checked_at: string | null;
    }>;

    // Fiyat eskimesi. Bu sayı eşleştirmeden bağımsız: kaynak model adını
    // değiştirip eşleştirme kırılsa bile, doğrulanmayan fiyat burada birikir.
    // Denetim ekranına kimse bakmasa da Dashboard'da görünür.
    const BAYAT_GUN = 90;
    const bayatSinir = Date.now() - BAYAT_GUN * 24 * 60 * 60 * 1000;
    const bayatFiyat = katalog.filter((m) =>
      !m.price_checked_at || new Date(m.price_checked_at).getTime() < bayatSinir).length;
    const mList = (musteriler ?? []) as Array<{ is_active: boolean; allowed_models: string[] | null }>;

    const bakim = {
      fiyatsizModel: katalog.filter((m) => m.input_price === null || m.output_price === null).length,
      pasifModel: katalog.filter((m) => !m.is_active).length,
      toplamModel: katalog.length,
      izinsizMusteri: mList.filter((m) => !(m.allowed_models ?? []).length).length,
      askidaMusteri: mList.filter((m) => !m.is_active).length,
      toplamMusteri: mList.length,
      bekleyenIstek: ozet.bekleyen,
      bayatFiyat,
      bayatGun: BAYAT_GUN
    };

    return c.json({
      ozet: {
        istek: ozet.istek,
        hata: ozet.hata,
        token: ozet.token,
        maliyet: ozet.maliyet,
        ortSure: ozet.sureli ? Math.round(ozet.sure / ozet.sureli) : 0,
        aktifMusteri: musteriKirilim.length
      },
      seri,
      musteriler: musteriKirilim,
      modeller: modelKirilim,
      bakim,
      katalog: await catalogInfo()
    });
  });

  // Müşteri silme. Yalnızca hiç isteği olmayan müşteri silinebiliyor:
  // kayıtları olan bir müşteri silinirse geçmiş logların sahibi kaybolur,
  // maliyet raporları kime ait olduğu belirsiz satırlarla dolar.
  // İşi biten müşteri için doğru yol askıya almak, silmek değil.
  app.delete('/admin/api/customers/:id', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const id = c.req.param('id');

    const { data: kayit } = await supabase
      .from('logs').select('id').eq('client_id', id).limit(1);
    if ((kayit ?? []).length) {
      return c.json({
        error: 'This customer has request history and cannot be deleted. Suspend it instead.'
      }, 409 as any);
    }

    // Anahtarlar önce: client_id'ye bağlı oldukları için müşteri kalırsa
    // yetim satır bırakırlar.
    const { error: ah } = await supabase.from('client_keys').delete().eq('client_id', id);
    if (ah) return c.json({ error: 'Could not remove the keys.' }, 500 as any);

    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (error) return c.json({ error: 'Could not delete the customer.' }, 500 as any);
    return c.json({ silindi: true });
  });

  // İsteklerin CSV dökümü. Requests ekranındaki filtreler aynen geçerli.
  // Portaldaki dışa aktarmayla aynı biçim: noktalı virgül ayraç, ondalıkta
  // virgül, başta BOM — Türkçe Excel dosyayı böyle doğru açıyor.
  app.get('/admin/api/export', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const s = c.req.query();
    const gun = Number(s.gun ?? 30);
    const baslangic = gun > 0
      ? new Date(Date.now() - gun * 24 * 60 * 60 * 1000).toISOString()
      : null;

    let sorgu = supabase
      .from('logs')
      .select('created_at, client_id, provider, model, input_tokens, output_tokens, latency_ms, cost, status, error_message')
      .order('created_at', { ascending: false })
      .limit(10000) as any;
    if (baslangic) sorgu = sorgu.gte('created_at', baslangic);
    if (s.client) sorgu = sorgu.eq('client_id', s.client);
    if (s.provider) sorgu = sorgu.eq('provider', s.provider);
    if (s.durum) sorgu = sorgu.eq('status', s.durum);
    if (s.model) {
      const [sag, ...kalan] = s.model.split('/');
      sorgu = sorgu.eq('provider', sag).eq('model', kalan.join('/'));
    }

    const { data, error } = await sorgu;
    if (error) return c.json({ error: 'Could not read records.' }, 500 as any);

    const { data: musteriler } = await supabase.from('clients').select('id, name');
    const adlar = new Map(
      ((musteriler ?? []) as Array<{ id: string; name: string }>).map((m) => [m.id, m.name])
    );

    const alan = (v: unknown) => {
      const t = v === null || v === undefined ? '' : String(v);
      return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };

    const satirlar = [
      ['tarih', 'musteri', 'saglayici', 'model', 'girdi_token', 'cikti_token',
       'sure_ms', 'maliyet_usd', 'durum', 'hata'].join(';')
    ];
    for (const k of (data ?? []) as Array<Record<string, unknown>>) {
      satirlar.push([
        alan(k.created_at),
        alan(adlar.get(String(k.client_id)) ?? ''),
        alan(k.provider),
        alan(k.model),
        alan(k.input_tokens ?? 0),
        alan(k.output_tokens ?? 0),
        alan(k.latency_ms ?? 0),
        alan(String(Number(k.cost ?? 0).toFixed(8)).replace('.', ',')),
        alan(k.status),
        alan(k.error_message)
      ].join(';'));
    }

    const dosya = 'istekler-' + new Date().toISOString().slice(0, 10) + '.csv';
    c.header('content-type', 'text/csv; charset=utf-8');
    c.header('content-disposition', 'attachment; filename="' + dosya + '"');
    return c.body('﻿' + satirlar.join('\n'));
  });

  // ---------------- fiyat denetimi ----------------
  //
  // Fiyatları elle giriyoruz ve hiçbir şey doğruluğunu kontrol etmiyordu.
  // gpt-4o'nun fiyatı yarıya düştüğünde tablomuz eski kaldı, kimse fark etmedi.
  // Burası o körlüğü kapatıyor: dış kaynakla farkı gösteriyor, kararı bırakıyor.

  app.get('/admin/api/prices', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const [or, lite] = await Promise.all([kaynakFiyatlari(), liteFiyatlari()]);

    const { data: katalogSatirlari, error } = await supabase
      .from('model_catalog')
      .select('id, provider, model, input_price, output_price, is_active, price_checked_at, source_ids, litellm_ids, price_source, son_fiyat_notu')
      .order('provider', { ascending: true });

    if (error) {
      const eksikSutun = /source_ids|litellm_ids|column/i.test(String(error.message));
      return c.json({
        error: eksikSutun
          ? 'The price audit needs new columns on model_catalog. Run kaynak-listesi.sql first.'
          : 'Could not read the catalog.'
      }, eksikSutun ? 428 : 500 as any);
    }

    type Satir = {
      id: string; provider: string; model: string;
      input_price: number | null; output_price: number | null;
      is_active: boolean; price_checked_at: string | null;
      source_ids: string[] | null; litellm_ids: string[] | null;
      price_source: string | null; son_fiyat_notu: string | null;
    };
    const katalog = (katalogSatirlari ?? []) as Satir[];
    const ESIK = 0.000001;

    const karsilastirma = await Promise.all(katalog.map(async (m) => {
      const orIds = Array.isArray(m.source_ids) ? m.source_ids : [];
      const liteIds = Array.isArray(m.litellm_ids) ? m.litellm_ids : [];
      const bg = Number(m.input_price ?? 0), bc = Number(m.output_price ?? 0);

      const temel = {
        id: m.id, provider: m.provider, model: m.model,
        bizimGirdi: m.input_price, bizimCikti: m.output_price,
        orIds, liteIds,
        okumalar: [] as unknown[],
        kaynakGirdi: null as number | null,
        kaynakCikti: null as number | null,
        dogrulandi: false,
        ayrisiyor: false,
        fiyatKaynagi: m.price_source ?? 'manual',
        kontrolTarihi: m.price_checked_at,
        not: m.son_fiyat_notu,
        adaylar: [] as string[],
        // Ad kaybolduğunda fiyat sürekliliğiyle bulunan öneri.
        onerilenEslesme: null as { kimlik: string; girdi: number; cikti: number } | null,
        durum: 'kaynak-yok' as
          | 'uyuyor' | 'ucuzlamis' | 'zamlanmis' | 'eslesmemis'
          | 'kaynakta-yok' | 'ayrisiyor' | 'kaynak-yok'
      };

      if (!or && !lite) return temel;

      // Hiç eşleştirilmemişse: aday listesi + fiyat sürekliliğiyle öneri.
      if (!orIds.length && !liteIds.length) {
        const oneri = or ? fiyatlaYenidenEslestir(m.provider, m.model, bg, bc, or.fiyatlar) : null;
        return {
          ...temel,
          adaylar: or ? olasiKarsiliklar(m.provider, m.model, or.fiyatlar) : [],
          onerilenEslesme: oneri?.secilen
            ? { kimlik: oneri.secilen.kimlik, girdi: oneri.secilen.girdi, cikti: oneri.secilen.cikti }
            : null,
          durum: 'eslesmemis' as const
        };
      }

      const okuma = await ikiKaynaktanOku(orIds, liteIds);

      // Eşleştirme var ama hiçbir kaynakta bulunamıyor: ad değişmiş olabilir.
      // Fiyat sürekliliğiyle yeni adı öneriyoruz, uygulamayı yöneticiye bırakarak.
      if (!okuma.okumalar.length) {
        const oneri = or ? fiyatlaYenidenEslestir(m.provider, m.model, bg, bc, or.fiyatlar) : null;
        return {
          ...temel,
          adaylar: or ? olasiKarsiliklar(m.provider, m.model, or.fiyatlar) : [],
          onerilenEslesme: oneri?.secilen
            ? { kimlik: oneri.secilen.kimlik, girdi: oneri.secilen.girdi, cikti: oneri.secilen.cikti }
            : null,
          durum: 'kaynakta-yok' as const
        };
      }

      const kg = okuma.girdi ?? 0, kc = okuma.cikti ?? 0;
      const ayni = Math.abs(bg - kg) < ESIK && Math.abs(bc - kc) < ESIK;
      const ucuz = (kg + kc) < (bg + bc);

      return {
        ...temel,
        okumalar: okuma.okumalar,
        kaynakGirdi: kg,
        kaynakCikti: kc,
        dogrulandi: okuma.dogrulandi,
        ayrisiyor: okuma.ayrisiyor,
        durum: okuma.ayrisiyor
          ? ('ayrisiyor' as const)
          : ayni ? ('uyuyor' as const) : ucuz ? ('ucuzlamis' as const) : ('zamlanmis' as const)
      };
    }));

    // Katalogda olmayıp müşterilerin denediği modeller.
    const { data: hatalar } = await supabase
      .from('logs')
      .select('provider, model, error_message, created_at')
      .eq('status', 'error')
      .order('created_at', { ascending: false })
      .limit(2000);

    const bilinen = new Set(katalog.map((m) => `${m.provider}/${m.model}`));
    const talepSayac = new Map<string, { provider: string; model: string; adet: number; son: string }>();
    const saglayiciSayac = new Map<string, {
      provider: string; model: string; adet: number; son: string; mesaj: string;
    }>();

    for (const h of (hatalar ?? []) as Array<{
      provider: string; model: string; error_message: string | null; created_at: string;
    }>) {
      const mesaj = String(h.error_message ?? '');
      const ad = `${h.provider}/${h.model}`;

      if (katalogRedMi(mesaj) && !bilinen.has(ad)) {
        const o = talepSayac.get(ad) ?? { provider: h.provider, model: h.model, adet: 0, son: h.created_at };
        o.adet += 1;
        if (h.created_at > o.son) o.son = h.created_at;
        talepSayac.set(ad, o);
        continue;
      }

      // Sağlayıcının reddettikleri: katalogda duran ama artık çalışmayan modeller.
      if (saglayiciRedMi(mesaj) && bilinen.has(ad)) {
        const o = saglayiciSayac.get(ad) ?? {
          provider: h.provider, model: h.model, adet: 0, son: h.created_at, mesaj
        };
        o.adet += 1;
        if (h.created_at > o.son) { o.son = h.created_at; o.mesaj = mesaj; }
        saglayiciSayac.set(ad, o);
      }
    }

    const talepler = [...talepSayac.entries()]
      .map(([ad, o]) => {
        const aday = or ? olasiKarsiliklar(o.provider, o.model, or.fiyatlar) : [];
        const ilk = aday[0] ? or?.fiyatlar.get(aday[0]) : undefined;
        return {
          ad, provider: o.provider, model: o.model, adet: o.adet, son: o.son,
          onerilenKaynak: aday[0] ?? null,
          onerilenGirdi: ilk?.girdi ?? null,
          onerilenCikti: ilk?.cikti ?? null
        };
      })
      .sort((a, b) => b.adet - a.adet);

    const saglayiciHatalari = [...saglayiciSayac.entries()]
      .map(([ad, o]) => ({
        ad, provider: o.provider, model: o.model, adet: o.adet, son: o.son,
        kod: (o.mesaj.match(/(\d{3})/) ?? [])[1] ?? null
      }))
      .sort((a, b) => b.adet - a.adet);

    return c.json({ karsilastirma, talepler, saglayiciHatalari, kaynaklar: kaynakDurumu() });
  });

  // Kaynak eşleştirmesini kaydeder.
  //
  // Tek kimlik yerine liste tutuyoruz: sağlayıcı ad değiştirdiğinde eskisi ve
  // yenisi bir süre birlikte yayında kalıyor, ikisini de saklarsak geçiş
  // döneminde hiçbir şey kırılmıyor.
  app.post('/admin/api/prices/map', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const g = (await govdeOku<{ id?: string; source_ids?: string[]; litellm_ids?: string[] }>(c)) ?? {};
    if (!g?.id) return c.json({ error: 'Model id is required.' }, 400 as any);

    const temizle = (d: unknown) =>
      Array.isArray(d) ? [...new Set(d.map((x) => String(x).trim()).filter(Boolean))] : [];

    const guncelleme: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (g.source_ids !== undefined) guncelleme.source_ids = temizle(g.source_ids);
    if (g.litellm_ids !== undefined) guncelleme.litellm_ids = temizle(g.litellm_ids);

    const { data, error } = await supabase
      .from('model_catalog').update(guncelleme).eq('id', g.id)
      .select('id, source_ids, litellm_ids').single();
    if (error) return c.json({ error: 'Could not save the mapping.' }, 500 as any);
    return c.json({ model: data });
  });

  // Kırılan eşleştirmeleri fiyat sürekliliğiyle onarır.
  //
  // Sağlayıcı bir modelin adını değiştirdiğinde eşleştirme boşa düşer. Adaylar
  // arasından, son bilinen fiyata yakın olanı seçiyoruz — ad değişikliği
  // fiyatı değiştirmez, farklı bir model ise fiyatı kat kat sapar.
  //
  // Yalnızca eşleştirmeye ekleme yapıyor; fiyata dokunmuyor. Fiyat değişimi
  // ayrı bir onay adımı olarak kalıyor.
  app.post('/admin/api/prices/rematch', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const [or, lite] = await Promise.all([kaynakFiyatlari(), liteFiyatlari()]);
    if (!or && !lite) {
      return c.json({ error: 'Price sources are unreachable right now.' }, 503 as any);
    }

    const g = (await govdeOku<{ id?: string }>(c)) ?? {};
    let sorgu = supabase
      .from('model_catalog')
      .select('id, provider, model, input_price, output_price, source_ids, litellm_ids');
    if (g.id) sorgu = sorgu.eq('id', g.id);
    const { data: satirlar, error } = await sorgu;
    if (error) return c.json({ error: 'Could not read the catalog.' }, 500 as any);

    const simdi = new Date().toISOString();
    const baglanan: Array<{ model: string; kimlik: string; sapma: string }> = [];
    const belirsiz: Array<{ model: string; sebep: string }> = [];

    for (const m of (satirlar ?? []) as Array<{
      id: string; provider: string; model: string;
      input_price: number | null; output_price: number | null;
      source_ids: string[] | null; litellm_ids: string[] | null;
    }>) {
      const orMevcut = Array.isArray(m.source_ids) ? m.source_ids : [];
      const liteMevcut = Array.isArray(m.litellm_ids) ? m.litellm_ids : [];
      const bg = Number(m.input_price ?? 0), bc = Number(m.output_price ?? 0);

      const guncelleme: Record<string, unknown> = {};
      const notlar: string[] = [];
      const eklenen: string[] = [];

      // --- OpenRouter ---
      const orCalisiyor = or ? orMevcut.some((k) => or.fiyatlar.has(k)) : false;
      if (or && !orCalisiyor) {
        const sonuc = fiyatlaYenidenEslestir(m.provider, m.model, bg, bc, or.fiyatlar);
        if (sonuc.sonuc === 'baglandi' && sonuc.secilen) {
          guncelleme.source_ids = [...orMevcut, sonuc.secilen.kimlik];
          eklenen.push(sonuc.secilen.kimlik);
          notlar.push(`OpenRouter → ${sonuc.secilen.kimlik} (matched by ${
            sonuc.gerekce === 'ad' ? 'name' : 'price continuity'})`);
        }
      }

      // --- LiteLLM ---
      //
      // İkinci kaynağı da otomatik dolduruyoruz. Elle yazdırmak, otomatikleştirmeye
      // çalıştığımız işi yarım bırakmak olurdu.
      const liteCalisiyor = lite ? liteMevcut.some((k) => lite.fiyatlar.has(k)) : false;
      if (lite && !liteCalisiyor) {
        const adaylar = liteAdaylari(m.model, lite.fiyatlar);
        const toplam = bg + bc;

        // Aynı model birçok platform önekiyle listeleniyor: doğrudan sağlayıcı
        // fiyatı da var, aracı platformların kendi fiyatı da (deepinfra, vertex,
        // snowflake...). Aracıların fiyatı sapabiliyor ve o zaman iki kaynak
        // "ayrışıyor" görünüyor — oysa sorun modelin farklılığı değil, yanlış
        // adayı seçmemiz.
        //
        // Bu yüzden eşiği geçen ilki değil, fiyatı BİZE EN YAKIN olanı alıyoruz.
        // Eşitlikte önek sayısı az olan, yani doğrudan sağlayıcı kaydı kazanıyor.
        const puanli = adaylar
          .map((k) => {
            const f = lite.fiyatlar.get(k);
            if (!f) return null;
            const sapma = toplam > 0
              ? Math.abs((f.girdi + f.cikti) - toplam) / toplam
              : 0;
            return { k, sapma, dilim: k.split('/').length };
          })
          .filter((x): x is { k: string; sapma: number; dilim: number } => x !== null)
          .filter((x) => toplam <= 0 || x.sapma <= 0.25)
          .sort((a, b) => a.sapma - b.sapma || a.dilim - b.dilim || a.k.length - b.k.length);

        const uygun = puanli[0]?.k;

        if (uygun) {
          guncelleme.litellm_ids = [...liteMevcut, uygun];
          eklenen.push(uygun);
          notlar.push(`LiteLLM → ${uygun}`);
        }
      }

      if (!Object.keys(guncelleme).length) {
        // Zaten çalışan eşleştirmesi olanları rapora sokmuyoruz.
        if (orCalisiyor && (liteCalisiyor || !lite)) continue;
        belirsiz.push({
          model: `${m.provider}/${m.model}`,
          sebep: 'no candidate matches the last known price in either source'
        });
        continue;
      }

      guncelleme.son_fiyat_notu =
        `Auto-mapped on ${simdi.slice(0, 10)}: ${notlar.join(', ')}.`;
      guncelleme.updated_at = simdi;

      const { error: h } = await supabase
        .from('model_catalog').update(guncelleme).eq('id', m.id);
      if (h) continue;

      baglanan.push({
        model: `${m.provider}/${m.model}`,
        kimlik: eklenen.join(' + '),
        sapma: notlar.join('; ')
      });
    }

    return c.json({ baglanan, belirsiz });
  });

  // Kaynak fiyatını uygular.
  //
  // sadeceDususler: yalnızca ucuzlamış modelleri uygular. Ayrımın sebebi,
  // yanlış yönde hata yapmanın bedeli farklı: kaynak yanılıp fiyatı düşük
  // gösterirse müşteriye eksik fatura çıkarırız, yüksek gösterirse fazla.
  // Fazla faturalandırma daha ağır bir hata, o yüzden zamlar onay bekliyor.
  app.post('/admin/api/prices/apply', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const g = (await govdeOku<{ id?: string; sadeceDususler?: boolean }>(c)) ?? {};
    const [or, lite] = await Promise.all([kaynakFiyatlari(), liteFiyatlari()]);
    if (!or && !lite) {
      return c.json({ error: 'Price sources are unreachable right now.' }, 503 as any);
    }

    let sorgu = supabase
      .from('model_catalog')
      .select('id, provider, model, input_price, output_price, source_ids, litellm_ids');
    if (g.id) sorgu = sorgu.eq('id', g.id);
    const { data: satirlar, error } = await sorgu;
    if (error) return c.json({ error: 'Could not read the catalog.' }, 500 as any);

    const simdi = new Date().toISOString();
    const uygulanan: Array<{ model: string; eski: string; yeni: string; kaynak: string }> = [];
    const atlanan: Array<{ model: string; sebep: string }> = [];

    for (const m of (satirlar ?? []) as Array<{
      id: string; provider: string; model: string;
      input_price: number | null; output_price: number | null;
      source_ids: string[] | null; litellm_ids: string[] | null;
    }>) {
      const okuma = await ikiKaynaktanOku(
        Array.isArray(m.source_ids) ? m.source_ids : [],
        Array.isArray(m.litellm_ids) ? m.litellm_ids : []
      );
      if (!okuma.okumalar.length) continue;

      // İki kaynak farklı fiyat söylüyorsa hangisinin doğru olduğu belli değil.
      // Tek kaynağa güvenip uygulamak, denetimin amacını bozar.
      if (okuma.ayrisiyor) {
        atlanan.push({
          model: `${m.provider}/${m.model}`,
          sebep: 'the two sources disagree on the price'
        });
        continue;
      }

      const kg = okuma.girdi ?? 0, kc = okuma.cikti ?? 0;
      const bg = Number(m.input_price ?? 0), bc = Number(m.output_price ?? 0);
      if (Math.abs(bg - kg) < 0.000001 && Math.abs(bc - kc) < 0.000001) {
        // Değişiklik yok ama doğrulama yapıldı; damgayı tazeliyoruz.
        await supabase.from('model_catalog').update({
          price_checked_at: simdi,
          price_source: okuma.dogrulandi ? 'verified' : (okuma.okumalar[0]?.kaynak ?? 'source')
        }).eq('id', m.id);
        continue;
      }
      if (g.sadeceDususler && (kg + kc) >= (bg + bc)) continue;

      const kaynakAdi = okuma.okumalar.map((o) => o.kaynak).join(' + ');
      const { error: h } = await supabase
        .from('model_catalog')
        .update({
          input_price: kg,
          output_price: kc,
          price_checked_at: simdi,
          price_source: okuma.dogrulandi ? 'verified' : (okuma.okumalar[0]?.kaynak ?? 'source'),
          son_fiyat_notu:
            `Price updated from ${kaynakAdi} on ${simdi.slice(0, 10)}` +
            (okuma.dogrulandi ? ' (both sources agree).' : ' (single source).'),
          updated_at: simdi
        })
        .eq('id', m.id);
      if (h) continue;

      uygulanan.push({
        model: `${m.provider}/${m.model}`,
        eski: `$${(bg * 1000).toFixed(2)} / $${(bc * 1000).toFixed(2)}`,
        yeni: `$${(kg * 1000).toFixed(2)} / $${(kc * 1000).toFixed(2)}`,
        kaynak: kaynakAdi
      });
    }

    // Fiyat değişti; katalog önbelleği eskidi.
    if (uygulanan.length) invalidateCatalog();
    return c.json({ uygulanan, atlanan });
  });

  // ---------------- erişim talepleri ----------------
  //
  // Bir müşteri izinli olmadığı bir modeli denediğinde 403 alıyor ve bu
  // kayıtlara giriyordu — ama hiçbir ekranda görünmüyordu. Yani "kim hangi
  // modele geçmek istiyor" bilgisi elimizde duruyor, kimse bakmıyordu.
  //
  // Talep için ayrı bir mekanizma kurmaya gerek yok: reddedilen her istek
  // zaten bir talep. Portala düğme koymadan da müşterinin ne istediğini
  // biliyoruz.
  app.get('/admin/api/access-requests', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const { data: hatalar } = await supabase
      .from('logs')
      .select('client_id, key_id, provider, model, error_message, created_at')
      .eq('status', 'error')
      .order('created_at', { ascending: false })
      .limit(3000);

    // Talebi KİŞİYE bağlıyoruz. Ağ geçidi kişiyi görmüyor ama anahtarı
    // görüyor; anahtarın sahibi talebi yapan kişi. Sahipsiz anahtarlarda
    // (ortak servisler) kime izin verileceği belli olmadığı için talep
    // şirkete kalıyor.
    const { data: anahtarSatir } = await supabase
      .from('client_keys').select('id, user_id');
    const anahtarSahibi = new Map(
      ((anahtarSatir ?? []) as Array<{ id: string; user_id: string | null }>)
        .map((a) => [a.id, a.user_id])
    );

    const { data: kisiSatir } = await supabase
      .from('users').select('id, email, client_id, allowed_models, max_output_price');
    const kisiler = new Map(
      ((kisiSatir ?? []) as Array<{
        id: string; email: string; client_id: string;
        allowed_models: string[] | null; max_output_price: number | null;
      }>).map((k) => [k.id, k])
    );

    const { data: musteriler } = await supabase
      .from('clients').select('id, name, allowed_models, is_active, max_output_price');
    const musteriHarita = new Map(
      ((musteriler ?? []) as Array<{
        id: string; name: string; allowed_models: string[] | null;
        is_active: boolean; max_output_price: number | null;
      }>).map((m) => [m.id, m])
    );

    // Katalogdaki modeller — pasif olanlar dahil.
    //
    // Pasifleri dışarıda bırakmak zinciri kırıyordu: müşteri bilinmeyen bir
    // modeli çağırınca 400 alıyor, gece denetimi modeli pasif olarak
    // ekliyor, yönetici aktif ediyor — ama talep hiçbir yerde görünmediği
    // için müşterinin bir kez daha denemesi gerekiyordu.
    const { data: katalog } = await supabase
      .from('model_catalog').select('provider, model, is_active, output_price');
    const katalogSatirlari = (katalog ?? []) as Array<{
      provider: string; model: string; is_active: boolean; output_price: number | null;
    }>;
    const katalogDurumu = new Map(
      katalogSatirlari.map((m) => [`${m.provider}/${m.model}`, m.is_active])
    );
    const katalogFiyati = new Map(
      katalogSatirlari.map((m) => [`${m.provider}/${m.model}`, Number(m.output_price ?? 0)])
    );

    const sayac = new Map<string, {
      clientId: string; userId: string | null; musteri: string; modelAnahtar: string;
      provider: string; model: string; adet: number; son: string;
      sebep: string; modelAktif: boolean;
    }>();

    for (const h of (hatalar ?? []) as Array<{
      client_id: string; key_id: string | null; provider: string; model: string;
      error_message: string | null; created_at: string;
    }>) {
      const mesaj = String(h.error_message ?? '');
      // İki ret de talep sayılıyor:
      //   403 — model var, bu müşteriye kapalı
      //   400 — model o sırada katalogda yoktu; sonradan eklendiyse
      //         müşterinin isteği hâlâ geçerli
      const talepMi = yetkiRedMi(mesaj) || katalogRedMi(mesaj);
      if (!talepMi) continue;

      const modelAnahtar = `${h.provider}/${h.model}`;
      if (!katalogDurumu.has(modelAnahtar)) continue;

      const musteri = musteriHarita.get(String(h.client_id));
      if (!musteri) continue;

      // Anahtarın sahibi varsa talep o kişinin.
      const sahipId = h.key_id ? anahtarSahibi.get(h.key_id) ?? null : null;
      const kisi = sahipId ? kisiler.get(sahipId) : undefined;

      // Aradan izin verilmişse talep düşmüş demektir.
      //
      // Sahipli anahtarda kişinin listesi, sahipsizde şirketinki.
      const mevcutIzin = kisi ? (kisi.allowed_models ?? []) : (musteri.allowed_models ?? []);
      if (mevcutIzin.includes(modelAnahtar)) continue;

      // Fiyat tavanı da bir izin yolu. Liste dışında kalsa bile model
      // tavanın altındaysa istek şu an geçiyor demektir; talep düşmüştür.
      //
      // Bunu atlamak gerçek bir hataydı: ret kaydı eskiydi, aradan tavan
      // yükselmişti, model çoktan açılmıştı — ama liste hâlâ "onay bekliyor"
      // diyordu. Yönetici zaten çalışan bir şey için Allow'a basıyordu.
      const kisiTavan = kisi ? (kisi.max_output_price ?? null) : null;
      const sirketTavan = musteri.max_output_price ?? null;
      const etkinTavan = kisiTavan !== null && sirketTavan !== null
        ? Math.min(kisiTavan, sirketTavan)
        : (kisiTavan ?? sirketTavan);
      const ciktiFiyati = katalogFiyati.get(modelAnahtar) ?? null;
      if (
        katalogDurumu.get(modelAnahtar) === true &&
        etkinTavan !== null && ciktiFiyati !== null && ciktiFiyati <= etkinTavan
      ) continue;

      // Ret sebebi. Üçü de "izin yok" ama çözümleri farklı: birinde model
      // katalogda yok, birinde pahalı, birinde sadece o kişiye kapalı.
      // Yönetici ne yapması gerektiğini bilmeli.
      const sebep = !katalogDurumu.has(modelAnahtar)
        ? 'not-in-catalog'
        : katalogDurumu.get(modelAnahtar) !== true
          ? 'model-inactive'
          : mesaj.includes('above your limit of')
            ? 'too-expensive'
            : 'not-granted';

      const anahtar = `${kisi ? kisi.id : h.client_id}|${modelAnahtar}`;
      const o = sayac.get(anahtar) ?? {
        clientId: String(h.client_id),
        userId: kisi ? kisi.id : null,
        musteri: kisi ? kisi.email : musteri.name,
        modelAnahtar,
        provider: h.provider, model: h.model, adet: 0, son: h.created_at,
        sebep,
        // Model pasifse izin vermek tek başına yetmiyor; ekranda söylüyoruz.
        modelAktif: katalogDurumu.get(modelAnahtar) === true
      };
      o.adet += 1;
      if (h.created_at > o.son) o.son = h.created_at;
      sayac.set(anahtar, o);
    }

    const talepler = [...sayac.values()].sort((a, b) => b.adet - a.adet || (a.son < b.son ? 1 : -1));
    return c.json({ talepler });
  });

  // Bir müşteriye tek model ekler.
  //
  // Ayrı bir uç, çünkü izin listesinin tamamını gönderen PATCH'i kullanmak
  // yarış durumu doğuruyor: talep listesinden verilen izin, o sırada açık
  // duran bir düzenleme panelinin eski listesiyle geri alınabilirdi.
  app.post('/admin/api/customers/:id/allow', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const id = c.req.param('id');
    const g = (await govdeOku<{ model?: string }>(c)) ?? {};
    const model = String(g?.model ?? '').trim();
    if (!model) return c.json({ error: 'Model key is required.' }, 400 as any);

    const { data: musteri } = await supabase
      .from('clients').select('id, name, allowed_models').eq('id', id).single();
    if (!musteri) return c.json({ error: 'Customer not found.' }, 404 as any);

    const mevcut = ((musteri as { allowed_models: string[] | null }).allowed_models) ?? [];
    if (mevcut.includes(model)) return c.json({ musteri, degisti: false });

    const { data, error } = await supabase
      .from('clients')
      .update({ allowed_models: [...mevcut, model] })
      .eq('id', id)
      .select('id, name, allowed_models')
      .single();
    if (error) return c.json({ error: 'Could not grant access.' }, 500 as any);
    return c.json({ musteri: data, degisti: true });
  });

  // ---------------- zamanlanmış fiyat denetimi ----------------
  //
  // Mekanizmanın son halkası. Buraya kadar her şey birinin panele girip
  // düğmeye basmasını bekliyordu: kimse basmazsa hiçbir fiyat kontrol
  // edilmiyordu. Fiyatların güncelliği "birinin hatırlamasına" bağlı
  // kalırsa, çözmeye çalıştığımız sorunun kendisi geri geliyor.
  //
  // Vercel Cron günde bir kez bu ucu çağırıyor (vercel.json). Yaptığı iş
  // paneldeki iki düğmenin aynısı — tetikleyen insan değil, zamanlayıcı.

  // Olay kaydı. Gece çalışan bir işin sonucu bir yere yazılmazsa görünmez
  // olur: sabah "dün ne oldu" sorusunun cevabı olmalı.
  async function olayYaz(kayitlar: Array<Record<string, unknown>>) {
    if (!kayitlar.length) return;
    const { error } = await supabase.from('price_events').insert(kayitlar);
    // Tablo yoksa denetimi durdurmuyoruz: kayıt tutmak işin kendisinden
    // daha az önemli.
    if (error) console.error('price_events yazılamadı:', error.message);
  }

  async function fiyatDenetimiCalistir(tetikleyen: 'cron' | 'manual') {
    const basladi = Date.now();
    const olaylar: Array<Record<string, unknown>> = [];

    const [or, lite] = await Promise.all([kaynakFiyatlari(), liteFiyatlari()]);
    if (!or && !lite) {
      await olayYaz([{
        tur: 'warning', tetikleyen,
        aciklama: 'Both price sources were unreachable; nothing was checked.'
      }]);
      return { calisti: false, sebep: 'sources unreachable', uygulanan: [], baglanan: [] };
    }
    if (!or || !lite) {
      olaylar.push({
        tur: 'warning', tetikleyen,
        kaynak: or ? 'litellm' : 'openrouter',
        aciklama: 'One source was unreachable; the run continued with the other.'
      });
    }

    const { data: satirlar, error } = await supabase
      .from('model_catalog')
      .select('id, provider, model, input_price, output_price, source_ids, litellm_ids');
    if (error) {
      return { calisti: false, sebep: 'catalog unreadable', uygulanan: [], baglanan: [] };
    }

    const simdi = new Date().toISOString();
    const baglanan: Array<{ model: string; kimlik: string }> = [];
    const uygulanan: Array<{ model: string; eski: string; yeni: string }> = [];
    const bekleyen: string[] = [];
    // Fiyatı zaten doğru çıkan modeller. Olay kaydına tek tek yazmıyoruz —
    // her gece beş satır aynı şeyi söylerdi; özet satırında sayısı geçiyor.
    let dogrulanan = 0;

    for (const m of (satirlar ?? []) as Array<{
      id: string; provider: string; model: string;
      input_price: number | null; output_price: number | null;
      source_ids: string[] | null; litellm_ids: string[] | null;
    }>) {
      const ad = `${m.provider}/${m.model}`;
      let orIds = Array.isArray(m.source_ids) ? m.source_ids : [];
      let liteIds = Array.isArray(m.litellm_ids) ? m.litellm_ids : [];
      const bg = Number(m.input_price ?? 0), bc = Number(m.output_price ?? 0);

      // --- 1) kırık eşleştirmeyi onar ---
      if (or && !orIds.some((k) => or.fiyatlar.has(k))) {
        const sonuc = fiyatlaYenidenEslestir(m.provider, m.model, bg, bc, or.fiyatlar);
        if (sonuc.sonuc === 'baglandi' && sonuc.secilen) {
          orIds = [...orIds, sonuc.secilen.kimlik];
          await supabase.from('model_catalog')
            .update({ source_ids: orIds, updated_at: simdi }).eq('id', m.id);
          baglanan.push({ model: ad, kimlik: sonuc.secilen.kimlik });
          olaylar.push({
            tur: 'mapping', tetikleyen, model: ad, kaynak: 'openrouter',
            aciklama: `Mapped to ${sonuc.secilen.kimlik} (by ${
              sonuc.gerekce === 'ad' ? 'name' : 'price continuity'}).`
          });
        }
      }
      if (lite && !liteIds.some((k) => lite.fiyatlar.has(k))) {
        const adaylar = liteAdaylari(m.model, lite.fiyatlar);
        const toplam = bg + bc;
        const puanli = adaylar
          .map((k) => {
            const f = lite.fiyatlar.get(k);
            return f ? { k, sapma: toplam > 0 ? Math.abs((f.girdi + f.cikti) - toplam) / toplam : 0 } : null;
          })
          .filter((x): x is { k: string; sapma: number } => x !== null)
          .filter((x) => toplam <= 0 || x.sapma <= 0.25)
          .sort((a, b) => a.sapma - b.sapma || a.k.split('/').length - b.k.split('/').length);
        if (puanli[0]) {
          liteIds = [...liteIds, puanli[0].k];
          await supabase.from('model_catalog')
            .update({ litellm_ids: liteIds, updated_at: simdi }).eq('id', m.id);
          baglanan.push({ model: ad, kimlik: puanli[0].k });
          olaylar.push({
            tur: 'mapping', tetikleyen, model: ad, kaynak: 'litellm',
            aciklama: `Mapped to ${puanli[0].k}.`
          });
        }
      }

      // --- 2) fiyatı karşılaştır ---
      const okuma = await ikiKaynaktanOku(orIds, liteIds);
      if (!okuma.okumalar.length) continue;

      if (okuma.ayrisiyor) {
        olaylar.push({
          tur: 'warning', tetikleyen, model: ad,
          aciklama: 'The two sources disagree on this price; nothing was applied.'
        });
        continue;
      }

      const kg = okuma.girdi ?? 0, kc = okuma.cikti ?? 0;

      // Fiyat zaten doğruysa değiştirecek bir şey yok — ama doğrulandığını
      // kaydetmemiz gerekiyor. price_checked_at yalnızca fiyat değişince
      // yazılsaydı, sütun "en son ne zaman doğrulandı" değil "en son ne zaman
      // değişti" anlamına gelirdi. Hiç değişmeyen doğru bir fiyat aylarca
      // "kontrol edilmemiş" görünür, eskime uyarısı boşuna yanardı.
      if (Math.abs(bg - kg) < 0.000001 && Math.abs(bc - kc) < 0.000001) {
        dogrulanan += 1;
        await supabase.from('model_catalog').update({
          price_checked_at: simdi,
          price_source: okuma.dogrulandi ? 'verified' : (okuma.okumalar[0]?.kaynak ?? 'source')
        }).eq('id', m.id);
        continue;
      }

      const dusus = (kg + kc) < (bg + bc);
      const oran = (bg + bc) > 0 ? Math.abs((kg + kc) - (bg + bc)) / (bg + bc) : 1;

      // Otomatik uygulama iki koşula bağlı:
      //
      //   1. iki kaynak uyuşacak — tek kaynağın yanılması denetlenemiyor
      //   2. değişim %50'yi geçmeyecek — daha büyük sıçrama kaynak hatası
      //      ihtimalini artırıyor
      //
      // Zam da uygulanıyor. Önce yalnızca düşüşler uygulanıyordu; gerekçe
      // "artışı sessizce uygulamak müşteriye fazla fatura çıkarır" idi ve bu
      // yanlıştı: kimseye fatura kesmiyoruz, kendi harcamamızı izliyoruz.
      // Maliyet katalogdaki fiyattan hesaplandığı için eski düşük fiyatta
      // kalmak harcamayı OLDUĞUNDAN AZ gösteriyor — bütçe eksik sayıyor,
      // gerçek fatura daha yüksek geliyor. Yani asıl riskli yön güncellememek.
      const otomatik = okuma.dogrulandi && oran <= 0.5;
      void dusus;

      if (!otomatik) {
        bekleyen.push(ad);
        olaylar.push({
          tur: 'warning', tetikleyen, model: ad,
          eski_girdi: bg, eski_cikti: bc, yeni_girdi: kg, yeni_cikti: kc,
          kaynak: okuma.okumalar.map((o) => o.kaynak).join(' + '),
          aciklama: !okuma.dogrulandi
            ? 'Only one source carries this model, so the change could not be ' +
              'cross-checked; waiting for approval.'
            : `Change of ${(oran * 100).toFixed(0)}% is too large to apply unattended.`
        });
        continue;
      }

      const { error: h } = await supabase.from('model_catalog').update({
        input_price: kg, output_price: kc,
        price_checked_at: simdi, price_source: 'verified',
        son_fiyat_notu: `${dusus ? 'Drop' : 'Rise'} applied automatically on ` +
          `${simdi.slice(0, 10)} (both sources agree).`,
        updated_at: simdi
      }).eq('id', m.id);
      if (h) continue;

      uygulanan.push({
        model: ad,
        eski: `$${(bg * 1000).toFixed(2)} / $${(bc * 1000).toFixed(2)}`,
        yeni: `$${(kg * 1000).toFixed(2)} / $${(kc * 1000).toFixed(2)}`
      });
      olaylar.push({
        tur: 'price', tetikleyen, model: ad,
        eski_girdi: bg, eski_cikti: bc, yeni_girdi: kg, yeni_cikti: kc,
        kaynak: okuma.okumalar.map((o) => o.kaynak).join(' + '),
        aciklama: `Price ${dusus ? 'drop' : 'rise'} applied automatically; ` +
          'both sources agree.'
      });
    }

    // --- 3) müşterilerin istediği ama katalogda olmayan modelleri ekle ---
    //
    // Reddedilen her 400 bir talep. Bunları elle eklemek, model adını ve iki
    // fiyatı elle yazmak demekti — hem yorucu hem hataya açık (bin kat şişik
    // fiyat girme hatasını bu yüzden yaşadık).
    //
    // Model kullanıma açık ekleniyor. Pahalı bir modelin kontrolsüz açılması
    // endişesini fiyat tavanı karşılıyor: tavanın üstündeki model eklenmiş
    // olsa da reddediliyor ve panele talep olarak düşüyor. Kapıyı iki yere
    // birden koymak, ucuz bir modelin sebepsiz beklemesine yol açıyordu.
    //
    // Kaynakta fiyatı bulunamayan modeli hiç eklemiyoruz: fiyatsız model zaten
    // aktif edilemiyor, listede gürültüden başka bir şey olmaz.
    const eklenenModeller: Array<{ model: string; fiyat: string }> = [];
    if (or || lite) {
      const yediGunOnce = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data: redler } = await supabase
        .from('logs')
        .select('provider, model, error_message')
        .eq('status', 'error')
        .gte('created_at', yediGunOnce)
        .limit(2000);

      const mevcut = new Set(
        ((satirlar ?? []) as Array<{ provider: string; model: string }>)
          .map((m) => `${m.provider}/${m.model}`)
      );

      const istenen = new Map<string, { provider: string; model: string }>();
      for (const r of (redler ?? []) as Array<{
        provider: string; model: string; error_message: string | null;
      }>) {
        if (!katalogRedMi(String(r.error_message ?? ''))) continue;
        const ad = `${r.provider}/${r.model}`;
        if (mevcut.has(ad)) continue;
        istenen.set(ad, { provider: r.provider, model: r.model });
      }

      for (const [ad, m] of istenen) {
        // Kaynaklarda ada göre tam karşılık arıyoruz. Fiyat sürekliliği burada
        // kullanılamaz: elimizde bir önceki fiyat yok, model bizde hiç yok.
        let girdi: number | null = null, cikti: number | null = null;
        let orId: string | null = null, liteId: string | null = null;

        if (or) {
          const aday = olasiKarsiliklar(m.provider, m.model, or.fiyatlar)[0];
          const f = aday ? or.fiyatlar.get(aday) : undefined;
          // Yalnızca adı birebir tutan adayı kabul ediyoruz. Benzer adlı
          // başka bir modelin fiyatını yazmak, yanlış fiyatı sessizce
          // kataloga sokmak olurdu.
          const sade = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (aday && f && sade(aday.split('/').slice(1).join('/')) === sade(m.model)) {
            girdi = f.girdi; cikti = f.cikti; orId = aday;
          }
        }
        if (lite) {
          const aday = liteAdaylari(m.model, lite.fiyatlar)[0];
          const f = aday ? lite.fiyatlar.get(aday) : undefined;
          if (aday && f) {
            liteId = aday;
            if (girdi === null) { girdi = f.girdi; cikti = f.cikti; }
          }
        }

        if (girdi === null || cikti === null) continue;

        // Sağlayıcı doğrulaması.
        //
        // Ret kaydındaki sağlayıcı, isteğin gönderildiği uçtan geliyor —
        // istemci yanlış uca gönderirse yanlış çift kaydediliyor. Nitekim
        // "openai/claude-4-opus" böyle oluştu: Anthropic modeli OpenAI ucundan
        // çağrılmış, ad eşleşmesi fiyatı bulmuş ve olmayan bir model kataloğa
        // girmişti. Kaynak kimliği hangi sağlayıcıyı gösteriyorsa onunla
        // uyuşmayan çifti eklemiyoruz.
        const kaynakSaglayicisi = (kimlik: string | null): string | null => {
          if (!kimlik) return null;
          const bas = kimlik.split('/')[0];
          if (!bas || bas === kimlik) return null; // önek yoksa hüküm veremiyoruz
          return ({ openai: 'openai', anthropic: 'anthropic',
                    google: 'gemini', gemini: 'gemini' } as Record<string, string>)[bas] ?? null;
        };
        const kanit = kaynakSaglayicisi(orId) ?? kaynakSaglayicisi(liteId);
        if (kanit && kanit !== m.provider) {
          olaylar.push({
            tur: 'warning', tetikleyen, model: ad,
            aciklama: `Not added: the sources list this model under ${kanit}, ` +
              `but it was called on the ${m.provider} endpoint.`
          });
          continue;
        }

        const { error: h } = await supabase.from('model_catalog').insert([{
          provider: m.provider,
          model: m.model,
          input_price: girdi,
          output_price: cikti,
          is_active: true,
          price_checked_at: simdi,
          price_source: orId && liteId ? 'verified' : (orId ? 'openrouter' : 'litellm'),
          source_ids: orId ? [orId] : [],
          litellm_ids: liteId ? [liteId] : [],
          son_fiyat_notu:
            `Added automatically on ${simdi.slice(0, 10)}: someone asked for it and ` +
            `a price was found at the source. The price limit decides who may use it.`
        }]);
        if (h) continue;

        eklenenModeller.push({
          model: ad,
          fiyat: `$${(girdi * 1000).toFixed(2)} / $${(cikti * 1000).toFixed(2)}`
        });
        olaylar.push({
          tur: 'model', tetikleyen, model: ad,
          yeni_girdi: girdi, yeni_cikti: cikti,
          kaynak: [orId ? 'openrouter' : null, liteId ? 'litellm' : null].filter(Boolean).join(' + '),
          aciklama: 'Someone asked for this model; added with its price. ' +
            'The price limit decides who may use it.'
        });
      }
    }

    // --- 4) kaynaklarda çıkan yeni modelleri ekle ---
    //
    // 3. adım yalnızca birinin isteyip reddedildiği modelleri ekliyordu. Yani
    // yeni bir model çıktığında kimse denemeden haberimiz olmuyordu: modeli
    // elle eklemek gerekiyordu, adını ve iki fiyatı elle yazarak.
    //
    // Burada kaynaklarda görünen ama katalogda olmayan modeller de ekleniyor,
    // fiyatlarıyla ve KULLANIMA AÇIK olarak.
    //
    // Önce pasif ekleniyordu ve bu kapıyı yanlış yere koyuyordu: pasif model
    // hiç çağrılamıyor, fiyat tavanı devreye bile girmiyordu. Oysa kararı
    // veren şey tavan olmalı — ucuzsa isteyene açılsın, pahalıysa reddedilip
    // panele talep olarak düşsün. Aktiflik bayrağı artık "bilerek kapattım"
    // anlamına geliyor, "henüz bakmadım" anlamına değil.
    //
    // Kapsam dar tutuluyor. Kaynakta 370 model var; hepsini almak Models
    // ekranını kullanmadığımız satırlarla doldururdu. Yalnızca proxy'lediğimiz
    // sağlayıcılar ve ana model kimlikleri alınıyor — ":batch" gibi varyantlar,
    // "~" ile başlayan takma adlar ve satıcı yolları dışarıda.
    const SAGLAYICI_ESLEME: Record<string, string> = {
      openai: 'openai', anthropic: 'anthropic', google: 'gemini', gemini: 'gemini'
    };

    if (or) {
      const mevcutTum = new Set(
        ((satirlar ?? []) as Array<{ provider: string; model: string }>)
          .map((m) => `${m.provider}/${m.model}`)
      );
      for (const e of eklenenModeller) mevcutTum.add(e.model);

      for (const [kaynakId, f] of or.fiyatlar) {
        const parca = kaynakId.split('/');
        if (parca.length !== 2) continue;
        if (kaynakId.includes(':') || kaynakId.startsWith('~')) continue;

        const kaynakSaglayici = parca[0] ?? '';
        const modelAdi = parca[1] ?? '';
        if (!kaynakSaglayici || !modelAdi) continue;

        const saglayici = SAGLAYICI_ESLEME[kaynakSaglayici];
        if (!saglayici) continue;

        const ad = `${saglayici}/${modelAdi}`;
        if (mevcutTum.has(ad)) continue;
        if (!(f.girdi > 0 && f.cikti > 0)) continue;

        // İkinci kaynakta da varsa doğrulanmış sayılıyor.
        const liteAday = lite ? liteAdaylari(modelAdi, lite.fiyatlar)[0] ?? null : null;

        const { error: h } = await supabase.from('model_catalog').insert([{
          provider: saglayici,
          model: modelAdi,
          input_price: f.girdi,
          output_price: f.cikti,
          is_active: true,
          price_checked_at: simdi,
          price_source: liteAday ? 'verified' : 'openrouter',
          source_ids: [kaynakId],
          litellm_ids: liteAday ? [liteAday] : [],
          son_fiyat_notu:
            `Seen at the source on ${simdi.slice(0, 10)} and added with its price. ` +
            `The price limit decides who may use it.`
        }]);
        if (h) continue;

        mevcutTum.add(ad);
        eklenenModeller.push({
          model: ad,
          fiyat: `$${(f.girdi * 1000).toFixed(2)} / $${(f.cikti * 1000).toFixed(2)}`
        });
        olaylar.push({
          tur: 'model', tetikleyen, model: ad,
          yeni_girdi: f.girdi, yeni_cikti: f.cikti,
          kaynak: liteAday ? 'openrouter + litellm' : 'openrouter',
          aciklama: 'New at the source; added with its price. ' +
            'The price limit decides who may use it.'
        });
      }
    }

    if (uygulanan.length || eklenenModeller.length) invalidateCatalog();

    olaylar.unshift({
      tur: 'run', tetikleyen,
      aciklama: `Checked ${(satirlar ?? []).length} models in ${Date.now() - basladi} ms — ` +
        `${dogrulanan} already correct, ${uygulanan.length} price(s) applied, ` +
        `${baglanan.length} mapping(s) repaired, ${eklenenModeller.length} model(s) discovered, ` +
        `${bekleyen.length} waiting for approval.`
    });
    await olayYaz(olaylar);

    return { calisti: true, uygulanan, baglanan, bekleyen, dogrulanan, eklenenModeller };
  }

  // Zamanlayıcının çağırdığı uç.
  //
  // Yönetici jetonu istemiyoruz — cron o jetonu bilmiyor. Onun yerine ayrı
  // bir gizli anahtar: adres tahmin edilse bile dışarıdan tetiklenemesin.
  // Vercel kendi cron çağrılarına da bir başlık ekliyor, onu da kabul ediyoruz.
  app.get('/admin/api/cron/prices', async (c) => {
    const gizli = process.env.CRON_SECRET;
    const baslik = c.req.header('x-cron-secret');
    const vercelCron = String(c.req.header('user-agent') ?? '').includes('vercel-cron');
    const yonetici = await yoneticiMi(c);

    if (!yonetici && !vercelCron && (!gizli || baslik !== gizli)) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const sonuc = await fiyatDenetimiCalistir(yonetici && !vercelCron ? 'manual' : 'cron');
    return c.json(sonuc);
  });

  // Olay geçmişi — panelde "son değişiklikler" olarak gösteriliyor.
  app.get('/admin/api/price-events', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const { data, error } = await supabase
      .from('price_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) return c.json({ olaylar: [], tabloYok: true });
    return c.json({ olaylar: data ?? [] });
  });

  // ---------------- müşteri kullanıcıları ----------------
  //
  // Portala artık e-posta ve şifreyle giriliyor. Hesapları müşteri kendi
  // açmıyor: B2B bir üründe kendi kaydolma açmak e-posta doğrulama, sahte
  // kayıt engelleme ve spam derdi getiriyor; hiçbiri şu an gerekli değil.
  // Hesabı yönetici açıyor, ilk şifreyi müşteriye iletiyor.

  app.get('/admin/api/customers/:id/users', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const id = c.req.param('id');

    const { data, error } = await supabase
      .from('users')
      .select('id, email, role, created_at, last_login_at, allowed_models, max_output_price')
      .eq('client_id', id)
      .order('created_at', { ascending: true });

    if (error) {
      const eksik = /relation|does not exist|users/i.test(String(error.message));
      return c.json({
        error: eksik
          ? 'Account tables are missing. Run giris-sistemi.sql first.'
          : 'Could not read users.'
      }, eksik ? 428 : 500 as any);
    }
    return c.json({ kullanicilar: data ?? [] });
  });

  app.post('/admin/api/customers/:id/users', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const id = c.req.param('id');
    const g = (await govdeOku<{ email?: string; password?: string; role?: string }>(c)) ?? {};

    const { data: musteri } = await supabase
      .from('clients').select('id').eq('id', id).limit(1);
    if (!(musteri ?? []).length) return c.json({ error: 'Customer not found.' }, 404 as any);

    // Şifre verilmezse üretiyoruz. Yöneticinin şifre uydurması, zayıf ve
    // tekrar eden şifreler demek.
    const sifre = String(g?.password ?? '').trim() || uretilmisSifre();
    const sonuc = await hesapOlustur('musteri', String(g?.email ?? ''), sifre, id);
    if (!sonuc.ok) return c.json({ error: sonuc.hata }, 400 as any);

    if (g?.role === 'owner') {
      await supabase.from('users').update({ role: 'owner' }).eq('id', sonuc.hesap.id);
    }

    // Şifre yalnızca burada dönüyor; veritabanında karması duruyor.
    return c.json({ kullanici: { ...sonuc.hesap, role: g?.role === 'owner' ? 'owner' : 'member' }, sifre });
  });

  app.patch('/admin/api/users/:id', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const id = c.req.param('id');
    const g = (await govdeOku<{ role?: string; password?: string; email?: string }>(c)) ?? {};

    if (typeof g?.email === 'string' && g.email.trim()) {
      const e = g.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
        return c.json({ error: 'Enter a valid email address.' }, 400 as any);
      }
      const { data: cakisan } = await supabase
        .from('users').select('id').eq('email', e).neq('id', id).limit(1);
      if ((cakisan ?? []).length) {
        return c.json({ error: 'This email address is already registered.' }, 409 as any);
      }
      const { error } = await supabase.from('users').update({ email: e }).eq('id', id);
      if (error) return c.json({ error: 'Could not update the email address.' }, 500 as any);
      return c.json({ guncellendi: true, email: e });
    }

    // Şifre sıfırlama: mevcut şifre sorulmuyor, yönetici zaten yetkili.
    // İlk sürümde e-posta ile sıfırlama yok; müşteri unutursa yönetici veriyor.
    if (typeof g?.password === 'string' || g?.password === '') {
      const yeni = String(g.password ?? '').trim() || uretilmisSifre();
      const kusur = sifreKusuru(yeni);
      if (kusur) return c.json({ error: kusur }, 400 as any);

      const sonuc = await sifreDegistir('musteri', id, null, yeni);
      if (!sonuc.ok) return c.json({ error: sonuc.hata }, 400 as any);
      return c.json({ sifirlandi: true, sifre: yeni });
    }

    if (g?.role === 'owner' || g?.role === 'member') {
      const { error } = await supabase.from('users').update({ role: g.role }).eq('id', id);
      if (error) return c.json({ error: 'Could not update the user.' }, 500 as any);
      return c.json({ guncellendi: true });
    }

    return c.json({ error: 'Nothing to update.' }, 400 as any);
  });

  app.delete('/admin/api/users/:id', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const id = c.req.param('id');

    // Kullanıcının sahip olduğu anahtarlar silinmiyor: kod onlarla çalışmaya
    // devam ediyor. Yalnızca sahipsiz kalıyorlar, ortak anahtar oluyorlar.
    // Kişi ayrıldı diye çalışan bir servisi durdurmak istemiyoruz.
    await supabase.from('client_keys').update({ user_id: null }).eq('user_id', id);

    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) return c.json({ error: 'Could not remove the user.' }, 500 as any);
    return c.json({ silindi: true });
  });

  // Anahtara ad ve sahip atama.
  app.patch('/admin/api/keys/:id/owner', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const id = c.req.param('id');
    const g = (await govdeOku<{ label?: string; user_id?: string | null }>(c)) ?? {};

    const guncelleme: Record<string, unknown> = {};
    if (typeof g?.label === 'string') guncelleme.label = g.label.trim() || null;
    if (g?.user_id !== undefined) guncelleme.user_id = g.user_id || null;
    if (!Object.keys(guncelleme).length) {
      return c.json({ error: 'Nothing to update.' }, 400 as any);
    }

    const { data, error } = await supabase
      .from('client_keys').update(guncelleme).eq('id', id)
      .select('id, label, user_id').single();
    if (error) return c.json({ error: 'Could not update the key.' }, 500 as any);
    return c.json({ anahtar: data });
  });

  // ---------------- yönetici oturumu ----------------

  const URETIM = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

  app.post('/admin/api/session', async (c) => {
    const g = (await govdeOku<{ email?: string; password?: string }>(c)) ?? {};
    const eposta = String(g?.email ?? '').trim();
    const sifre = String(g?.password ?? '');
    if (!eposta || !sifre) {
      return c.json({ error: 'Email and password are required.' }, 400 as any);
    }

    const sonuc = await girisDogrula('yonetici', eposta, sifre);
    if (!sonuc.ok) {
      // Hangi kısmın yanlış olduğunu söylemiyoruz.
      return c.json({ error: 'Email or password is not correct.' }, 401 as any);
    }

    c.header('set-cookie', cerezYaz(CEREZ_ADI.yonetici, sonuc.cerez, URETIM));
    return c.json({ hesap: { id: sonuc.hesap.id, email: sonuc.hesap.email } });
  });

  app.delete('/admin/api/session', async (c) => {
    c.header('set-cookie', cerezSil(CEREZ_ADI.yonetici, URETIM));
    return c.json({ cikildi: true });
  });

  app.get('/admin/api/me', async (c) => {
    const hesap = await oturumdakiHesap('yonetici', c.req.header('cookie'));
    if (hesap) return c.json({ hesap: { id: hesap.id, email: hesap.email }, yol: 'hesap' });

    // Jetonla girilmişse de oturum sayılıyor, ama hesabı yok.
    if (await yoneticiMi(c)) return c.json({ hesap: null, yol: 'jeton' });
    return c.json({ error: 'No active session.' }, 401 as any);
  });

  // Yönetici hesapları. İlk hesap ADMIN_TOKEN ile açılıyor; sonrasında
  // hesaplar birbirini açabiliyor.
  app.get('/admin/api/admins', async (c) => {
    if (!(await yoneticiMi(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const { data, error } = await supabase
      .from('admin_users').select('id, email, created_at, last_login_at')
      .order('created_at', { ascending: true });
    if (error) {
      const eksik = /relation|does not exist/i.test(String(error.message));
      return c.json({
        error: eksik ? 'Run giris-sistemi.sql first.' : 'Could not read administrators.'
      }, eksik ? 428 : 500 as any);
    }
    return c.json({ yoneticiler: data ?? [] });
  });

  app.post('/admin/api/admins', async (c) => {
    if (!(await yoneticiMi(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const g = (await govdeOku<{ email?: string; password?: string }>(c)) ?? {};
    const sifre = String(g?.password ?? '').trim() || uretilmisSifre();
    const sonuc = await hesapOlustur('yonetici', String(g?.email ?? ''), sifre);
    if (!sonuc.ok) return c.json({ error: sonuc.hata }, 400 as any);
    return c.json({ yonetici: sonuc.hesap, sifre });
  });

  app.patch('/admin/api/admins/:id', async (c) => {
    if (!(await yoneticiMi(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const id = c.req.param('id');
    const g = (await govdeOku<{ password?: string; email?: string }>(c)) ?? {};

    // E-posta değiştirme. Adres giriş kimliği olduğu için tekil kalmalı;
    // veritabanı dizini son savunma, burada da bakıyoruz ki anlamlı bir
    // hata mesajı dönebilelim.
    if (typeof g?.email === 'string' && g.email.trim()) {
      const e = g.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
        return c.json({ error: 'Enter a valid email address.' }, 400 as any);
      }
      const { data: cakisan } = await supabase
        .from('admin_users').select('id').eq('email', e).neq('id', id).limit(1);
      if ((cakisan ?? []).length) {
        return c.json({ error: 'This email address is already registered.' }, 409 as any);
      }
      const { error } = await supabase.from('admin_users').update({ email: e }).eq('id', id);
      if (error) return c.json({ error: 'Could not update the email address.' }, 500 as any);
      return c.json({ guncellendi: true, email: e });
    }

    const yeni = String(g?.password ?? '').trim() || uretilmisSifre();
    const kusur = sifreKusuru(yeni);
    if (kusur) return c.json({ error: kusur }, 400 as any);

    const sonuc = await sifreDegistir('yonetici', id, null, yeni);
    if (!sonuc.ok) return c.json({ error: sonuc.hata }, 400 as any);
    return c.json({ sifirlandi: true, sifre: yeni });
  });

  app.delete('/admin/api/admins/:id', async (c) => {
    if (!(await yoneticiMi(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }
    const id = c.req.param('id');

    // Son yönetici silinmesin: hiç hesap kalmazsa panele yalnızca
    // ADMIN_TOKEN ile girilebilir ve o da bir gün kaldırılacak.
    const { data } = await supabase.from('admin_users').select('id');
    if ((data ?? []).length <= 1) {
      return c.json({ error: 'Cannot remove the last administrator.' }, 409 as any);
    }

    const { error } = await supabase.from('admin_users').delete().eq('id', id);
    if (error) return c.json({ error: 'Could not remove the administrator.' }, 500 as any);
    return c.json({ silindi: true });
  });

  // ---------------- kişi bazlı izinler ----------------
  //
  // Servis şirket içinde kullanılıyor: yönetilen şey kişiler. "Kim hangi
  // modeli kullanabilir" kişiye göre değişiyor — bir geliştiriciye pahalı bir
  // model açılırken bir başkasına açılmayabilir.
  //
  // Şirket seviyesindeki izin ve tavan ÜST SINIR olarak duruyor: kişiye
  // şirketin kapattığı bir model açılamıyor. Aksi halde kişi bazında izin
  // vermek, şirket politikasını delmenin yolu olurdu.
  app.patch('/admin/api/users/:id/permissions', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const id = c.req.param('id');
    const g = (await govdeOku<{
      allowed_models?: string[]; max_output_price?: number | null;
      monthly_budget?: number | null; daily_budget?: number | null;
    }>(c)) ?? {};

    const guncelleme: Record<string, unknown> = {};
    if (g?.monthly_budget !== undefined) {
      guncelleme.monthly_budget = g.monthly_budget === null ? null : Number(g.monthly_budget);
    }
    if (g?.daily_budget !== undefined) {
      guncelleme.daily_budget = g.daily_budget === null ? null : Number(g.daily_budget);
    }
    if (Array.isArray(g?.allowed_models)) {
      guncelleme.allowed_models = [...new Set(g.allowed_models.map(String))];
    }
    if (g?.max_output_price !== undefined) {
      guncelleme.max_output_price =
        g.max_output_price === null ? null : Number(g.max_output_price);
    }
    if (!Object.keys(guncelleme).length) {
      return c.json({ error: 'Nothing to update.' }, 400 as any);
    }

    const { data, error } = await supabase
      .from('users').update(guncelleme).eq('id', id)
      .select('id, email, allowed_models, max_output_price, monthly_budget, daily_budget').single();

    if (error) {
      const eksik = /allowed_models|max_output_price|column/i.test(String(error.message));
      return c.json({
        error: eksik
          ? 'Per-user permissions need new columns on users. Run tek-sirket.sql first.'
          : 'Could not update permissions.'
      }, eksik ? 428 : 500 as any);
    }
    return c.json({ kullanici: data });
  });

  // ---------------- kişiler ----------------
  //
  // Servis şirket içinde kullanılıyor; yönetilen şey kişiler. Panelin ana
  // ekranı da bu: kim, neye erişebiliyor, ne harcamış.
  //
  // clients tablosu duruyor ama arka planda: tek satır = şirketin kendisi.
  // Tabloyu kaldırmadık çünkü ileride TAKIM gerekebilir — pazarlama ekibinin
  // bütçesi ayrı, mobil ekibinin ayrı.
  app.get('/admin/api/people', async (c) => {
    if (!(await hesapOturumuMu(c))) {
      return c.json({ error: 'Unauthorized.' }, 401 as any);
    }

    const { data: kullanicilar, error } = await supabase
      .from('users')
      .select('id, email, role, client_id, created_at, last_login_at, allowed_models, max_output_price, monthly_budget, daily_budget')
      .order('created_at', { ascending: true });

    if (error) {
      const eksik = /allowed_models|max_output_price|column|relation/i.test(String(error.message));
      return c.json({
        error: eksik ? 'Run tek-sirket.sql first.' : 'Could not read people.'
      }, eksik ? 428 : 500 as any);
    }

    const { data: sirketler } = await supabase
      .from('clients')
      .select('id, name, allowed_models, max_output_price, client_type, allowed_domains, is_active, monthly_budget, daily_budget');

    const { data: anahtarlar } = await supabase
      .from('client_keys')
      .select('id, label, environment, is_active, user_id, key_prefix, created_at');

    // Kişi başına kullanım. Anahtar üzerinden bağlanıyor: ağ geçidine gelen
    // istekte insan yok, anahtar var.
    const { data: kayitlar } = await supabase
      .from('logs').select('key_id, status, input_tokens, output_tokens, cost, created_at').limit(10000);

    const anahtarSahibi = new Map(
      ((anahtarlar ?? []) as Array<{ id: string; user_id: string | null }>)
        .map((a) => [a.id, a.user_id])
    );

    type Toplam = { istek: number; hata: number; token: number; maliyet: number; son: string | null };
    const bos = (): Toplam => ({ istek: 0, hata: 0, token: 0, maliyet: 0, son: null });
    const kisiToplam = new Map<string, Toplam>();
    const ortakToplam = bos();

    for (const k of (kayitlar ?? []) as Array<{
      key_id: string | null; status: string;
      input_tokens: number | null; output_tokens: number | null;
      cost: number | null; created_at: string;
    }>) {
      const sahip = k.key_id ? anahtarSahibi.get(k.key_id) ?? null : null;
      const hedef = sahip ? (kisiToplam.get(sahip) ?? bos()) : ortakToplam;
      hedef.istek += 1;
      hedef.hata += k.status === 'error' ? 1 : 0;
      hedef.token += (k.input_tokens ?? 0) + (k.output_tokens ?? 0);
      hedef.maliyet += Number(k.cost ?? 0);
      if (!hedef.son || k.created_at > hedef.son) hedef.son = k.created_at;
      if (sahip) kisiToplam.set(sahip, hedef);
    }

    const anahtarPerKisi = new Map<string, unknown[]>();
    for (const a of (anahtarlar ?? []) as Array<{ user_id: string | null }>) {
      if (!a.user_id) continue;
      const d = anahtarPerKisi.get(a.user_id) ?? [];
      d.push(a);
      anahtarPerKisi.set(a.user_id, d);
    }

    // Bütçe sayacı Redis'te; kalan miktar oradan okunuyor.
    const kisiler = await Promise.all(
      ((kullanicilar ?? []) as Array<Record<string, unknown>>).map(async (u) => {
        const id = String(u.id);
        const butce = await butceDurumu(id, {
          aylik: (u.monthly_budget as number | null) ?? null,
          gunluk: (u.daily_budget as number | null) ?? null
        });
        return {
          ...u,
          anahtarlar: anahtarPerKisi.get(id) ?? [],
          kullanim: kisiToplam.get(id) ?? bos(),
          butce
        };
      })
    );

    // Sahibi olmayan anahtarlar: ortak servis anahtarları. Kimsenin kendi
    // kullanımı sayılmıyor ama şirket toplamına giriyor, o yüzden ayrı
    // gösteriliyor.
    const ortakAnahtarlar = ((anahtarlar ?? []) as Array<{ user_id: string | null }>)
      .filter((a) => !a.user_id);

    const sirketSatir = (sirketler ?? [])[0] as Record<string, unknown> | undefined;
    const sirketButce = sirketSatir
      ? await butceDurumu(String(sirketSatir.id), {
          aylik: (sirketSatir.monthly_budget as number | null) ?? null,
          gunluk: (sirketSatir.daily_budget as number | null) ?? null
        }, 'sirket')
      : null;

    return c.json({
      kisiler,
      sirket: sirketSatir ? { ...sirketSatir, butce: sirketButce } : null,
      ortak: { anahtarlar: ortakAnahtarlar, kullanim: ortakToplam }
    });
  });
}

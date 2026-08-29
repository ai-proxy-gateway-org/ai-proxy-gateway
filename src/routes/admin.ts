// Yönetici paneli.
//
// Portalın kardeşi: aynı sunucu, aynı tasarım dili, farklı yol ve farklı yetki.
// Portal müşterinin kendi verisini gösterir; burası bütün müşterileri yönetir.
//
// Giriş, .env içindeki ADMIN_TOKEN ile. Taslak için yeterli — gerçek üründe
// yönetici hesapları ayrı bir kimlik sistemine bağlanmalı.

import type { FastifyInstance } from 'fastify';
import { STIL, YAZI_TIPI } from '../ui/stil.js';
import { supabase, createNewClient } from '../services/db.js';
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

// Ret mesajları müşteriye yol göstersin diye değiştirildi; eski kayıtlar
// eski metinle duruyor. Süzgeçler ikisini de tanımak zorunda, yoksa
// geçmiş talepler bir sürüm yükseltmesiyle görünmez oluyor.
function katalogRedMi(mesaj: string): boolean {
  return mesaj.includes('is not defined') || mesaj.includes('is not available on this gateway');
}
function yetkiRedMi(mesaj: string): boolean {
  return mesaj.includes('not authorized') || mesaj.includes('is not enabled for your account');
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

async function yoneticiKimligi(
  request: { headers: Record<string, unknown> }
): Promise<YoneticiKimligi> {
  const hesap = await oturumdakiHesap('yonetici', request.headers.cookie as string | undefined);
  if (hesap) return { yol: 'hesap', id: hesap.id, email: hesap.email };

  const beklenen = process.env.ADMIN_TOKEN;
  if (!beklenen || beklenen.trim() === '') return null;

  const baslik = String(request.headers.authorization ?? '');
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
async function yoneticiMi(request: { headers: Record<string, unknown> }): Promise<boolean> {
  return (await yoneticiKimligi(request)) !== null;
}

async function hesapOturumuMu(request: { headers: Record<string, unknown> }): Promise<boolean> {
  const k = await yoneticiKimligi(request);
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
  .secim input { accent-color:var(--mavi); margin:0; }
  .secimKutu .secim .nokta-s { margin-right:0; }

  /* Anahtar bir kez gösteriliyor; kırılmadan tamamı okunabilmeli. */
  .anahtarKutu { margin-top:.8rem; padding:.85rem 1rem; border-radius:10px;
    background:var(--sunk); border:1px solid var(--line-2); }
  .anahtarKutu code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:.82rem; color:var(--ink); word-break:break-all; line-height:1.6; }

  .yanpanelGovde input { padding:.6rem .8rem; font:inherit; font-size:.9rem;
    border:1px solid var(--line-2); border-radius:8px; background:var(--surface);
    color:var(--ink); width:100%; }
  .yanpanelGovde .secim input { width:auto; padding:0; }

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
      <button data-bolum="musteriler">
        <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6M17 11h5M19.5 8.5v5"/></svg>
        Customers</button>
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
        <button class="dugme koyu gizli" id="mEkleAc">+ Add customer</button>
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
        <div class="metrikkart" id="oOzet" style="margin-bottom:1.25rem"></div>

        <div class="kart" style="margin-bottom:1.25rem">
          <div class="grafikUst">
            <div class="grafikbaslik" id="oGrafikBaslik">Daily spend</div>
            <div class="grafikOkuma" id="oGrafikOkuma"></div>
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

      <section data-bolum="musteriler" class="gizli">
        <div class="kart gizli" id="mEkleKart" style="max-width:52rem;margin-bottom:1.25rem">
          <div class="baslikkucuk">Add a new customer</div>
          <div class="yardim" style="margin:.35rem 0 1.2rem">
            A key is generated on creation and shown only once. Only the hash is stored,
            so it cannot be recovered later.
          </div>
          <div class="formSatir">
            <label>Customer name<input id="mAd" placeholder="Acme Corp"></label>
            <label>Type
              <select id="mTur">
                <option value="server-based">Server-based</option>
                <option value="browser-based">Browser-based</option>
              </select></label>
            <label>Environment
              <select id="mOrtam">
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="local">Local</option>
              </select></label>
          </div>
          <div style="margin-top:1.1rem">
            <div class="baslikkucuk" style="font-size:.82rem">Allowed models</div>
            <div class="yardim" style="margin:.3rem 0 .7rem">
              A customer with no model selected cannot make any request.
            </div>
            <div id="mModeller" class="secimKutu"></div>
          </div>
          <label style="display:block;margin-top:1.1rem;max-width:26rem">Allowed domains
            <input id="mAlan" placeholder="app.acme.com, acme.com">
            <span class="yardim">Browser-based customers only. Comma separated.</span></label>
          <div style="display:flex;gap:.6rem;margin-top:1.2rem">
            <button class="dugme koyu" id="mEkleKaydet">Create customer</button>
            <button class="dugme cerceveli" id="mEkleIptal">Cancel</button>
          </div>
          <div class="uyari gizli" id="mEkleHata"></div>
        </div>

        <div class="kart gizli" id="talepKart" style="margin-bottom:1.25rem">
          <div class="satirbasi" style="margin-top:0">
            <div class="baslikkucuk">Access requests</div>
            <div class="sayac" id="talepSayac"></div>
          </div>
          <div class="yardim" style="margin:-.3rem 0 .9rem">
            Customers who called a model they could not use. Taken from rejected
            requests — no separate request form needed. A row marked
            <b>model inactive</b> also needs activating on the Models screen.
          </div>
          <div class="kaydir"><table id="talepTablo"></table></div>
        </div>

        <div class="satirbasi" style="margin-top:0">
          <input id="mArama" class="aramaKutu" placeholder="Search customers...">
          <div class="sayac" id="mSayac"></div>
        </div>
        <div class="tablokart">
          <div class="kaydir"><table id="mTablo"></table></div>
          <div class="bosdurum gizli" id="mBos"></div>
        </div>
        <div class="yardim" style="margin-top:.8rem" id="mAltNot"></div>
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
          <div class="formSatir" style="margin-top:1.1rem;grid-template-columns:1fr auto">
            <input id="yonEposta" placeholder="you@company.com">
            <button class="dugme koyu" id="yonEkle">Add administrator</button>
          </div>
          <div class="yardim" style="margin-top:.4rem">
            A password is generated and shown once.
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
        <div class="satirbasi" style="margin-top:0">
          <div class="formSatir" style="flex:1 1 30rem;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))">
            <label>Customer<select id="fMusteri"><option value="">All customers</option></select></label>
            <label>Provider<select id="fSaglayici">
              <option value="">All providers</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google</option></select></label>
            <label>Status<select id="fDurum">
              <option value="">All</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
              <option value="pending">Pending</option></select></label>
          </div>
        </div>

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
    if (!c.ok) {
      const v = await c.json().catch(() => ({}));
      throw new Error(v.error || 'Request failed');
    }
    return c.json();
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
    $('tablo').innerHTML =
      '<thead><tr><th>Model</th><th>Provider</th><th>Input</th><th>Output</th>' +
      '<th>Price checked</th><th>Status</th><th></th></tr></thead><tbody>' +
      modeller.map(m =>
        '<tr data-id="' + m.id + '">' +
        '<td>' + nokta(m.provider) + m.model + '</td>' +
        '<td>' + (SAGLAYICI[m.provider] || m.provider) + '</td>' +
        '<td class="sayi">' + milyon(m.input_price) + '</td>' +
        '<td class="sayi">' + milyon(m.output_price) + '</td>' +
        '<td class="sayi">' + gunTarih(m.price_checked_at) + '</td>' +
        '<td>' + (m.is_active
          ? '<span class="hap ok">active</span>'
          : '<span class="hap">inactive</span>') + '</td>' +
        '<td class="islem">' +
          '<button class="satirDugme" data-eylem="fiyat">Edit price</button>' +
          '<button class="satirDugme' + (m.is_active ? ' tehlike' : '') + '" data-eylem="durum">' +
            (m.is_active ? 'Deactivate' : 'Activate') + '</button>' +
        '</td></tr>'
      ).join('') + '</tbody>';

    const fiyatsiz = modeller.filter(m => m.input_price === null || m.output_price === null).length;
    $('altNot').textContent = modeller.length + ' model' +
      (fiyatsiz ? ' · ' + fiyatsiz + ' without a price — these cannot be activated' : '');
  }

  // ---------------- bölüm geçişi ----------------
  const BASLIK = {
    ozet:       ['Dashboard', 'Traffic, spend and system health'],
    modeller:   ['Models',    'Model catalog and pricing'],
    musteriler: ['Customers', 'Accounts, keys and model access'],
    istekler:   ['Requests',  'All requests across customers'],
    fiyatlar:     ['Price audit', 'Stored prices checked against a live source'],
    yoneticiler:  ['Administrators', 'Who can sign in to this console']
  };
  let bolum = 'ozet';

  function bolumGoster(yeni) {
    bolum = yeni;
    document.querySelectorAll('#menu button').forEach(b =>
      b.classList.toggle('secili', b.dataset.bolum === yeni));
    document.querySelectorAll('section[data-bolum]').forEach(s =>
      s.classList.toggle('gizli', s.dataset.bolum !== yeni));
    $('sayfaBaslik').textContent = BASLIK[yeni][0];
    $('sayfaAlt').textContent = BASLIK[yeni][1];
    $('ekleAc').classList.toggle('gizli', yeni !== 'modeller');
    $('mEkleAc').classList.toggle('gizli', yeni !== 'musteriler');
    $('disaAktar').classList.toggle('gizli', yeni !== 'istekler');
    $('filtre').classList.toggle('gizli', yeni !== 'istekler' && yeni !== 'ozet');
    if (yeni === 'istekler') istekYukle(false);
    if (yeni === 'musteriler') musteriYukle();
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

  function iSatirCiz(kayitlar, ekle) {
    if (ekle) iSatirlar = iSatirlar.concat(kayitlar); else iSatirlar = kayitlar.slice();
    const bas = ekle ? iSatirlar.length - kayitlar.length : 0;
    const g = kayitlar.map((k, i) =>
      '<tr class="tiklanir" data-i="' + (bas + i) + '">' +
      '<td class="sayi">' + tarih(k.created_at) + '</td>' +
      '<td>' + (k.musteri || '—') + '</td>' +
      '<td>' + nokta(k.provider) + k.provider + '/' + k.model + '</td>' +
      '<td class="sayi">' + (k.input_tokens ?? 0) + '</td>' +
      '<td class="sayi">' + (k.output_tokens ?? 0) + '</td>' +
      '<td class="sayi">' + (k.latency_ms ?? 0) + ' ms</td>' +
      '<td class="sayi">' + para(k.cost ?? 0) + '</td>' +
      '<td>' + durumHapi(k) + '</td></tr>').join('');
    if (ekle) $('iTablo').querySelector('tbody').insertAdjacentHTML('beforeend', g);
    else $('iTablo').innerHTML =
      '<thead><tr><th>Time</th><th>Customer</th><th>Model</th><th>Input</th>' +
      '<th>Output</th><th>Latency</th><th>Cost</th><th>Status</th></tr></thead><tbody>' + g + '</tbody>';
  }

  async function istekYukle(ekle) {
    $('uyari').classList.add('gizli');
    if (!ekle && !iSatirlar.length) $('yukleniyor').classList.remove('gizli');
    try {
      const s = new URLSearchParams({ gun: String(gun), offset: String(offset) });
      if ($('fMusteri').value)   s.set('client',   $('fMusteri').value);
      if ($('fSaglayici').value) s.set('provider', $('fSaglayici').value);
      if ($('fDurum').value)     s.set('durum',    $('fDurum').value);

      const v = await api('/requests?' + s.toString());
      fiyatlar = v.fiyatlar || fiyatlar;
      iToplam = v.toplam;

      if (!ekle) {
        // Liste döneme göre değişiyor (yalnızca isteği olan müşteriler), o yüzden
        // her yüklemede yeniden kuruluyor. Seçim korunuyor.
        if (v.musteriler) {
          musteriler = v.musteriler;
          const secili = $('fMusteri').value;
          let secim = musteriler.slice();
          // Seçili müşteri yeni listede yoksa seçim düşmesin diye ekliyoruz.
          if (secili && !secim.some(m => m.id === secili)) {
            secim = secim.concat([{ id: secili, label: 'Selected customer (0)' }]);
          }
          $('fMusteri').innerHTML = '<option value="">All customers</option>' +
            secim.map(m => '<option value="' + m.id + '">' + kacir(m.label) + '</option>').join('');
          $('fMusteri').value = secili;
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

  ['fMusteri','fSaglayici','fDurum'].forEach(id =>
    $(id).addEventListener('change', () => { offset = 0; iSatirlar = []; istekYukle(false); }));
  $('filtre').addEventListener('click', e => {
    const d = e.target.closest('button'); if (!d) return;
    [...$('filtre').children].forEach(b => b.classList.remove('secili'));
    d.classList.add('secili'); gun = Number(d.dataset.gun); offset = 0; iSatirlar = [];
    if (bolum === 'ozet') ozetYukle(); else istekYukle(false);
  });
  $('iDaha').addEventListener('click', async () => {
    $('iDaha').disabled = true; $('iDaha').textContent = 'Loading...';
    offset += 50; await istekYukle(true);
    $('iDaha').disabled = false; $('iDaha').textContent = 'Load more';
  });

  // ---------------- istek detayı: hesap doğrulama ----------------
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


  // ---------------- müşteriler ----------------
  let musterilerListe = [], acikMusteri = null, sonKullanicilar = [];

  function modelSecimKutusu(kapsayici, secili) {
    const aktif = modeller.filter(m => m.is_active);
    if (!aktif.length) {
      kapsayici.innerHTML = '<div class="yardim">No active models in the catalog yet.</div>';
      return;
    }
    kapsayici.innerHTML = aktif.map(m => {
      const anahtar = m.provider + '/' + m.model;
      return '<label class="secim"><input type="checkbox" value="' + kacir(anahtar) + '"' +
        (secili.includes(anahtar) ? ' checked' : '') + '>' +
        nokta(m.provider) + kacir(m.model) + '</label>';
    }).join('');
  }
  const secilenModeller = (kapsayici) =>
    [...kapsayici.querySelectorAll('input:checked')].map(i => i.value);

  function mTabloCiz() {
    // Arama yalnızca yüklü listeyi süzüyor; sunucuya gitmiyor. 21 müşteride
    // fark etmez ama liste büyüdüğünde sayfalamaya çevrilmesi gerekir.
    const arama = ($('mArama').value || '').trim().toLowerCase();
    const gorunen = arama
      ? musterilerListe.filter(m => (m.name || '').toLowerCase().includes(arama))
      : musterilerListe;

    $('mSayac').textContent = arama
      ? gorunen.length + ' of ' + musterilerListe.length
      : musterilerListe.length + ' customer' + (musterilerListe.length === 1 ? '' : 's');

    if (arama && !gorunen.length) {
      $('mTablo').innerHTML = '';
      $('mBos').innerHTML = '<div class="simge">◷</div><h3>No match</h3>' +
        '<p>No customer name contains &ldquo;' + kacir(arama) + '&rdquo;.</p>';
      $('mBos').classList.remove('gizli');
      $('mAltNot').textContent = '';
      return;
    }

    if (!musterilerListe.length) {
      $('mTablo').innerHTML = '';
      $('mBos').innerHTML = '<div class="simge">◷</div><h3>No customers yet</h3>' +
        '<p>Create the first customer to issue a key.</p>';
      $('mBos').classList.remove('gizli');
      $('mAltNot').textContent = '';
      return;
    }
    $('mBos').classList.add('gizli');
    $('mTablo').innerHTML =
      '<thead><tr><th>Customer</th><th>Type</th><th>Access</th><th>Keys</th>' +
      '<th class="sayi">Requests</th><th>Last seen</th><th>Status</th></tr></thead><tbody>' +
      gorunen.map((m) => {
        const i = musterilerListe.indexOf(m);
        const izin = (m.allowed_models || []).length;
        const canli = (m.anahtarlar || []).filter(a => a.is_active).length;
        return '<tr class="tiklanir" data-i="' + i + '">' +
          '<td>' + kacir(m.name) + '</td>' +
          '<td>' + (m.client_type === 'browser-based' ? 'Browser' : 'Server') + '</td>' +
          '<td>' + (m.max_output_price
            ? '≤ $' + (m.max_output_price * 1000).toFixed(2) + '/1M' +
              (izin ? ' <span class="yardim">+' + izin + '</span>' : '')
            : izin
              ? izin + ' allowed'
              : '<span class="hap bek">none</span>') + '</td>' +
          '<td>' + (canli
            ? canli + ' active'
            : '<span class="hap">no key</span>') + '</td>' +
          '<td class="sayi">' + bin(m.istek) + '</td>' +
          '<td class="sayi">' + (m.sonIstek
            ? new Date(m.sonIstek).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            : '—') + '</td>' +
          '<td>' + (m.is_active
            ? '<span class="hap ok">active</span>'
            : '<span class="hap">suspended</span>') + '</td></tr>';
      }).join('') + '</tbody>';

    // Uyarı sayısı her zaman listenin tamamından: arama yaparken sorunların
    // gizlenmesi istenmiyor.
    const izinsiz = musterilerListe.filter(m => !(m.allowed_models || []).length).length;
    const bosMusteri = musterilerListe.filter(m => !m.istek && !(m.allowed_models || []).length).length;
    $('mAltNot').textContent =
      (izinsiz ? izinsiz + ' with no allowed model — these cannot make requests' : 'All customers have model access') +
      (bosMusteri ? ' · ' + bosMusteri + ' of them never sent a request and can be deleted' : '');
  }

  // Erişim talepleri: reddedilen 403'lerden türetiliyor.
  let talepler = [];

  function talepCiz() {
    if (!talepler.length) { $('talepKart').classList.add('gizli'); return; }
    $('talepKart').classList.remove('gizli');
    $('talepSayac').textContent = talepler.length + ' pending';
    $('talepTablo').innerHTML =
      '<thead><tr><th>Customer</th><th>Model</th><th class="sayi">Attempts</th>' +
      '<th>Last try</th><th></th></tr></thead><tbody>' +
      talepler.map((t, i) => '<tr>' +
        '<td>' + kacir(t.musteri) + '</td>' +
        '<td>' + nokta(t.provider) + kacir(t.model) +
          (t.modelAktif ? '' : ' <span class="hap bek">model inactive</span>') + '</td>' +
        '<td class="sayi">' + bin(t.adet) + '</td>' +
        '<td class="sayi">' + gunTarih(t.son) + '</td>' +
        '<td class="islem"><button class="satirDugme" data-talep="' + i + '">Allow</button></td>' +
        '</tr>').join('') + '</tbody>';
  }

  $('talepTablo').addEventListener('click', async (e) => {
    const d = e.target.closest('[data-talep]'); if (!d) return;
    const t = talepler[Number(d.dataset.talep)]; if (!t) return;
    if (!confirm('Allow ' + t.musteri + ' to use ' + t.modelAnahtar + '?')) return;
    d.disabled = true;
    try {
      await api('/customers/' + t.clientId + '/allow', {
        method: 'POST', body: JSON.stringify({ model: t.modelAnahtar })
      });
      await musteriYukle();
    } catch (err) {
      $('uyari').textContent = err.message;
      $('uyari').classList.remove('gizli');
      d.disabled = false;
    }
  });

  async function musteriYukle() {
    $('uyari').classList.add('gizli');
    if (!musterilerListe.length) $('yukleniyor').classList.remove('gizli');
    try {
      const [m, t] = await Promise.all([api('/customers'), api('/access-requests')]);
      musterilerListe = m.musteriler;
      talepler = t.talepler;
      talepCiz();
      mTabloCiz();
    } catch (e) {
      $('uyari').textContent = 'Could not load customers. ' + e.message;
      $('uyari').classList.remove('gizli');
    } finally {
      $('yukleniyor').classList.add('gizli');
    }
  }

  // ---- yeni müşteri ----
  $('mEkleAc').addEventListener('click', () => {
    $('mEkleKart').classList.toggle('gizli');
    if (!$('mEkleKart').classList.contains('gizli')) {
      modelSecimKutusu($('mModeller'), []);
      $('mAd').focus();
    }
  });
  $('mEkleIptal').addEventListener('click', () => {
    $('mEkleKart').classList.add('gizli');
    $('mEkleHata').classList.add('gizli');
    $('mAd').value = ''; $('mAlan').value = '';
  });

  $('mEkleKaydet').addEventListener('click', async () => {
    const ad = $('mAd').value.trim();
    if (!ad) { $('mEkleHata').textContent = 'Customer name is required.';
      $('mEkleHata').classList.remove('gizli'); return; }

    $('mEkleHata').classList.add('gizli');
    $('mEkleKaydet').disabled = true;
    try {
      const v = await api('/customers', { method: 'POST', body: JSON.stringify({
        name: ad,
        client_type: $('mTur').value,
        environment: $('mOrtam').value,
        allowed_models: secilenModeller($('mModeller')),
        allowed_domains: $('mAlan').value.split(',').map(x => x.trim()).filter(Boolean)
      })});
      $('mEkleIptal').click();
      await musteriYukle();
      anahtarGoster(v.musteri, v.anahtar, true);
    } catch (e) {
      $('mEkleHata').textContent = e.message;
      $('mEkleHata').classList.remove('gizli');
    } finally {
      $('mEkleKaydet').disabled = false;
    }
  });

  // ---- anahtar bir kez gösterilir ----
  function anahtarGoster(musteri, anahtar, yeniMi) {
    $('ypBaslik').textContent = musteri.name;
    $('ypZaman').textContent = yeniMi ? 'Customer created' : 'New key issued';
    $('ypGovde').innerHTML =
      '<div class="bolumBaslik">API key</div>' +
      '<div class="dogrula bek">This is the only time the key is shown. ' +
      'Only its hash is stored, so it cannot be recovered later.</div>' +
      '<div class="anahtarKutu"><code id="ypAnahtar">' + kacir(anahtar) + '</code></div>' +
      '<button class="dugme koyu" id="ypKopyala" style="margin-top:.8rem">Copy key</button>' +
      '<div class="bolumBaslik" style="margin-top:1.6rem">How the customer uses it</div>' +
      '<div class="hesap"><div class="sat"><span>Authorization</span>' +
      '<span>Bearer &lt;key&gt;</span></div>' +
      '<div class="sat"><span>Portal</span><span>/portal</span></div></div>';
    panelAc();
    $('ypKopyala').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(anahtar);
        $('ypKopyala').textContent = 'Copied';
        setTimeout(() => { if ($('ypKopyala')) $('ypKopyala').textContent = 'Copy key'; }, 1500);
      } catch (e) {
        // Panoya erişim kapalıysa metni seçilebilir bırakmak yeterli.
        const r = document.createRange(); r.selectNode($('ypAnahtar'));
        getSelection().removeAllRanges(); getSelection().addRange(r);
      }
    });
  }

  // ---- müşteri detayı ----
  function musteriAc(m) {
    acikMusteri = m;
    const canli = (m.anahtarlar || []).filter(a => a.is_active);
    $('ypBaslik').textContent = m.name;
    $('ypZaman').textContent = 'Customer since ' +
      new Date(m.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    $('ypGovde').innerHTML =
      '<div class="bolumBaslik">Summary</div><dl class="ozellik">' +
      '<dt>Type</dt><dd>' + (m.client_type === 'browser-based' ? 'Browser-based' : 'Server-based') + '</dd>' +
      '<dt>Requests</dt><dd>' + bin(m.istek) + '</dd>' +
      '<dt>Last request</dt><dd>' + (m.sonIstek
        ? new Date(m.sonIstek).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : 'never') + '</dd>' +
      '<dt>Status</dt><dd>' + (m.is_active
        ? '<span class="hap ok">active</span>'
        : '<span class="hap">suspended</span>') + '</dd></dl>' +

      '<div class="bolumBaslik">Price limit</div>' +
      '<div class="yardim" style="margin-bottom:.7rem">' +
      'Any model at or below this output price is usable without approval — including ' +
      'models added later. Leave empty to require the list below for everything.</div>' +
      '<div class="formSatir" style="grid-template-columns:1fr 2fr">' +
      '<label>Max output price<input id="ypTavan" type="number" step="0.01" min="0" ' +
      'placeholder="15.00" value="' +
      (m.max_output_price ? (m.max_output_price * 1000).toFixed(2) : '') + '"></label>' +
      '<div class="yardim" style="align-self:end;padding-bottom:.55rem">$ per 1M output tokens</div>' +
      '</div>' +

      '<div class="bolumBaslik" style="margin-top:1.5rem">Always allowed</div>' +
      '<div class="yardim" style="margin-bottom:.7rem">' +
      'Exceptions — these work even above the price limit. Anything not listed and above ' +
      'the limit is rejected with 403.</div>' +
      '<div id="ypModeller" class="secimKutu"></div>' +

      '<div class="bolumBaslik" style="margin-top:1.5rem">Allowed domains</div>' +
      '<input id="ypAlan" value="' + kacir((m.allowed_domains || []).join(', ')) + '" ' +
      'placeholder="app.acme.com, acme.com">' +
      '<div class="yardim" style="margin-top:.35rem">' +
      'Checked for browser-based customers only.</div>' +

      '<div style="display:flex;gap:.6rem;margin-top:1.2rem">' +
      '<button class="dugme koyu" id="ypKaydet">Save changes</button>' +
      '<button class="dugme cerceveli' + (m.is_active ? ' tehlike' : '') + '" id="ypDurum">' +
      (m.is_active ? 'Suspend customer' : 'Reactivate') + '</button>' +
      // Silme yalnızca hiç isteği olmayan müşteride. Kayıtları olan bir müşteri
      // silinseydi geçmiş logların sahibi kaybolurdu.
      (m.istek ? '' :
        '<button class="dugme cerceveli tehlike" id="ypSil">Delete</button>') +
      '</div>' +
      (m.istek
        ? '<div class="yardim" style="margin-top:.6rem">This customer has ' + bin(m.istek) +
          ' request' + (m.istek === 1 ? '' : 's') + ' on record and cannot be deleted. ' +
          'Suspend it instead — the history stays intact.</div>'
        : '') +
      '<div class="uyari gizli" id="ypHata"></div>' +

      '<div class="bolumBaslik" style="margin-top:1.8rem">Users</div>' +
      '<div class="yardim" style="margin-bottom:.7rem">' +
      'People who sign in to the portal for this customer. The portal shows company-wide ' +
      'usage to everyone; roles only limit what they can change.</div>' +
      '<div id="ypKullanicilar"><div class="yardim">Loading...</div></div>' +
      '<div class="formSatir" style="margin-top:.9rem;grid-template-columns:1fr auto auto">' +
      '<input id="ypYeniEposta" placeholder="person@company.com">' +
      '<select id="ypYeniRol"><option value="member">Member</option>' +
      '<option value="owner">Owner</option></select>' +
      '<button class="dugme cerceveli" id="ypKullaniciEkle">Add</button></div>' +
      '<div class="yardim" style="margin-top:.4rem">' +
      'A password is generated and shown once. There is no email reset yet — ' +
      'if they forget it, reset it here.</div>' +

      '<div class="bolumBaslik" style="margin-top:1.8rem">Keys</div>' +
      '<div class="hesap" id="ypAnahtarlar">' +
      ((m.anahtarlar || []).length
        ? m.anahtarlar.map(a =>
            '<div class="sat"><span>' +
            (a.key_prefix
              ? '<code class="onek">' + kacir(a.key_prefix) + '…</code> '
              : '<code class="onek soluk">unknown</code> ') +
            (a.label ? '<b>' + kacir(a.label) + '</b> · ' : '') +
            a.environment + ' · ' +
            new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
            (a.user_id ? ' · <span class="hap ok">owned</span>' : ' · <span class="hap">shared</span>') +
            '</span><span>' +
            '<button class="satirDugme" data-anahtar-duzen="' + a.id + '">Edit</button>' +
            (a.is_active
              ? '<button class="satirDugme tehlike" data-anahtar="' + a.id + '">Revoke</button>'
              : '<span class="hap">revoked</span>') + '</span></div>').join('')
        : '<div class="sat"><span>No key issued yet</span><span></span></div>') +
      '</div>' +
      '<div class="yardim" style="margin:.6rem 0 .8rem">' +
      'A lost key cannot be recovered — issue a new one instead.</div>' +
      '<label class="secim"><input type="checkbox" id="ypEskiKapat">Revoke existing keys</label>' +
      '<button class="dugme cerceveli" id="ypYeniAnahtar" style="margin-top:.8rem">Issue new key</button>';

    modelSecimKutusu($('ypModeller'), m.allowed_models || []);
    panelAc();
    kullanicilariYukle(m.id);

    $('ypKullaniciEkle').addEventListener('click', async () => {
      const e = $('ypYeniEposta').value.trim();
      if (!e) return;
      $('ypKullaniciEkle').disabled = true;
      try {
        const v = await api('/customers/' + m.id + '/users', {
          method: 'POST',
          body: JSON.stringify({ email: e, role: $('ypYeniRol').value })
        });
        $('ypYeniEposta').value = '';
        await kullanicilariYukle(m.id);
        // Şifre yalnızca burada görünüyor; veritabanında karması duruyor.
        sifreGoster(v.kullanici.email, v.sifre, 'Account created');
      } catch (err) {
        $('ypHata').textContent = err.message; $('ypHata').classList.remove('gizli');
      } finally { $('ypKullaniciEkle').disabled = false; }
    });

    $('ypKaydet').addEventListener('click', async () => {
      $('ypHata').classList.add('gizli'); $('ypKaydet').disabled = true;
      try {
        // Panelde 1M başına giriliyor, veritabanında 1K başına saklanıyor.
        const tavanMetin = $('ypTavan').value.trim();
        await api('/customers/' + m.id, { method: 'PATCH', body: JSON.stringify({
          allowed_models: secilenModeller($('ypModeller')),
          allowed_domains: $('ypAlan').value.split(',').map(x => x.trim()).filter(Boolean),
          max_output_price: tavanMetin === '' ? null : Number(tavanMetin) / 1000
        })});
        await musteriYukle();
        detayKapat();
      } catch (e) {
        $('ypHata').textContent = e.message; $('ypHata').classList.remove('gizli');
      } finally { $('ypKaydet').disabled = false; }
    });

    $('ypDurum').addEventListener('click', async () => {
      if (m.is_active && !confirm('Suspend ' + m.name + '? Their requests will be rejected.')) return;
      try {
        await api('/customers/' + m.id, { method: 'PATCH',
          body: JSON.stringify({ is_active: !m.is_active }) });
        await musteriYukle();
        detayKapat();
      } catch (e) {
        $('ypHata').textContent = e.message; $('ypHata').classList.remove('gizli');
      }
    });

    if ($('ypSil')) {
      $('ypSil').addEventListener('click', async () => {
        if (!confirm('Delete ' + m.name + ' permanently? Its keys are removed too.')) return;
        try {
          await api('/customers/' + m.id, { method: 'DELETE' });
          await musteriYukle();
          detayKapat();
        } catch (e) {
          $('ypHata').textContent = e.message; $('ypHata').classList.remove('gizli');
        }
      });
    }

    $('ypYeniAnahtar').addEventListener('click', async () => {
      const kapat = $('ypEskiKapat').checked;
      if (kapat && !confirm('Existing keys will stop working immediately. Continue?')) return;
      try {
        const v = await api('/customers/' + m.id + '/keys', { method: 'POST',
          body: JSON.stringify({ eskileriKapat: kapat }) });
        await musteriYukle();
        anahtarGoster(m, v.anahtar, false);
      } catch (e) {
        $('ypHata').textContent = e.message; $('ypHata').classList.remove('gizli');
      }
    });

    // Anahtara ad ve sahip atama.
    //
    // Ad olmadan kırılım anlaşılmıyor: portalda "sk-proxy-91c…" yerine
    // "ayselin-dev" görünmesi gerekiyor. Sahip ise harcamanın kime ait
    // sayılacağını belirliyor; boş bırakılırsa ortak servis anahtarı oluyor.
    $('ypAnahtarlar').addEventListener('click', async (e) => {
      const duzen = e.target.closest('[data-anahtar-duzen]');
      if (duzen) {
        const a = (m.anahtarlar || []).find(x => x.id === duzen.dataset.anahtarDuzen);
        if (!a) return;
        const kullanicilar = sonKullanicilar || [];
        const secenekler = ['<option value="">Shared — no owner</option>']
          .concat(kullanicilar.map(u =>
            '<option value="' + u.id + '"' + (a.user_id === u.id ? ' selected' : '') + '>' +
            kacir(u.email) + '</option>')).join('');

        const kutu = document.createElement('div');
        kutu.className = 'dogrula bek';
        kutu.style.marginTop = '.7rem';
        kutu.innerHTML =
          '<div class="formSatir" style="grid-template-columns:1fr 1fr">' +
          '<label>Name<input id="akAd" value="' + kacir(a.label || '') + '" placeholder="ayselin-dev"></label>' +
          '<label>Owner<select id="akSahip">' + secenekler + '</select></label></div>' +
          '<div style="display:flex;gap:.6rem;margin-top:.8rem">' +
          '<button class="dugme koyu" id="akKaydet">Save</button>' +
          '<button class="dugme cerceveli" id="akIptal">Cancel</button></div>';
        duzen.closest('.sat').after(kutu);
        duzen.disabled = true;

        $('akIptal').onclick = () => { kutu.remove(); duzen.disabled = false; };
        $('akKaydet').onclick = async () => {
          try {
            await api('/keys/' + a.id + '/owner', {
              method: 'PATCH',
              body: JSON.stringify({ label: $('akAd').value, user_id: $('akSahip').value || null })
            });
            await musteriYukle();
            const yeni = musterilerListe.find(x => x.id === m.id);
            if (yeni) musteriAc(yeni);
          } catch (err) {
            $('ypHata').textContent = err.message; $('ypHata').classList.remove('gizli');
          }
        };
        return;
      }

      const d = e.target.closest('[data-anahtar]'); if (!d) return;
      if (!confirm('Revoke this key? Requests using it will be rejected.')) return;
      try {
        await api('/keys/' + d.dataset.anahtar, { method: 'PATCH',
          body: JSON.stringify({ is_active: false }) });
        await musteriYukle();
        const yeni = musterilerListe.find(x => x.id === m.id);
        if (yeni) musteriAc(yeni);
      } catch (err) {
        $('ypHata').textContent = err.message; $('ypHata').classList.remove('gizli');
      }
    });
  }

  let aramaZaman = null;
  $('mArama').addEventListener('input', () => {
    clearTimeout(aramaZaman);
    aramaZaman = setTimeout(mTabloCiz, 120);
  });

  $('mTablo').addEventListener('click', e => {
    const tr = e.target.closest('tr.tiklanir'); if (!tr) return;
    const m = musterilerListe[Number(tr.dataset.i)]; if (m) musteriAc(m);
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

  async function ozetYukle() {
    $('uyari').classList.add('gizli');
    $('yukleniyor').classList.remove('gizli');
    try {
      const v = await api('/overview?gun=' + gun);
      const o = v.ozet;
      const kart = (ad, deger, aciklama) => '<div class="metrik"><div class="ad">' + ad +
        '</div><div class="aciklama">' + aciklama + '</div><div class="sayi">' + deger + '</div></div>';
      const oran = o.istek ? (o.hata / o.istek * 100) : 0;
      $('oOzet').innerHTML =
        kart('Requests', bin(o.istek), 'in selected range') +
        kart('Error rate', oran.toFixed(1) + '%', bin(o.hata) + ' rejected or failed') +
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

  function fTabloCiz(v) {
    const m1000 = (x) => x === null || x === undefined ? '—' : '$' + (Number(x) * 1000).toFixed(2);
    const k = v.karsilastirma;
    const sorunlu = k.filter(x => x.durum === 'ucuzlamis' || x.durum === 'zamlanmis').length;
    const eslesmemis = k.filter(x => x.durum === 'eslesmemis' || x.durum === 'kaynakta-yok').length;

    $('fSayac').textContent = k.length + ' model';
    $('fTablo').innerHTML =
      '<thead><tr><th>Model</th><th>Mapped to</th><th class="sayi">Ours</th>' +
      '<th class="sayi">Source</th><th>Status</th><th>Checked</th><th></th></tr></thead><tbody>' +
      k.map((x, i) => {
        const [renk, yazi] = DURUM_YAZI[x.durum] || ['', x.durum];
        const kimlikler = (x.orIds || []).concat(x.liteIds || []);
        return '<tr data-i="' + i + '">' +
          '<td>' + nokta(x.provider) + kacir(x.model) +
            (x.dogrulandi ? ' <span class="hap ok">2 sources</span>' : '') + '</td>' +
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
      }).join('') + '</tbody>';

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
  async function kullanicilariYukle(clientId) {
    const kutu = $('ypKullanicilar');
    if (!kutu) return;
    try {
      const v = await api('/customers/' + clientId + '/users');
      const liste = v.kullanicilar || [];
      // Anahtar sahibi seçiminde aynı liste kullanılıyor.
      sonKullanicilar = liste;
      kutu.innerHTML = liste.length
        ? '<div class="hesap">' + liste.map(u =>
            '<div class="sat"><span>' + kacir(u.email) +
            (u.role === 'owner' ? ' <span class="hap ok">owner</span>' : '') +
            '<br><span class="yardim">' +
            (u.last_login_at
              ? 'last signed in ' + gunTarih(u.last_login_at)
              : 'never signed in') + '</span></span>' +
            '<span><button class="satirDugme" data-kul-sifre="' + u.id + '">Reset password</button>' +
            '<button class="satirDugme tehlike" data-kul-sil="' + u.id + '">Remove</button></span></div>'
          ).join('') + '</div>'
        : '<div class="yardim">No portal accounts yet. This customer can still use the API key.</div>';

      kutu.onclick = async (e) => {
        const sifirla = e.target.closest('[data-kul-sifre]');
        const sil = e.target.closest('[data-kul-sil]');
        if (sifirla) {
          if (!confirm('Generate a new password? The current one stops working.')) return;
          const v2 = await api('/users/' + sifirla.dataset.kulSifre, {
            method: 'PATCH', body: JSON.stringify({ password: '' })
          });
          sifreGoster('', v2.sifre, 'Password reset');
          await kullanicilariYukle(clientId);
        }
        if (sil) {
          if (!confirm('Remove this account? Keys they own stay active and become shared.')) return;
          await api('/users/' + sil.dataset.kulSil, { method: 'DELETE' });
          await kullanicilariYukle(clientId);
        }
      };
    } catch (e) {
      kutu.innerHTML = '<div class="uyari">' + kacir(e.message) + '</div>';
    }
  }

  // Üretilen şifre bir kez gösteriliyor; saklanmıyor.
  function sifreGoster(eposta, sifre, baslik) {
    const kutu = $('ypKullanicilar');
    if (!kutu) return;
    const alan = document.createElement('div');
    alan.className = 'dogrula bek';
    alan.style.marginTop = '.8rem';
    alan.innerHTML = '<b>' + baslik + '</b>' + (eposta ? ' — ' + kacir(eposta) : '') +
      '<div class="anahtarKutu" style="margin-top:.6rem"><code>' + kacir(sifre) + '</code></div>' +
      '<div class="yardim" style="margin-top:.4rem">Shown once. Send it to them over a channel you trust.</div>';
    kutu.parentNode.insertBefore(alan, kutu.nextSibling);
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
            '<button class="satirDugme" data-yon-sifre="' + y.id + '">Reset password</button>' +
            (liste.length > 1
              ? '<button class="satirDugme tehlike" data-yon-sil="' + y.id + '">Remove</button>'
              : '') +
            '</span></div>').join('') + '</div>'
        : '<div class="yardim">No administrator accounts yet. Add one — the shared token ' +
          'is meant to be a fallback, not the way in.</div>';

      kutu.onclick = async (e) => {
        const sif = e.target.closest('[data-yon-sifre]');
        const sil = e.target.closest('[data-yon-sil]');
        try {
          if (sif) {
            if (!confirm('Generate a new password? The current one stops working.')) return;
            const v2 = await api('/admins/' + sif.dataset.yonSifre, {
              method: 'PATCH', body: JSON.stringify({ password: '' })
            });
            await yoneticileriYukle();
            yonSifreGoster('Password reset', v2.sifre);
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
    alan.className = 'dogrula bek';
    alan.style.marginTop = '.9rem';
    alan.innerHTML = '<b>' + baslik + '</b>' +
      '<div class="anahtarKutu" style="margin-top:.6rem"><code>' + kacir(sifre) + '</code></div>' +
      '<div class="yardim" style="margin-top:.4rem">Shown once.</div>';
    $('yonListe').parentNode.insertBefore(alan, $('yonListe').nextSibling);
  }

  $('yonEkle').addEventListener('click', async () => {
    const e = $('yonEposta').value.trim();
    if (!e) return;
    $('yonEkle').disabled = true; $('yonHata').classList.add('gizli');
    try {
      const v = await api('/admins', { method: 'POST', body: JSON.stringify({ email: e }) });
      $('yonEposta').value = '';
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
    else if (bolum === 'musteriler') musteriYukle();
    else if (bolum === 'fiyatlar') fiyatYukle();
    else yukle();
  });
  $('disaAktar').addEventListener('click', async () => {
    const d = $('disaAktar');
    d.disabled = true; d.textContent = 'Preparing...';
    try {
      const s = new URLSearchParams({ gun: String(gun) });
      if ($('fMusteri').value)   s.set('client',   $('fMusteri').value);
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

export async function adminRoutes(server: FastifyInstance) {
  server.get('/admin', async (request, reply) => {
    reply.type('text/html; charset=utf-8');
    return SAYFA;
  });

  server.get('/admin/api/models', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const { data, error } = await supabase
      .from('model_catalog')
      .select('id, provider, model, input_price, output_price, is_active, price_checked_at, updated_at')
      .order('provider', { ascending: true })
      .order('model', { ascending: true });
    if (error) return reply.status(500).send({ error: 'Could not read the catalog.' });
    return { modeller: data ?? [] };
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

  server.post('/admin/api/models', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const g = request.body as {
      provider?: string; model?: string;
      input_price?: number | null; output_price?: number | null;
    };
    if (!g?.provider || !g?.model?.trim()) {
      return reply.status(400).send({ error: 'Provider and model ID are required.' });
    }

    const kusur = fiyatKusuru(g.input_price, g.output_price);
    if (kusur) return reply.status(400).send({ error: kusur });

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
      return reply.status(cakisma ? 409 : 500).send({
        error: cakisma ? 'This model already exists in the catalog.' : 'Could not add the model.'
      });
    }
    // Katalog değişti; önbellek eskidi.
    invalidateCatalog();
    return { model: data };
  });

  server.patch('/admin/api/models/:id', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const { id } = request.params as { id: string };
    const g = request.body as {
      input_price?: number; output_price?: number; is_active?: boolean;
    };

    const kusur = fiyatKusuru(g.input_price, g.output_price);
    if (kusur) return reply.status(400).send({ error: kusur });

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

    if (error) return reply.status(500).send({ error: 'Could not update the model.' });
    // Fiyat ya da aktiflik değişti; önbellek eskidi.
    invalidateCatalog();
    return { model: data };
  });

  // Bütün müşterilerin istekleri. Portaldaki uçla aynı mantık ama client_id
  // filtresi anahtardan değil, yöneticinin seçiminden geliyor.
  //
  // Portalda olduğu gibi iki sorgu: özet dönemin tamamından, tablo sayfa sayfa.
  server.get('/admin/api/requests', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const s = request.query as {
      gun?: string; offset?: string; client?: string; provider?: string; durum?: string;
    };
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
      return x;
    };

    // 1) Dönemin tamamı — özet için
    const { data: tumu, error: h1 } = await filtrele(
      supabase.from('logs')
        .select('status, input_tokens, output_tokens, cost')
        .limit(10000) as any
    );
    if (h1) return reply.status(500).send({ error: 'Could not read requests.' });

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
        .select('client_id, provider, model, status, input_tokens, output_tokens, cost, latency_ms, created_at, error_message, input_price_used, output_price_used')
        .order('created_at', { ascending: false })
        .range(offset, offset + SAYFA - 1) as any
    );
    if (h2) return reply.status(500).send({ error: 'Could not read requests.' });

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

    const kayitlar = ((sayfa ?? []) as Array<Record<string, unknown>>).map((k) => ({
      ...k,
      musteri: adlar.get(String(k.client_id)) ?? null
    }));

    return {
      ozet,
      kayitlar,
      toplam: ozet.istek,
      offset,
      musteriler: filtreMusterileri,
      fiyatlar: await priceList()
    };
  });

  // ---------------- müşteriler ----------------
  //
  // Müşteri oluşturma bugüne kadar test.ts betiğiyle elle yapılıyordu; bu
  // yüzden veritabanında adı tekrar eden, izni boş satırlar birikti.
  // Buradan oluşturulunca ad, tür ve izinler tek yerden kontrollü giriliyor.

  server.get('/admin/api/customers', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const { data: musteriler, error } = await supabase
      .from('clients')
      .select('id, name, is_active, client_type, allowed_domains, allowed_models, max_output_price, created_at')
      .order('created_at', { ascending: false });
    if (error) return reply.status(500).send({ error: 'Could not read customers.' });

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

    return { musteriler: liste };
  });

  server.post('/admin/api/customers', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const g = request.body as {
      name?: string; environment?: string; client_type?: string;
      allowed_models?: string[]; allowed_domains?: string[];
    };
    const ad = String(g.name ?? '').trim();
    if (!ad) return reply.status(400).send({ error: 'Customer name is required.' });

    // Anahtar üretimi ve karma Umur'un createNewClient işlevinde; onu çağırıyoruz
    // ki anahtar mantığı tek yerde kalsın.
    const sonuc = await createNewClient(ad, String(g.environment ?? 'production'));
    if (!sonuc.success || !sonuc.clientId) {
      return reply.status(500).send({ error: 'Could not create the customer.' });
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

    if (h) return reply.status(500).send({ error: 'Customer created but permissions could not be saved.' });

    // Anahtarı createNewClient üretti; öneki burada işliyoruz ki o işlev
    // (Umur'un dosyası) olduğu gibi kalsın. Sütun yoksa sessizce geçiyoruz.
    await supabase.from('client_keys')
      .update({ key_prefix: String(sonuc.plainApiKey).slice(0, 12) })
      .eq('client_id', sonuc.clientId);

    // Açık anahtar yalnızca burada dönüyor; veritabanında karması duruyor.
    return { musteri: { ...guncel, anahtarlar: [], istek: 0, sonIstek: null }, anahtar: sonuc.plainApiKey };
  });

  server.patch('/admin/api/customers/:id', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const { id } = request.params as { id: string };
    const g = request.body as {
      name?: string; is_active?: boolean; client_type?: string;
      allowed_models?: string[]; allowed_domains?: string[];
      max_output_price?: number | null;
    };

    const guncelleme: Record<string, unknown> = {};
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
      return reply.status(400).send({ error: 'Nothing to update.' });
    }

    const { data, error } = await supabase
      .from('clients').update(guncelleme).eq('id', id)
      .select('id, name, is_active, client_type, allowed_domains, allowed_models, max_output_price, created_at')
      .single();
    if (error) return reply.status(500).send({ error: 'Could not update the customer.' });
    return { musteri: data };
  });

  // Yeni anahtar. Kaybolan anahtar geri getirilemez (yalnızca karması saklanıyor),
  // bu yüzden çözüm yenisini vermek. Eskisi isteğe bağlı olarak kapatılıyor.
  server.post('/admin/api/customers/:id/keys', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const { id } = request.params as { id: string };
    const g = (request.body ?? {}) as { environment?: string; eskileriKapat?: boolean };

    const { data: musteri } = await supabase
      .from('clients').select('id').eq('id', id).single();
    if (!musteri) return reply.status(404).send({ error: 'Customer not found.' });

    if (g.eskileriKapat) {
      await supabase.from('client_keys')
        .update({ is_active: false }).eq('client_id', id);
    }

    const acik = generateProxyKey();
    const satir: Record<string, unknown> = {
      client_id: id,
      key_hash: hashApiKey(acik),
      environment: String(g.environment ?? 'production'),
      key_prefix: acik.slice(0, 12)
    };

    let ekleme = await supabase.from('client_keys').insert([satir])
      .select('id, client_id, environment, is_active, created_at, key_prefix, label, user_id').single();
    if (ekleme.error) {
      // key_prefix sütunu yoksa öneksiz yazıyoruz.
      delete satir.key_prefix;
      ekleme = await supabase.from('client_keys').insert([satir])
        .select('id, client_id, environment, is_active, created_at').single() as typeof ekleme;
    }
    const { data, error } = ekleme;

    if (error) return reply.status(500).send({ error: 'Could not issue a key.' });
    return { anahtarKaydi: data, anahtar: acik };
  });

  server.patch('/admin/api/keys/:id', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const { id } = request.params as { id: string };
    const g = request.body as { is_active?: boolean };
    if (typeof g.is_active !== 'boolean') {
      return reply.status(400).send({ error: 'is_active is required.' });
    }

    const { data, error } = await supabase
      .from('client_keys').update({ is_active: g.is_active }).eq('id', id)
      .select('id, client_id, environment, is_active, created_at').single();
    if (error) return reply.status(500).send({ error: 'Could not update the key.' });
    return { anahtarKaydi: data };
  });

  // ---------------- genel bakış ----------------
  //
  // Requests ekranı tek tek kayıtları gösteriyor; burası aynı verinin
  // toplamı: kim harcıyor, hangi model, sistemde bakım isteyen ne var.
  server.get('/admin/api/overview', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const s = request.query as { gun?: string };
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
    if (error) return reply.status(500).send({ error: 'Could not read the overview.' });

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

    return {
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
    };
  });

  // Müşteri silme. Yalnızca hiç isteği olmayan müşteri silinebiliyor:
  // kayıtları olan bir müşteri silinirse geçmiş logların sahibi kaybolur,
  // maliyet raporları kime ait olduğu belirsiz satırlarla dolar.
  // İşi biten müşteri için doğru yol askıya almak, silmek değil.
  server.delete('/admin/api/customers/:id', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const { id } = request.params as { id: string };

    const { data: kayit } = await supabase
      .from('logs').select('id').eq('client_id', id).limit(1);
    if ((kayit ?? []).length) {
      return reply.status(409).send({
        error: 'This customer has request history and cannot be deleted. Suspend it instead.'
      });
    }

    // Anahtarlar önce: client_id'ye bağlı oldukları için müşteri kalırsa
    // yetim satır bırakırlar.
    const { error: ah } = await supabase.from('client_keys').delete().eq('client_id', id);
    if (ah) return reply.status(500).send({ error: 'Could not remove the keys.' });

    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (error) return reply.status(500).send({ error: 'Could not delete the customer.' });
    return { silindi: true };
  });

  // İsteklerin CSV dökümü. Requests ekranındaki filtreler aynen geçerli.
  // Portaldaki dışa aktarmayla aynı biçim: noktalı virgül ayraç, ondalıkta
  // virgül, başta BOM — Türkçe Excel dosyayı böyle doğru açıyor.
  server.get('/admin/api/export', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const s = request.query as {
      gun?: string; client?: string; provider?: string; durum?: string;
    };
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

    const { data, error } = await sorgu;
    if (error) return reply.status(500).send({ error: 'Could not read records.' });

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
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="' + dosya + '"')
      .send('﻿' + satirlar.join('\n'));
  });

  // ---------------- fiyat denetimi ----------------
  //
  // Fiyatları elle giriyoruz ve hiçbir şey doğruluğunu kontrol etmiyordu.
  // gpt-4o'nun fiyatı yarıya düştüğünde tablomuz eski kaldı, kimse fark etmedi.
  // Burası o körlüğü kapatıyor: dış kaynakla farkı gösteriyor, kararı bırakıyor.

  server.get('/admin/api/prices', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const [or, lite] = await Promise.all([kaynakFiyatlari(), liteFiyatlari()]);

    const { data: katalogSatirlari, error } = await supabase
      .from('model_catalog')
      .select('id, provider, model, input_price, output_price, is_active, price_checked_at, source_ids, litellm_ids, price_source, son_fiyat_notu')
      .order('provider', { ascending: true });

    if (error) {
      const eksikSutun = /source_ids|litellm_ids|column/i.test(String(error.message));
      return reply.status(eksikSutun ? 428 : 500).send({
        error: eksikSutun
          ? 'The price audit needs new columns on model_catalog. Run kaynak-listesi.sql first.'
          : 'Could not read the catalog.'
      });
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

    return { karsilastirma, talepler, saglayiciHatalari, kaynaklar: kaynakDurumu() };
  });

  // Kaynak eşleştirmesini kaydeder.
  //
  // Tek kimlik yerine liste tutuyoruz: sağlayıcı ad değiştirdiğinde eskisi ve
  // yenisi bir süre birlikte yayında kalıyor, ikisini de saklarsak geçiş
  // döneminde hiçbir şey kırılmıyor.
  server.post('/admin/api/prices/map', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const g = request.body as { id?: string; source_ids?: string[]; litellm_ids?: string[] };
    if (!g?.id) return reply.status(400).send({ error: 'Model id is required.' });

    const temizle = (d: unknown) =>
      Array.isArray(d) ? [...new Set(d.map((x) => String(x).trim()).filter(Boolean))] : [];

    const guncelleme: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (g.source_ids !== undefined) guncelleme.source_ids = temizle(g.source_ids);
    if (g.litellm_ids !== undefined) guncelleme.litellm_ids = temizle(g.litellm_ids);

    const { data, error } = await supabase
      .from('model_catalog').update(guncelleme).eq('id', g.id)
      .select('id, source_ids, litellm_ids').single();
    if (error) return reply.status(500).send({ error: 'Could not save the mapping.' });
    return { model: data };
  });

  // Kırılan eşleştirmeleri fiyat sürekliliğiyle onarır.
  //
  // Sağlayıcı bir modelin adını değiştirdiğinde eşleştirme boşa düşer. Adaylar
  // arasından, son bilinen fiyata yakın olanı seçiyoruz — ad değişikliği
  // fiyatı değiştirmez, farklı bir model ise fiyatı kat kat sapar.
  //
  // Yalnızca eşleştirmeye ekleme yapıyor; fiyata dokunmuyor. Fiyat değişimi
  // ayrı bir onay adımı olarak kalıyor.
  server.post('/admin/api/prices/rematch', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const [or, lite] = await Promise.all([kaynakFiyatlari(), liteFiyatlari()]);
    if (!or && !lite) {
      return reply.status(503).send({ error: 'Price sources are unreachable right now.' });
    }

    const g = (request.body ?? {}) as { id?: string };
    let sorgu = supabase
      .from('model_catalog')
      .select('id, provider, model, input_price, output_price, source_ids, litellm_ids');
    if (g.id) sorgu = sorgu.eq('id', g.id);
    const { data: satirlar, error } = await sorgu;
    if (error) return reply.status(500).send({ error: 'Could not read the catalog.' });

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

    return { baglanan, belirsiz };
  });

  // Kaynak fiyatını uygular.
  //
  // sadeceDususler: yalnızca ucuzlamış modelleri uygular. Ayrımın sebebi,
  // yanlış yönde hata yapmanın bedeli farklı: kaynak yanılıp fiyatı düşük
  // gösterirse müşteriye eksik fatura çıkarırız, yüksek gösterirse fazla.
  // Fazla faturalandırma daha ağır bir hata, o yüzden zamlar onay bekliyor.
  server.post('/admin/api/prices/apply', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const g = (request.body ?? {}) as { id?: string; sadeceDususler?: boolean };
    const [or, lite] = await Promise.all([kaynakFiyatlari(), liteFiyatlari()]);
    if (!or && !lite) {
      return reply.status(503).send({ error: 'Price sources are unreachable right now.' });
    }

    let sorgu = supabase
      .from('model_catalog')
      .select('id, provider, model, input_price, output_price, source_ids, litellm_ids');
    if (g.id) sorgu = sorgu.eq('id', g.id);
    const { data: satirlar, error } = await sorgu;
    if (error) return reply.status(500).send({ error: 'Could not read the catalog.' });

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
    return { uygulanan, atlanan };
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
  server.get('/admin/api/access-requests', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const { data: hatalar } = await supabase
      .from('logs')
      .select('client_id, provider, model, error_message, created_at')
      .eq('status', 'error')
      .order('created_at', { ascending: false })
      .limit(3000);

    const { data: musteriler } = await supabase
      .from('clients').select('id, name, allowed_models, is_active');
    const musteriHarita = new Map(
      ((musteriler ?? []) as Array<{
        id: string; name: string; allowed_models: string[] | null; is_active: boolean;
      }>).map((m) => [m.id, m])
    );

    // Katalogdaki modeller — pasif olanlar dahil.
    //
    // Pasifleri dışarıda bırakmak zinciri kırıyordu: müşteri bilinmeyen bir
    // modeli çağırınca 400 alıyor, gece denetimi modeli pasif olarak
    // ekliyor, yönetici aktif ediyor — ama talep hiçbir yerde görünmediği
    // için müşterinin bir kez daha denemesi gerekiyordu.
    const { data: katalog } = await supabase
      .from('model_catalog').select('provider, model, is_active');
    const katalogDurumu = new Map(
      ((katalog ?? []) as Array<{ provider: string; model: string; is_active: boolean }>)
        .map((m) => [`${m.provider}/${m.model}`, m.is_active])
    );

    const sayac = new Map<string, {
      clientId: string; musteri: string; modelAnahtar: string;
      provider: string; model: string; adet: number; son: string;
      modelAktif: boolean;
    }>();

    for (const h of (hatalar ?? []) as Array<{
      client_id: string; provider: string; model: string;
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
      // Aradan izin verilmişse talep düşmüş demektir.
      if ((musteri.allowed_models ?? []).includes(modelAnahtar)) continue;

      const anahtar = `${h.client_id}|${modelAnahtar}`;
      const o = sayac.get(anahtar) ?? {
        clientId: String(h.client_id), musteri: musteri.name, modelAnahtar,
        provider: h.provider, model: h.model, adet: 0, son: h.created_at,
        // Model pasifse izin vermek tek başına yetmiyor; ekranda söylüyoruz.
        modelAktif: katalogDurumu.get(modelAnahtar) === true
      };
      o.adet += 1;
      if (h.created_at > o.son) o.son = h.created_at;
      sayac.set(anahtar, o);
    }

    const talepler = [...sayac.values()].sort((a, b) => b.adet - a.adet || (a.son < b.son ? 1 : -1));
    return { talepler };
  });

  // Bir müşteriye tek model ekler.
  //
  // Ayrı bir uç, çünkü izin listesinin tamamını gönderen PATCH'i kullanmak
  // yarış durumu doğuruyor: talep listesinden verilen izin, o sırada açık
  // duran bir düzenleme panelinin eski listesiyle geri alınabilirdi.
  server.post('/admin/api/customers/:id/allow', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const { id } = request.params as { id: string };
    const g = request.body as { model?: string };
    const model = String(g?.model ?? '').trim();
    if (!model) return reply.status(400).send({ error: 'Model key is required.' });

    const { data: musteri } = await supabase
      .from('clients').select('id, name, allowed_models').eq('id', id).single();
    if (!musteri) return reply.status(404).send({ error: 'Customer not found.' });

    const mevcut = ((musteri as { allowed_models: string[] | null }).allowed_models) ?? [];
    if (mevcut.includes(model)) return { musteri, degisti: false };

    const { data, error } = await supabase
      .from('clients')
      .update({ allowed_models: [...mevcut, model] })
      .eq('id', id)
      .select('id, name, allowed_models')
      .single();
    if (error) return reply.status(500).send({ error: 'Could not grant access.' });
    return { musteri: data, degisti: true };
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

      // Otomatik uygulama üç koşula bağlı. Gözetimsiz çalışan bir işte
      // eşiği yüksek tutuyoruz: yanlış bir fiyatı gece sessizce uygulamak,
      // bir gün geç düzeltmekten kötü.
      //
      //   1. düşüş olacak   — artış müşteriye fazla fatura demek, onay ister
      //   2. iki kaynak uyuşacak — tek kaynağın yanılması denetlenemiyor
      //   3. değişim %50'yi geçmeyecek — daha büyük sıçrama kaynak hatası
      //      ihtimalini artırıyor
      const otomatik = dusus && okuma.dogrulandi && oran <= 0.5;

      if (!otomatik) {
        bekleyen.push(ad);
        olaylar.push({
          tur: 'warning', tetikleyen, model: ad,
          eski_girdi: bg, eski_cikti: bc, yeni_girdi: kg, yeni_cikti: kc,
          kaynak: okuma.okumalar.map((o) => o.kaynak).join(' + '),
          aciklama: !dusus
            ? 'Price went up at the source; waiting for approval.'
            : !okuma.dogrulandi
              ? 'Only one source carries this model; a drop needs approval.'
              : `Change of ${(oran * 100).toFixed(0)}% is too large to apply unattended.`
        });
        continue;
      }

      const { error: h } = await supabase.from('model_catalog').update({
        input_price: kg, output_price: kc,
        price_checked_at: simdi, price_source: 'verified',
        son_fiyat_notu: `Applied automatically on ${simdi.slice(0, 10)} (both sources agree).`,
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
        aciklama: 'Price drop applied automatically; both sources agree.'
      });
    }

    // --- 3) müşterilerin istediği ama katalogda olmayan modelleri ekle ---
    //
    // Reddedilen her 400 bir talep. Bunları elle eklemek, model adını ve iki
    // fiyatı elle yazmak demekti — hem yorucu hem hataya açık (bin kat şişik
    // fiyat girme hatasını bu yüzden yaşadık).
    //
    // Modeli PASİF ekliyoruz. Aktif eklemek, kimse karar vermeden yeni ve
    // pahalı bir modeli kullanıma açmak olurdu. Pasif model kimseye görünmez,
    // yalnızca Models ekranında "buna bakılması lazım" olarak durur.
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

        const { error: h } = await supabase.from('model_catalog').insert([{
          provider: m.provider,
          model: m.model,
          input_price: girdi,
          output_price: cikti,
          is_active: false,
          price_checked_at: simdi,
          price_source: orId && liteId ? 'verified' : (orId ? 'openrouter' : 'litellm'),
          source_ids: orId ? [orId] : [],
          litellm_ids: liteId ? [liteId] : [],
          son_fiyat_notu:
            `Added automatically on ${simdi.slice(0, 10)}: customers requested it and ` +
            `a price was found at the source. Inactive until reviewed.`
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
          aciklama: 'Customers requested this model; added to the catalog as inactive.'
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
  server.get('/admin/api/cron/prices', async (request, reply) => {
    const gizli = process.env.CRON_SECRET;
    const baslik = request.headers['x-cron-secret'];
    const vercelCron = String(request.headers['user-agent'] ?? '').includes('vercel-cron');
    const yonetici = await yoneticiMi(request as never);

    if (!yonetici && !vercelCron && (!gizli || baslik !== gizli)) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }

    const sonuc = await fiyatDenetimiCalistir(yonetici && !vercelCron ? 'manual' : 'cron');
    return sonuc;
  });

  // Olay geçmişi — panelde "son değişiklikler" olarak gösteriliyor.
  server.get('/admin/api/price-events', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const { data, error } = await supabase
      .from('price_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) return { olaylar: [], tabloYok: true };
    return { olaylar: data ?? [] };
  });

  // ---------------- müşteri kullanıcıları ----------------
  //
  // Portala artık e-posta ve şifreyle giriliyor. Hesapları müşteri kendi
  // açmıyor: B2B bir üründe kendi kaydolma açmak e-posta doğrulama, sahte
  // kayıt engelleme ve spam derdi getiriyor; hiçbiri şu an gerekli değil.
  // Hesabı yönetici açıyor, ilk şifreyi müşteriye iletiyor.

  server.get('/admin/api/customers/:id/users', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
      .from('users')
      .select('id, email, role, created_at, last_login_at')
      .eq('client_id', id)
      .order('created_at', { ascending: true });

    if (error) {
      const eksik = /relation|does not exist|users/i.test(String(error.message));
      return reply.status(eksik ? 428 : 500).send({
        error: eksik
          ? 'Account tables are missing. Run giris-sistemi.sql first.'
          : 'Could not read users.'
      });
    }
    return { kullanicilar: data ?? [] };
  });

  server.post('/admin/api/customers/:id/users', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const { id } = request.params as { id: string };
    const g = request.body as { email?: string; password?: string; role?: string };

    const { data: musteri } = await supabase
      .from('clients').select('id').eq('id', id).limit(1);
    if (!(musteri ?? []).length) return reply.status(404).send({ error: 'Customer not found.' });

    // Şifre verilmezse üretiyoruz. Yöneticinin şifre uydurması, zayıf ve
    // tekrar eden şifreler demek.
    const sifre = String(g?.password ?? '').trim() || uretilmisSifre();
    const sonuc = await hesapOlustur('musteri', String(g?.email ?? ''), sifre, id);
    if (!sonuc.ok) return reply.status(400).send({ error: sonuc.hata });

    if (g?.role === 'owner') {
      await supabase.from('users').update({ role: 'owner' }).eq('id', sonuc.hesap.id);
    }

    // Şifre yalnızca burada dönüyor; veritabanında karması duruyor.
    return { kullanici: { ...sonuc.hesap, role: g?.role === 'owner' ? 'owner' : 'member' }, sifre };
  });

  server.patch('/admin/api/users/:id', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const { id } = request.params as { id: string };
    const g = request.body as { role?: string; password?: string };

    // Şifre sıfırlama: mevcut şifre sorulmuyor, yönetici zaten yetkili.
    // İlk sürümde e-posta ile sıfırlama yok; müşteri unutursa yönetici veriyor.
    if (typeof g?.password === 'string' || g?.password === '') {
      const yeni = String(g.password ?? '').trim() || uretilmisSifre();
      const kusur = sifreKusuru(yeni);
      if (kusur) return reply.status(400).send({ error: kusur });

      const sonuc = await sifreDegistir('musteri', id, null, yeni);
      if (!sonuc.ok) return reply.status(400).send({ error: sonuc.hata });
      return { sifirlandi: true, sifre: yeni };
    }

    if (g?.role === 'owner' || g?.role === 'member') {
      const { error } = await supabase.from('users').update({ role: g.role }).eq('id', id);
      if (error) return reply.status(500).send({ error: 'Could not update the user.' });
      return { guncellendi: true };
    }

    return reply.status(400).send({ error: 'Nothing to update.' });
  });

  server.delete('/admin/api/users/:id', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const { id } = request.params as { id: string };

    // Kullanıcının sahip olduğu anahtarlar silinmiyor: kod onlarla çalışmaya
    // devam ediyor. Yalnızca sahipsiz kalıyorlar, ortak anahtar oluyorlar.
    // Kişi ayrıldı diye çalışan bir servisi durdurmak istemiyoruz.
    await supabase.from('client_keys').update({ user_id: null }).eq('user_id', id);

    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) return reply.status(500).send({ error: 'Could not remove the user.' });
    return { silindi: true };
  });

  // Anahtara ad ve sahip atama.
  server.patch('/admin/api/keys/:id/owner', async (request, reply) => {
    if (!(await hesapOturumuMu(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const { id } = request.params as { id: string };
    const g = request.body as { label?: string; user_id?: string | null };

    const guncelleme: Record<string, unknown> = {};
    if (typeof g?.label === 'string') guncelleme.label = g.label.trim() || null;
    if (g?.user_id !== undefined) guncelleme.user_id = g.user_id || null;
    if (!Object.keys(guncelleme).length) {
      return reply.status(400).send({ error: 'Nothing to update.' });
    }

    const { data, error } = await supabase
      .from('client_keys').update(guncelleme).eq('id', id)
      .select('id, label, user_id').single();
    if (error) return reply.status(500).send({ error: 'Could not update the key.' });
    return { anahtar: data };
  });

  // ---------------- yönetici oturumu ----------------

  const URETIM = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

  server.post('/admin/api/session', async (request, reply) => {
    const g = request.body as { email?: string; password?: string } | undefined;
    const eposta = String(g?.email ?? '').trim();
    const sifre = String(g?.password ?? '');
    if (!eposta || !sifre) {
      return reply.status(400).send({ error: 'Email and password are required.' });
    }

    const sonuc = await girisDogrula('yonetici', eposta, sifre);
    if (!sonuc.ok) {
      // Hangi kısmın yanlış olduğunu söylemiyoruz.
      return reply.status(401).send({ error: 'Email or password is not correct.' });
    }

    reply.header('set-cookie', cerezYaz(CEREZ_ADI.yonetici, sonuc.cerez, URETIM));
    return { hesap: { id: sonuc.hesap.id, email: sonuc.hesap.email } };
  });

  server.delete('/admin/api/session', async (_request, reply) => {
    reply.header('set-cookie', cerezSil(CEREZ_ADI.yonetici, URETIM));
    return { cikildi: true };
  });

  server.get('/admin/api/me', async (request, reply) => {
    const hesap = await oturumdakiHesap('yonetici', request.headers.cookie);
    if (hesap) return { hesap: { id: hesap.id, email: hesap.email }, yol: 'hesap' };

    // Jetonla girilmişse de oturum sayılıyor, ama hesabı yok.
    if (await yoneticiMi(request as never)) return { hesap: null, yol: 'jeton' };
    return reply.status(401).send({ error: 'No active session.' });
  });

  // Yönetici hesapları. İlk hesap ADMIN_TOKEN ile açılıyor; sonrasında
  // hesaplar birbirini açabiliyor.
  server.get('/admin/api/admins', async (request, reply) => {
    if (!(await yoneticiMi(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const { data, error } = await supabase
      .from('admin_users').select('id, email, created_at, last_login_at')
      .order('created_at', { ascending: true });
    if (error) {
      const eksik = /relation|does not exist/i.test(String(error.message));
      return reply.status(eksik ? 428 : 500).send({
        error: eksik ? 'Run giris-sistemi.sql first.' : 'Could not read administrators.'
      });
    }
    return { yoneticiler: data ?? [] };
  });

  server.post('/admin/api/admins', async (request, reply) => {
    if (!(await yoneticiMi(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const g = request.body as { email?: string; password?: string };
    const sifre = String(g?.password ?? '').trim() || uretilmisSifre();
    const sonuc = await hesapOlustur('yonetici', String(g?.email ?? ''), sifre);
    if (!sonuc.ok) return reply.status(400).send({ error: sonuc.hata });
    return { yonetici: sonuc.hesap, sifre };
  });

  server.patch('/admin/api/admins/:id', async (request, reply) => {
    if (!(await yoneticiMi(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const { id } = request.params as { id: string };
    const g = request.body as { password?: string };
    const yeni = String(g?.password ?? '').trim() || uretilmisSifre();
    const kusur = sifreKusuru(yeni);
    if (kusur) return reply.status(400).send({ error: kusur });

    const sonuc = await sifreDegistir('yonetici', id, null, yeni);
    if (!sonuc.ok) return reply.status(400).send({ error: sonuc.hata });
    return { sifirlandi: true, sifre: yeni };
  });

  server.delete('/admin/api/admins/:id', async (request, reply) => {
    if (!(await yoneticiMi(request as never))) {
      return reply.status(401).send({ error: 'Unauthorized.' });
    }
    const { id } = request.params as { id: string };

    // Son yönetici silinmesin: hiç hesap kalmazsa panele yalnızca
    // ADMIN_TOKEN ile girilebilir ve o da bir gün kaldırılacak.
    const { data } = await supabase.from('admin_users').select('id');
    if ((data ?? []).length <= 1) {
      return reply.status(409).send({ error: 'Cannot remove the last administrator.' });
    }

    const { error } = await supabase.from('admin_users').delete().eq('id', id);
    if (error) return reply.status(500).send({ error: 'Could not remove the administrator.' });
    return { silindi: true };
  });
}

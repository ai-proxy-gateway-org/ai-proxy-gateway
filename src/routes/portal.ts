// Müşteri portalı.
//
// Müşteri kendi proxy anahtarıyla giriş yapar ve yalnızca kendi kullanım
// kayıtlarını görür. Ayrı bir kimlik sistemi kurulmadı: anahtar zaten
// verifyClient tarafından doğrulanabiliyor, ikinci bir giriş mekanizması
// kurmak gereksiz karmaşıklık olurdu.
//
// Sayfa HTML'i bu dosyada metin sabiti olarak duruyor. Ayrı bir .html dosyası
// okumak yerine böyle yapıldı: sunucusuz ortamda dağıtım paketine hangi
// dosyaların gireceği garanti değil, metin sabiti her zaman kodla birlikte gelir.

import type { FastifyInstance } from 'fastify';
import { STIL, YAZI_TIPI } from '../ui/stil.js';
import { verifyClient } from '../middleware/authMiddleware.js';
import { butceDurumu } from '../core/butce.js';
import {
  girisDogrula, oturumdakiHesap, sifreDegistir, CEREZ_ADI
} from '../core/kimlik.js';
import { cerezYaz, cerezSil } from '../utils/hesap.js';
import { supabase } from '../services/db.js';
import { hashApiKey } from '../utils/auth.js';
import { checkRateLimit } from '../middleware/rateLimiter.js';
import { priceList } from '../core/modelCatalog.js';

const SAYFA = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Usage Portal</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23111214'/%3E%3Ctext x='16' y='22' font-family='system-ui,sans-serif' font-size='14' font-weight='700' fill='white' text-anchor='middle'%3EAP%3C/text%3E%3C/svg%3E">
${YAZI_TIPI}
<style>${STIL}
  /* Giriş yolu seçimi: hesap ya da anahtar. Anahtar yolu geçici — hesaplar
     yerleşince kaldırılacak, o yüzden ikincil duruyor. */
  .girisSekme { display:flex; gap:.3rem; background:var(--sunk); padding:.25rem;
    border-radius:9px; margin:.6rem 0 1.1rem; }
  .girisSekme button { flex:1; padding:.45rem .6rem; font:inherit; font-size:.86rem;
    border:0; border-radius:7px; background:none; color:var(--ink-3); cursor:pointer; }
  .girisSekme button.secili { background:var(--surface); color:var(--ink); font-weight:500;
    box-shadow:0 1px 2px rgba(0,0,0,.06); }
  .alanEtiket { display:block; font-size:.85rem; color:var(--ink-3); }
  .alanEtiket input { margin-top:.35rem; }
</style>
</head>
<body>

<!-- ================= GİRİŞ ================= -->
<div class="girisSayfa" id="girisEkran">
  <button class="temaKose" id="temaKose">
    <svg viewBox="0 0 24 24" id="temaKoseSimge"></svg>
    <span id="temaKoseYazi">Dark mode</span>
  </button>
  <div class="girisKutu">
    <div class="marka">
      <div class="markaSimge">AP</div>
      <div><div class="markaAd">AI Proxy</div></div>
    </div>
    <div class="kart">
      <div class="baslikkucuk">Usage Portal</div>

      <div class="girisSekme" id="girisSekme">
        <button data-yol="hesap" class="secili">Email</button>
        <button data-yol="anahtar">API key</button>
      </div>

      <div id="yolHesap">
        <label class="alanEtiket">Email
          <input id="eposta" type="email" placeholder="you@company.com" autocomplete="username">
        </label>
        <label class="alanEtiket" style="margin-top:.7rem">Password
          <input id="sifre" type="password" placeholder="••••••••••" autocomplete="current-password">
        </label>
        <button class="dugme koyu" id="btnHesap" style="width:100%;margin-top:.9rem">Sign in</button>
        <div class="yardim" style="margin-top:.7rem">
          Accounts are created by your provider. Forgot your password? Ask them to reset it.
        </div>
      </div>

      <div id="yolAnahtar" class="gizli">
        <div class="yardim" style="margin:.35rem 0 .9rem">
          Sign in with the <code>sk-proxy-</code> key you were given.
        </div>
        <input id="anahtar" type="password" placeholder="sk-proxy-..." autocomplete="off">
        <button class="dugme koyu" id="btn" style="width:100%;margin-top:.7rem">Sign in</button>
        <div class="yardim" style="margin-top:.7rem">
          Signing in with a key still works, but accounts are the way forward:
          changing your key no longer locks you out.
        </div>
      </div>

      <div class="uyari gizli" id="hata"></div>
    </div>
  </div>
</div>

<!-- ================= UYGULAMA ================= -->
<div class="uygulama gizli" id="uygulama">

  <aside class="yanmenu">
    <div class="menuUst">
      <div class="marka" style="margin:0">
        <div class="markaSimge">AP</div>
        <div style="min-width:0">
          <div class="markaAd">AI Proxy</div>
          <div class="menuMusteri" id="menuMusteri"></div>
        </div>
      </div>
    </div>

    <div class="menuBaslik">Portal</div>
    <nav id="menu">
      <button data-bolum="genel" class="secili">
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
        Overview</button>
      <button data-bolum="kullanim">
        <svg viewBox="0 0 24 24"><path d="M3 20h18"/><rect x="5" y="11" width="3" height="6"/><rect x="11" y="6" width="3" height="11"/><rect x="17" y="13" width="3" height="4"/></svg>
        Usage</button>
      <button data-bolum="istekler">
        <svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
        Requests</button>
      <button data-bolum="fiyat">
        <svg viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Pricing</button>
      <button data-bolum="anahtar">
        <svg viewBox="0 0 24 24"><circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21l-2 2.5M17 12v3"/></svg>
        API Keys</button>
      <button data-bolum="ayarlar">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>
        Settings</button>
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
        <h1 id="sayfaBaslik">Overview</h1>
        <div class="altbilgi" id="sayfaAlt"></div>
      </div>
      <div style="display:flex;gap:.6rem;align-items:center">
        <div class="segment gizli" id="filtre">
          <button data-gun="7">7 days</button>
          <button data-gun="30" class="secili">30 days</button>
          <button data-gun="0">All time</button>
        </div>
        <button class="dugme cerceveli" id="yenile">Refresh</button>
      </div>
    </div>

    <div class="govde">
      <div class="uyari gizli" id="uyari"></div>
      <div class="yukleniyor gizli" id="yukleniyor">Loading...</div>

      <div id="icerik">
        <!-- GENEL BAKIŞ -->
        <section data-bolum="genel">
          <div class="metrikkart" id="ozet"></div>
          <div class="kart gizli" id="butceKart" style="margin-top:1rem">
            <div class="baslikkucuk">Budget</div>
            <div class="yardim" style="margin:.3rem 0 .9rem">
              Requests stop when a limit is used up. Daily resets at midnight,
              monthly on the first.
            </div>
            <div id="butceSatir"></div>
          </div>

          <div class="kart gizli" id="benimKart" style="margin-top:1rem">
            <div class="baslikkucuk">Your usage</div>
            <div class="yardim" style="margin:.3rem 0 .9rem">
              Requests sent with the keys you own, within the selected period.
            </div>
            <div class="hesap" id="benimSatir"></div>
          </div>
          <div class="ikincil-olculer" id="ekstra"></div>
          <div class="kart" style="margin-top:.85rem">
            <div class="grafikUst">
              <div class="grafikbaslik" id="grafikbaslik">Daily spend</div>
              <div class="grafikOkuma" id="grafikOkuma"></div>
            </div>
            <div id="grafik"></div>
          </div>
        </section>

        <!-- KULLANIM -->
        <section data-bolum="kullanim" class="gizli">
          <div class="satirbasi" style="margin-top:0"><div class="baslikkucuk">By model</div></div>
          <div class="tablokart"><div class="kaydir"><table id="kirilim"></table></div></div>

          <div class="satirbasi">
            <div class="baslikkucuk">By key</div>
            <div class="sayac" id="anahtarSayac"></div>
          </div>
          <div class="tablokart"><div class="kaydir"><table id="anahtarTablo"></table></div></div>
          <div class="yardim" style="margin-top:.8rem">
            Keys with an owner count as that person's usage. Shared service keys belong to the
            whole company and are not attributed to anyone.
          </div>
        </section>

        <!-- İSTEKLER -->
        <section data-bolum="istekler" class="gizli">
          <div class="satirbasi">
            <div class="sekmeler" id="sekmeler">
              <button data-durum="tum" class="secili">All requests<span class="adet" id="adetTum"></span></button>
              <button data-durum="hata">Failed only<span class="adet" id="adetHata"></span></button>
            </div>
            <div class="sayac" id="sayac"></div>
          </div>
          <div class="tablokart">
            <div class="kaydir"><table id="tablo"></table></div>
            <div class="bosdurum gizli" id="bos"></div>
          </div>
          <button class="dugme cerceveli gizli" id="dahafazla" style="width:100%;margin-top:.75rem">Load more</button>
        </section>

        <!-- PRICING -->
        <section data-bolum="fiyat" class="gizli">
          <div class="satirbasi" style="margin-top:0">
            <div class="baslikkucuk">Model pricing</div>
          </div>
          <div class="tablokart"><div class="kaydir"><table id="fiyatTablo"></table></div></div>
          <div class="yardim" style="margin-top:.7rem">
            Prices are set by your system administrator and shown per 1M tokens.
          </div>

          <div class="satirbasi"><div class="baslikkucuk">Cost calculator</div></div>
          <div class="kart" style="max-width:44rem">
            <div class="yardim" style="margin-bottom:1.2rem">
              Estimate what a request will cost before you send it.
            </div>
            <div class="hesapForm">
              <label>Model<select id="hesapModel"></select></label>
              <label>Input tokens<input id="hesapGirdi" type="number" min="0" value="10000"></label>
              <label>Output tokens<input id="hesapCikti" type="number" min="0" value="2000"></label>
            </div>

            <dl class="ozellik" id="modelDetay" style="margin-top:1.4rem"></dl>
            <div class="hesap" id="hesapSonuc" style="margin-top:1.3rem"></div>

            <div class="yardim" style="margin-top:1rem">
              This is an estimate. To verify a real charge, open any record under
              <b>Requests</b> — the stored cost is recomputed and compared there.
            </div>
          </div>
        </section>

        <!-- AYARLAR -->
        <section data-bolum="ayarlar" class="gizli">
          <div class="kart gizli" id="hesapKart" style="max-width:44rem;margin-bottom:.85rem">
            <div class="baslikkucuk">Your account</div>
            <div class="yardim" style="margin-top:.35rem" id="hesapBilgi"></div>

            <div class="formSatir" style="margin-top:1.2rem;grid-template-columns:1fr 1fr">
              <label>Current password
                <input id="sifreEski" type="password" autocomplete="current-password"></label>
              <label>New password
                <input id="sifreYeni" type="password" autocomplete="new-password"
                       placeholder="at least 10 characters"></label>
            </div>
            <button class="dugme koyu" id="sifreDegistir" style="margin-top:1.1rem">
              Change password</button>
            <div class="yardim" style="margin-top:.7rem">
              Changing your password signs you out everywhere, including sessions you forgot
              about on other devices.
            </div>
            <div class="uyari gizli" id="sifreNot"></div>
          </div>

          <div class="kart" style="max-width:44rem">
            <div class="baslikkucuk">Export usage records</div>
            <div class="yardim" style="margin-top:.35rem">
              Downloads every request in the selected period as a spreadsheet file.
              Opens in Excel and Google Sheets.
            </div>

            <dl class="ozellik" style="margin-top:1.4rem">
              <dt>Period</dt><dd id="disaAktarDonem"></dd>
              <dt>Records</dt><dd id="disaAktarAdet"></dd>
              <dt>Columns</dt><dd class="yardim">time · provider · model · input tokens ·
                output tokens · latency · cost · status · error</dd>
            </dl>

            <button class="dugme koyu" id="disaAktar" style="margin-top:1.4rem">
              Download CSV</button>
            <div class="yardim gizli" id="disaAktarNot" style="margin-top:.7rem"></div>
          </div>

          <div class="kart" style="max-width:44rem;margin-top:.85rem">
            <div class="baslikkucuk">Key management</div>
            <div class="yardim" style="margin-top:.35rem">
              Contact your system administrator to rotate or revoke your key.
              This is not yet available from the portal.
            </div>
          </div>
        </section>

        <!-- ANAHTARIM -->
        <section data-bolum="anahtar" class="gizli">
          <div class="kart" style="max-width:44rem">
            <div class="baslikkucuk">Key details</div>
            <dl class="ozellik" id="anahtarBilgi" style="margin-top:1rem"></dl>
          </div>
          <div class="kart" style="max-width:44rem;margin-top:.85rem">
            <div class="baslikkucuk">Access permissions</div>
            <div class="yardim" style="margin-top:.3rem">
              These are set by your system administrator and cannot be changed here.
            </div>
            <dl class="ozellik" id="izinBilgi" style="margin-top:1rem"></dl>
          </div>
        </section>
      </div>
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
  let anahtar = null, hesap = null, gun = 30, offset = 0, toplam = 0,
      sadeceHata = false, bolum = 'genel';
  let fiyatlar = {};        // model → { input, output }, 1000 token başına
  let satirlar = [];        // ekranda duran istek kayıtları

  // Anahtar tarayıcının kalıcı belleğinde ama SÜRE SINIRLI tutuluyor.
  // Süresiz saklamak istemedik: anahtar aynı zamanda API anahtarı, tarayıcıda
  // sonsuza kadar durmamalı. 12 saat sonra kendiliğinden düşüyor.
  const DEPO = 'proxy-oturum';
  const SURE = 12 * 60 * 60 * 1000;

  const anahtarOku = () => {
    try {
      const ham = localStorage.getItem(DEPO);
      if (!ham) return null;
      const { a, t } = JSON.parse(ham);
      if (!a || !t || Date.now() - t > SURE) { localStorage.removeItem(DEPO); return null; }
      return a;
    } catch (e) { return null; }
  };
  const anahtarYaz = (v) => {
    try {
      if (v) localStorage.setItem(DEPO, JSON.stringify({ a: v, t: Date.now() }));
      else localStorage.removeItem(DEPO);
    } catch (e) {}
  };
  const $ = (id) => document.getElementById(id);
  // Anahtar adları veritabanından geliyor; HTML'e basmadan önce kaçırıyoruz.
  const kacir = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Anahtarla girildiyse başlık ekleniyor; oturumla girildiyse çerez zaten
  // gidiyor ve anahtar elimizde yok.
  const basliklar = () => anahtar ? { authorization: 'Bearer ' + anahtar } : {};

  // --- Tema: sistem tercihini izler, elle değiştirilirse hatırlar ---
  const AY = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
  const GUNES = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>';

  let temaSecimi = null;

  function temaUygula(secim) {
    const kok = document.documentElement;
    if (secim) kok.setAttribute('data-tema', secim); else kok.removeAttribute('data-tema');
    const koyuMu = secim
      ? secim === 'koyu'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const simge = koyuMu ? GUNES : AY;
    const yazi = koyuMu ? 'Light mode' : 'Dark mode';
    $('temaSimge').innerHTML = simge;
    $('temaYazi').textContent = yazi;
    $('temaKoseSimge').innerHTML = simge;
    $('temaKoseYazi').textContent = yazi;
  }

  function temaDegistir() {
    const kok = document.documentElement;
    const suAnKoyu = kok.getAttribute('data-tema') === 'koyu' ||
      (!kok.hasAttribute('data-tema') && matchMedia('(prefers-color-scheme: dark)').matches);
    temaSecimi = suAnKoyu ? 'acik' : 'koyu';
    try { localStorage.setItem('proxy-tema', temaSecimi); } catch (e) {}
    temaUygula(temaSecimi);
  }

  try { temaSecimi = localStorage.getItem('proxy-tema'); } catch (e) {}
  temaUygula(temaSecimi);
  // Para biçimi: küçük tutarlarda anlamlı basamak kalsın, büyükte sadeleşsin.
  const para = (n) => { const v = Number(n);
    return '$' + (v === 0 ? '0.00' : v < 0.001 ? v.toFixed(6) : v < 1 ? v.toFixed(4) : v.toFixed(2)); };
  // 1 doların altındaki tutarlar iki basamağa yuvarlanırsa yanıltıcı oluyor:
  // 0.058248 → "0.06". Küçük tutarlarda anlamlı basamak korunuyor.
  const paraKisa = (n) => { const v = Number(n);
    return '$' + (v === 0 ? '0.00' : v < 0.001 ? v.toFixed(6) : v < 1 ? v.toFixed(4)
      : v < 1000 ? v.toFixed(2) : (v/1000).toFixed(1) + 'K'); };
  const bin = (n) => Number(n).toLocaleString('en-GB');
  const tarih = (s) => new Date(s).toLocaleString('en-GB',
    { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  const gunTarih = (s) => new Date(s).toLocaleDateString('en-GB',
    { day:'numeric', month:'long', year:'numeric' });

  const BASLIK = {
    genel:    ['Overview',   'Usage summary for the selected period'],
    kullanim: ['Usage',      'Breakdown by model'],
    istekler: ['Requests',   'Individual request records'],
    anahtar:  ['API Keys',   'Your key and access permissions'],
    ayarlar:  ['Settings',   'Data export and account actions'],
    fiyat:    ['Pricing',    'Model prices and cost calculator']
  };

  function bolumGoster(yeni) {
    bolum = yeni;
    document.querySelectorAll('#menu button').forEach(b =>
      b.classList.toggle('secili', b.dataset.bolum === yeni));
    document.querySelectorAll('section[data-bolum]').forEach(s =>
      s.classList.toggle('gizli', s.dataset.bolum !== yeni));
    $('sayfaBaslik').textContent = BASLIK[yeni][0];
    $('sayfaAlt').textContent = BASLIK[yeni][1];
    $('filtre').classList.toggle('gizli',
      yeni === 'anahtar' || yeni === 'ayarlar' || yeni === 'fiyat');
    if (yeni === 'ayarlar') ayarlarTazele();
  }

  let cizimVeri = [];

  function okumaYaz(g) {
    if (!g) { $('grafikOkuma').innerHTML = ''; return; }
    const t = new Date(g.gun + 'T00:00:00')
      .toLocaleDateString('en-GB', { day:'numeric', month:'long' });
    $('grafikOkuma').innerHTML = t + ' · <b>' + g.istek + ' requests</b> · <b>' + paraKisa(g.maliyet) + '</b>';
  }

  function cizimYap(gunluk) {
    cizimVeri = gunluk || [];
    if (cizimVeri.length < 2) { $('grafik').innerHTML = ''; okumaYaz(null); return; }

    const G = 1000, Y = 260, sag = 16, ust = 14, alt = 34, sol = 84;
    const icG = G - sol - sag, icY = Y - ust - alt;
    const enY = Math.max(...cizimVeri.map(d => d.maliyet), 0);
    const tavan = (() => { if (enY <= 0) return 1;
      const u = Math.pow(10, Math.floor(Math.log10(enY)));
      for (const k of [1,2,5,10]) if (enY <= k*u) return k*u; return 10*u; })();
    const x = (i) => sol + (i / (cizimVeri.length - 1)) * icG;
    const y = (v) => ust + icY - (v / tavan) * icY;

    const bas = tavan < 0.01 ? 4 : tavan < 1 ? 3 : 2;
    const eksenPara = (v) => '$' + Number(v).toFixed(bas);

    let s = '';
    for (let k = 0; k <= 4; k++) {
      const d = (tavan/4)*k, yy = y(d);
      s += '<line class="' + (k===0?'taban':'kilavuz') + '" x1="'+sol+'" y1="'+yy+'" x2="'+(G-sag)+'" y2="'+yy+'"/>'
         + '<text class="eksenyazi" x="'+(sol-14)+'" y="'+(yy+4)+'" text-anchor="end">'+eksenPara(d)+'</text>';
    }

    const nk = cizimVeri.map((d,i) => x(i)+','+y(d.maliyet)).join(' ');
    s += '<polygon class="dolgu" points="'+sol+','+y(0)+' '+nk+' '+(G-sag)+','+y(0)+'"/>'
       + '<polyline class="cizgi" points="'+nk+'"/>';
    cizimVeri.forEach((d,i) => { if (d.istek) s += '<circle class="nokta" cx="'+x(i)+'" cy="'+y(d.maliyet)+'" r="3.5"/>'; });

    // Tarih etiketleri: aralık kısaysa her gün, uzunsa seyrekleşiyor.
    // Amaç en fazla ~8 etiket, üst üste binmesin.
    const kisa = (g) => new Date(g+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    // Etiketler eşit aralıkla. Son gün de yazılıyor ama YALNIZCA bir önceki
    // etiketten yeterince uzaksa — yoksa üst üste biniyorlar.
    const adim = Math.max(1, Math.ceil(cizimVeri.length / 8));
    const yazilan = [];
    for (let i = 0; i < cizimVeri.length; i += adim) yazilan.push(i);

    const sonI = cizimVeri.length - 1;
    const sonYazilan = yazilan[yazilan.length - 1];
    if (sonI - sonYazilan >= Math.ceil(adim * 0.6)) {
      yazilan.push(sonI);
    } else if (sonI !== sonYazilan) {
      // Son etiket sığmıyorsa, ona en yakın olanı sona kaydır.
      yazilan[yazilan.length - 1] = sonI;
    }

    for (const i of yazilan)
      s += '<text class="eksenyazi" x="'+x(i)+'" y="'+(Y-8)+'" text-anchor="middle">'+kisa(cizimVeri[i].gun)+'</text>';

    // imleç çizgisi + vurgulu nokta (gizli, üstüne gelinince açılıyor)
    s += '<line id="imlec" class="imlec gizli" y1="'+ust+'" y2="'+(ust+icY)+'"/>'
       + '<circle id="vurguNokta" class="vurgu gizli" r="5"/>';

    // her gün için şeffaf yakalama alanı
    const genislik = icG / (cizimVeri.length - 1);
    cizimVeri.forEach((d,i) => {
      s += '<rect class="yakala" data-i="'+i+'" x="'+(x(i)-genislik/2)+'" y="'+ust+
           '" width="'+genislik+'" height="'+icY+'"/>';
    });

    $('grafik').innerHTML = '<svg class="cizim" viewBox="0 0 '+G+' '+Y+'">'+s+'</svg>';

    // en yoğun günü varsayılan okuma yap — grafiğin ölçeği hemen anlaşılsın
    const zirve = cizimVeri.reduce((a,b) => b.maliyet > a.maliyet ? b : a, cizimVeri[0]);
    okumaYaz(zirve.istek ? zirve : null);

    const svg = $('grafik').querySelector('svg');
    svg.addEventListener('mousemove', (e) => {
      const r = e.target.closest('.yakala'); if (!r) return;
      const i = Number(r.dataset.i), d = cizimVeri[i];
      okumaYaz(d);
      const im = document.getElementById('imlec');
      im.setAttribute('x1', x(i)); im.setAttribute('x2', x(i));
      im.classList.remove('gizli');
      const vn = document.getElementById('vurguNokta');
      vn.setAttribute('cx', x(i)); vn.setAttribute('cy', y(d.maliyet));
      vn.classList.remove('gizli');
    });
    svg.addEventListener('mouseleave', () => {
      document.getElementById('imlec').classList.add('gizli');
      document.getElementById('vurguNokta').classList.add('gizli');
      okumaYaz(zirve.istek ? zirve : null);
    });
  }

  // Kıyas satırı. Seçili dönem, kendisinden hemen önceki aynı uzunluktaki
  // dönemle karşılaştırılıyor. Hangi aralıkla kıyaslandığı yazıda geçiyor,
  // yoksa "önceki dönem" ifadesi havada kalıyor.
  function oncekiAralik() {
    const g = new Date(Date.now() - gun * 86400000);
    const b = new Date(Date.now() - 2 * gun * 86400000);
    const bic = (d) => d.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    return bic(b) + ' – ' + bic(g);
  }

  function fark(simdi, onceki, ters, bicim) {
    if (onceki === null || onceki === undefined) return '';
    const yaz = bicim || bin;
    if (onceki === 0)
      return '<div class="fark">' + oncekiAralik() + ' — no data</div>';
    const o = ((simdi - onceki) / onceki) * 100;
    const yon = o > 0 ? '↑' : o < 0 ? '↓' : '—';

    // Renk yalnızca yönü anlamlı olan ölçülerde. Harcamanın artması iyi mi
    // kötü mü bilinemez; hata sayısının artması kesin kötü.
    const sinif = ters ? (o > 0 ? ' kotu' : o < 0 ? ' iyi' : '') : '';

    // Yüzde 1000'i aşınca sayı okunmaz oluyor (%2136 gibi). O noktadan sonra
    // "kaç kat" daha anlaşılır.
    let oranMetni;
    if (Math.abs(o) < 1000) {
      oranMetni = yon + ' %' + Math.abs(o).toFixed(0);
    } else {
      const kat = simdi / onceki;
      oranMetni = yon + ' ' + (kat >= 10 ? Math.round(kat) : kat.toFixed(1)) + '×';
    }
    return '<div class="fark">' +
      '<span class="etiket-degisim' + sinif + '">' + oranMetni + '</span>' +
      '<span>vs. previous: ' + yaz(onceki) + '</span></div>';
  }

  const SAGLAYICI = { openai:'s-openai', anthropic:'s-anthropic', gemini:'s-gemini' };
  const RENK = { openai:'#10a37f', anthropic:'#c96442', gemini:'#3b82f6' };
  const saglayiciAdi = (m) => String(m).split('/')[0];
  const nokta = (m) => '<span class="nokta-s ' + (SAGLAYICI[saglayiciAdi(m)] || '') + '"></span>';

  function gecenSure(iso) {
    if (!iso) return '—';
    const fark = Date.now() - new Date(iso).getTime();
    const dk = Math.floor(fark / 60000);
    if (dk < 1) return 'just now';
    if (dk < 60) return dk + ' min ago';
    const sa = Math.floor(dk / 60);
    if (sa < 24) return sa + ' hours ago';
    return Math.floor(sa / 24) + ' days ago';
  }

  let sonIstekZamani = null;

  function ekstraCiz(e) {
    if (!e) { $('ekstra').innerHTML = ''; sonIstekZamani = null; return; }
    sonIstekZamani = e.sonIstek;
    const o = (ad, deger) => '<div class="olcu"><div class="ad">' + ad +
      '</div><div class="deger">' + deger + '</div></div>';
    $('ekstra').innerHTML =
      o('Top model', e.enCokKullanilan
        ? nokta(e.enCokKullanilan.model) + e.enCokKullanilan.model.split('/')[1]
        : '—') +
      o('Success rate', e.basariOrani === null ? '—' : '%' + (e.basariOrani * 100).toFixed(1)) +
      o('Avg. latency', e.ortalamaSure === null ? '—' : e.ortalamaSure + ' ms') +
      o('Last request', '<span id="sonIstekYazi">' + gecenSure(e.sonIstek) + '</span>');
  }

  // "3 saat önce" ifadesi tarayıcıda üretiliyor; sayfa açık kalırsa donuk
  // kalmasın diye dakikada bir yeniden yazılıyor. Sunucuya gidilmiyor.
  setInterval(() => {
    const y = document.getElementById('sonIstekYazi');
    if (y && sonIstekZamani) y.textContent = gecenSure(sonIstekZamani);
  }, 60000);

  function metrikCiz(v) {
    const o = v.ozet, p = v.oncekiOzet;
    const k = (ad, aciklama, sayi, s, n, ters, bicim) => '<div class="metrik"><div class="ad">'+ad+
      '</div><div class="aciklama">'+aciklama+'</div><div class="sayi">'+sayi+'</div>'+
      fark(s,n,ters,bicim)+'</div>';
    $('ozet').innerHTML =
      k('Requests', 'total sent', bin(o.istek), o.istek, p && p.istek, false) +
      k('Failed', 'requests with errors', bin(o.basarisiz), o.basarisiz, p && p.basarisiz, true) +
      k('Tokens', 'text units processed', bin(o.girdiToken + o.ciktiToken),
        o.girdiToken+o.ciktiToken, p && p.token, false) +
      k('Cost', 'total amount', paraKisa(o.maliyet), o.maliyet, p && p.maliyet, false, paraKisa);
  }

  // Üç durum var: success, error, pending. Önceden success dışındaki her şey
  // hata sayılıyordu; pending hata değil, kaydı henüz tamamlanmamış istek.
  function durumHapi(k) {
    if (k.status === 'success') return '<span class="hap ok">success</span>';
    if (k.status === 'pending') return '<span class="hap bek">pending</span>';
    return '<span class="hap err">'+(k.error_message || 'error').slice(0,38)+'</span>';
  }

  function satirlariCiz(kayitlar, ekle) {
    if (ekle) satirlar = satirlar.concat(kayitlar); else satirlar = kayitlar.slice();
    const bas = ekle ? satirlar.length - kayitlar.length : 0;
    const g = kayitlar.map((k, i) =>
      '<tr class="tiklanir" data-i="'+(bas+i)+'"><td class="sayi">'+tarih(k.created_at)+'</td>'+
      '<td>'+nokta(k.provider)+k.provider+'/'+k.model+'</td>'+
      '<td class="sayi">'+(k.input_tokens ?? 0)+'</td>'+
      '<td class="sayi">'+(k.output_tokens ?? 0)+'</td>'+
      '<td class="sayi">'+(k.latency_ms ?? 0)+' ms</td>'+
      '<td class="sayi">'+para(k.cost ?? 0)+'</td>'+
      '<td>'+durumHapi(k)+'</td></tr>').join('');
    if (ekle) $('tablo').querySelector('tbody').insertAdjacentHTML('beforeend', g);
    else $('tablo').innerHTML = '<thead><tr><th>Time</th><th>Model</th><th>Input</th>'+
      '<th>Output</th><th>Latency</th><th>Cost</th><th>Status</th></tr></thead><tbody>'+g+'</tbody>';
  }

  function hesapCiz() {
    const liste = hesap.anahtarlar || [];

    // Anahtarın açık hali hiçbir zaman saklanmıyor — yalnızca ilk on bir
    // karakteri. Ondan öncesinde üretilenlerde o da yok; "null••••null" yerine
    // durumu açıkça yazıyoruz.
    $('anahtarBilgi').innerHTML = liste.length
      ? liste.map(a =>
          '<dt>' + (a.ad ? kacir(a.ad) : '<span class="yardim">unnamed</span>') +
          (a.buOturum ? ' <span class="hap ok">this session</span>' : '') +
          (a.benim ? ' <span class="hap ok">yours</span>'
                   : a.ortak ? ' <span class="hap">shared</span>' : '') +
          '</dt><dd>' +
          '<span class="mono">' +
          (a.onEk ? kacir(a.onEk) + '••••••••' : '<span class="yardim">hidden</span>') +
          '</span>' +
          ' · ' + kacir(a.ortam) +
          ' · ' + (a.aktif ? '<span class="hap ok">active</span>'
                           : '<span class="hap">revoked</span>') +
          ' · ' + (a.olusturma ? gunTarih(a.olusturma) : '—') +
          '</dd>').join('')
      : '<dt>Keys</dt><dd class="yardim">No keys yet.</dd>';
    $('izinBilgi').innerHTML =
      '<dt>Client type</dt><dd>' + (hesap.clientType === 'browser-based'
        ? 'Browser-based' : 'Server-based') + '</dd>' +
      '<dt>Available models</dt><dd>' + ((hesap.allowedModels || []).length
        ? hesap.allowedModels.map(m => '<span class="rozet">'+m+'</span>').join('')
        : '<span class="yardim">none defined</span>') + '</dd>' +
      '<dt>Allowed domains</dt><dd>' + ((hesap.allowedDomains || []).length
        ? hesap.allowedDomains.map(d => '<span class="rozet">'+d+'</span>').join('')
        : '<span class="yardim">no restriction</span>') + '</dd>';
  }

  // --- İstek detayı: maliyet yeniden hesaplanıp kayıtlı değerle karşılaştırılıyor ---
  function detayAc(k) {
    const anahtarAdi = k.provider + '/' + k.model;
    const f = fiyatlar[anahtarAdi];
    const gi = k.input_tokens ?? 0, ci = k.output_tokens ?? 0;
    const kayitli = Number(k.cost ?? 0);

    $('ypBaslik').innerHTML = nokta(k.provider) + anahtarAdi;
    $('ypZaman').textContent = new Date(k.created_at).toLocaleString('en-GB',
      { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit', second:'2-digit' });

    let govde =
      '<div class="bolumBaslik">Summary</div>' +
      '<dl class="ozellik">' +
        '<dt>Status</dt><dd>' + durumHapi(k) + '</dd>' +
        '<dt>Latency</dt><dd>' + (k.latency_ms ?? 0) + ' ms</dd>' +
        '<dt>Input tokens</dt><dd>' + bin(gi) + '</dd>' +
        '<dt>Output tokens</dt><dd>' + bin(ci) + '</dd>' +
      '</dl>';

    if (k.status === 'pending') {
      govde += '<div class="bolumBaslik">Cost</div>' +
        '<div class="dogrula bek">This request was not fully recorded. ' +
        'Token counts and cost are missing.</div>';
    } else if (!f) {
      govde += '<div class="bolumBaslik">Cost</div>' +
        '<div class="dogrula err">⚠ No price defined for this model, ' +
        'cost cannot be computed.</div>';
    } else {
      const gm = (gi / 1000) * f.input;
      const cm = (ci / 1000) * f.output;
      const yeni = gm + cm;
      const uyusuyor = Math.abs(yeni - kayitli) < 0.0000005;

      govde +=
        '<div class="bolumBaslik">Cost breakdown</div>' +
        '<div class="hesap">' +
          '<div class="sat"><span>input ' + bin(gi) + ' ÷ 1000 × $' + f.input + '</span><span>' + para(gm) + '</span></div>' +
          '<div class="sat"><span>output ' + bin(ci) + ' ÷ 1000 × $' + f.output + '</span><span>' + para(cm) + '</span></div>' +
          '<div class="cizgi"></div>' +
          '<div class="sat toplam"><span>recomputed</span><span>' + para(yeni) + '</span></div>' +
          '<div class="sat toplam"><span>stored value</span><span>' + para(kayitli) + '</span></div>' +
        '</div>' +
        (uyusuyor
          ? '<div class="dogrula ok">✓ Verified — stored value matches the current price.</div>'
          : '<div class="dogrula err">✗ Mismatch. The price may have changed after this ' +
            'record was written, or there is a calculation problem.</div>');
    }

    $('ypGovde').innerHTML = govde;
    $('perde').classList.remove('gizli'); $('yanpanel').classList.remove('gizli');
    requestAnimationFrame(() => {
      $('perde').classList.add('acik'); $('yanpanel').classList.add('acik');
    });
  }

  function detayKapat() {
    $('perde').classList.remove('acik'); $('yanpanel').classList.remove('acik');
    setTimeout(() => {
      $('perde').classList.add('gizli'); $('yanpanel').classList.add('gizli');
    }, 180);
  }

  $('perde').addEventListener('click', detayKapat);
  $('ypKapat').addEventListener('click', detayKapat);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') detayKapat(); });
  $('tablo').addEventListener('click', e => {
    const tr = e.target.closest('tr.tiklanir'); if (!tr) return;
    const k = satirlar[Number(tr.dataset.i)]; if (k) detayAc(k);
  });

  // --- Pricing: fiyatlar 1000 token başına saklanıyor, 1M üzerinden gösteriliyor ---
  const milyonBasi = (bin) => Number(bin) * 1000;

  function fiyatCiz() {
    const anahtarlar = Object.keys(fiyatlar).sort();
    if (!anahtarlar.length) {
      $('fiyatTablo').innerHTML = '';
      $('hesapSonuc').innerHTML = '';
      return;
    }

    const SAGLAYICI_ADI = { openai:'OpenAI', anthropic:'Anthropic', gemini:'Google' };

    const izinli = new Set((hesap && hesap.allowedModels) || []);

    $('fiyatTablo').innerHTML =
      '<thead><tr><th>Model</th><th>Provider</th><th>Input</th><th>Output</th><th>Access</th></tr></thead><tbody>' +
      anahtarlar.map(a => {
        const f = fiyatlar[a];
        const sg = saglayiciAdi(a);
        return '<tr><td>' + nokta(a) + a.split('/')[1] + '</td>' +
          '<td>' + (SAGLAYICI_ADI[sg] || sg) + '</td>' +
          '<td class="sayi">$' + milyonBasi(f.input).toFixed(2) + ' / 1M</td>' +
          '<td class="sayi">$' + milyonBasi(f.output).toFixed(2) + ' / 1M</td>' +
          '<td>' + (izinli.has(a)
            ? '<span class="hap ok">enabled</span>'
            : '<span class="hap">not enabled</span>') + '</td></tr>';
      }).join('') + '</tbody>';

    // Hesaplayıcıda yalnızca kullanabildiği modeller — kullanamayacağı bir
    // modelin maliyetini hesaplamak yanıltıcı olur.
    const secilebilir = anahtarlar.filter(a => izinli.has(a));
    const oncekiSecim = $('hesapModel').value;
    $('hesapModel').innerHTML = (secilebilir.length ? secilebilir : anahtarlar)
      .map(a => '<option value="' + a + '">' + a + '</option>').join('');
    if (oncekiSecim && [...$('hesapModel').options].some(o => o.value === oncekiSecim)) {
      $('hesapModel').value = oncekiSecim;
    }
    hesapla();
  }

  function hesapla() {
    const a = $('hesapModel').value;
    const f = fiyatlar[a];
    if (!f) { $('hesapSonuc').innerHTML = ''; $('modelDetay').innerHTML = ''; return; }

    const SG = { openai:'OpenAI', anthropic:'Anthropic', gemini:'Google' };
    const sg = saglayiciAdi(a);
    $('modelDetay').innerHTML =
      '<dt>Provider</dt><dd>' + nokta(a) + (SG[sg] || sg) + '</dd>' +
      '<dt>Model ID</dt><dd class="mono">' + a.split('/')[1] + '</dd>' +
      '<dt>Input price</dt><dd class="mono">$' + milyonBasi(f.input).toFixed(2) + ' / 1M tokens</dd>' +
      '<dt>Output price</dt><dd class="mono">$' + milyonBasi(f.output).toFixed(2) + ' / 1M tokens</dd>';

    const gi = Math.max(0, Number($('hesapGirdi').value) || 0);
    const ci = Math.max(0, Number($('hesapCikti').value) || 0);
    const gm = (gi / 1000) * f.input;
    const cm = (ci / 1000) * f.output;

    $('hesapSonuc').innerHTML =
      '<div class="sat"><span>input ' + bin(gi) + ' ÷ 1M × $' +
        milyonBasi(f.input).toFixed(2) + '</span><span>' + para(gm) + '</span></div>' +
      '<div class="sat"><span>output ' + bin(ci) + ' ÷ 1M × $' +
        milyonBasi(f.output).toFixed(2) + '</span><span>' + para(cm) + '</span></div>' +
      '<div class="cizgi"></div>' +
      '<div class="sat toplam"><span>estimated cost</span><span>' + para(gm + cm) + '</span></div>';
  }

  ['hesapModel', 'hesapGirdi', 'hesapCikti'].forEach(id =>
    $(id).addEventListener('input', hesapla));

  // İzinler yönetici tarafından değiştirilebilir. Refresh yalnızca kullanım
  // verisini tazeliyordu; hesap bilgisi giriş anında bir kez alınıyordu.
  // Artık izinler de tazeleniyor — yeni model tanımlandığında görünsün.
  async function hesapTazele() {
    try {
      const c = await fetch('/portal/api/login', { method:'POST',
        headers:{ 'content-type':'application/json' },
        body: JSON.stringify({ apiKey: anahtar }) });
      if (!c.ok) return;
      hesap = await c.json();
      $('menuMusteri').textContent = hesap.name;
      hesapCiz();
      fiyatCiz();
    } catch (e) { /* tazeleme başarısızsa eldeki bilgiyle devam */ }
  }

  async function kullanimGetir(ekle) {
    $('uyari').classList.add('gizli');
    if (!ekle) {
      if (!$('ozet').innerHTML) $('yukleniyor').classList.remove('gizli');
      $('icerik').classList.add('mesgul');
    }
    try {
      const c = await fetch('/portal/api/usage?gun='+gun+'&offset='+offset+
        (sadeceHata ? '&durum=hata' : ''), { headers: basliklar() });
      if (!c.ok) throw new Error('sunucu');
      const v = await c.json();
      toplam = v.toplam;
      if (v.fiyatlar) { fiyatlar = v.fiyatlar; fiyatCiz(); }
      if (!ekle) {
        metrikCiz(v);
        ekstraCiz(v.ekstra);
        $('grafikbaslik').textContent = (gun === 0 ? 'Last 30 days' : 'Last '+gun+' days') + ' — daily spend';
        cizimYap(v.gunluk);
        $('adetTum').textContent = ' ' + v.ozet.istek;
        $('adetHata').textContent = ' ' + v.ozet.basarisiz;
        const enB = Math.max(...v.modeller.map(m => m.maliyet), 0) || 1;
        $('kirilim').innerHTML = v.modeller.length
          ? '<thead><tr><th>Model</th><th>Share</th><th>Requests</th><th>Input</th><th>Output</th><th>Cost</th></tr></thead><tbody>'+
            v.modeller.map(m => {
              const yuzde = v.ozet.maliyet ? (m.maliyet / v.ozet.maliyet) * 100 : 0;
              const genislik = (m.maliyet / enB) * 100;
              const renk = RENK[saglayiciAdi(m.model)] || '#767b87';
              return '<tr><td>'+nokta(m.model)+m.model+'</td>'+
                '<td><div class="oran"><div class="oranCubuk"><i style="width:'+
                  genislik.toFixed(1)+'%;background:'+renk+'"></i></div>'+
                  '<span class="oranYuzde">%'+yuzde.toFixed(0)+'</span></div></td>'+
                '<td class="sayi">'+m.istek+'</td><td class="sayi">'+m.girdiToken+
                '</td><td class="sayi">'+m.ciktiToken+'</td>'+
                '<td class="sayi">'+para(m.maliyet)+'</td></tr>';
            }).join('')+'</tbody>' : '';

        anahtarKirilimiCiz(v);
        butceCiz(v);
      }
      if (!v.kayitlar.length && !ekle) {
        $('tablo').innerHTML = '';
        $('bos').innerHTML = '<div class="simge">◷</div><h3>'+
          (sadeceHata ? 'No failed requests' : 'No records in this period')+'</h3><p>'+
          (sadeceHata ? 'All requests succeeded in this period.' : 'Try selecting a different period.')+'</p>';
        $('bos').classList.remove('gizli');
        $('sayac').textContent = ''; $('dahafazla').classList.add('gizli');
      } else {
        $('bos').classList.add('gizli');
        satirlariCiz(v.kayitlar, ekle);
        const g = offset + v.kayitlar.length;
        $('sayac').textContent = g + ' / ' + toplam;
        $('dahafazla').classList.toggle('gizli', g >= toplam);
      }
    } catch (e) {
      $('uyari').textContent = 'Could not load usage data. Check your connection and try again.';
      $('uyari').classList.remove('gizli');
    } finally {
      $('yukleniyor').classList.add('gizli'); $('icerik').classList.remove('mesgul');
    }
  }

  async function girisYap(hazirAnahtar) {
    const saklı = typeof hazirAnahtar === 'string' ? hazirAnahtar : null;
    const d = saklı || $('anahtar').value.trim(); if (!d) return;
    $('btn').disabled = true; $('hata').classList.add('gizli');
    try {
      const c = await fetch('/portal/api/login', { method:'POST',
        headers:{ 'content-type':'application/json' }, body: JSON.stringify({ apiKey: d }) });
      const v = await c.json();
      if (!c.ok) {
        anahtarYaz(null);   // saklanan anahtar artık geçersizse temizle
        if (!saklı) {
          $('hata').textContent = v.error || 'Sign-in failed.';
          $('hata').classList.remove('gizli');
        }
        return;
      }
      anahtar = d; anahtarYaz(d);
      uygulamayaGir(v);
    } catch (e) {
      $('hata').textContent = 'Could not reach the server.'; $('hata').classList.remove('gizli');
    } finally { $('btn').disabled = false; }
  }

  // Anahtar bazında kırılım ve "senin kullanımın".
  //
  // Kişi bazında ayırmak mümkün değil: ağ geçidine gelen istekte insan yok,
  // anahtar var. Sahibi olan anahtarın harcaması o kişinin sayılıyor; ortak
  // servis anahtarları şirkete ait kalıyor.
  // Bütçe çubuğu. Sayı tek başına "ne kadar kaldı"yı hissettirmiyor;
  // dolan kısmı görmek daha hızlı okunuyor.

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

  function butceCubuk(etiket, harcama, sinir) {
    if (sinir === null || sinir === undefined) return '';
    const oran = sinir > 0 ? Math.min(100, (harcama / sinir) * 100) : 0;
    const kalan = Math.max(0, sinir - harcama);
    // %80 uyarı eşiği: dolmadan önce fark edilsin.
    const renk = oran >= 100 ? 'var(--kirmizi)' : oran >= 80 ? 'var(--sari)' : 'var(--yesil)';
    return '<div style="margin-bottom:1rem">' +
      '<div class="oran" style="justify-content:space-between;margin-bottom:.35rem">' +
      '<span class="yardim">' + etiket + '</span>' +
      '<span class="yardim">' + para(harcama) + ' of $' + sinir +
      ' · <b>' + paraKalan(kalan, sinir) + ' left</b></span></div>' +
      '<div class="oranCubuk"><i style="width:' + oran.toFixed(1) + '%;background:' + renk + '"></i></div>' +
      (oran >= 100
        ? '<div class="yardim" style="margin-top:.35rem;color:var(--kirmizi)">' +
          'Used up — requests are being rejected.</div>'
        : oran >= 80
          ? '<div class="yardim" style="margin-top:.35rem;color:var(--sari)">' +
            'Almost used up.</div>'
          : '') +
      '</div>';
  }

  function butceCiz(v) {
    const b = v.benimButce, s = v.sirketButce;
    const parca =
      (b ? butceCubuk('Your daily limit', b.gunlukHarcama, b.gunlukSinir) +
           butceCubuk('Your monthly limit', b.aylikHarcama, b.aylikSinir) : '') +
      (s ? butceCubuk('Company — today', s.gunlukHarcama, s.gunlukSinir) +
           butceCubuk('Company — this month', s.aylikHarcama, s.aylikSinir) : '');

    $('butceKart').classList.toggle('gizli', !parca);
    if (parca) $('butceSatir').innerHTML = parca;
  }

  function anahtarKirilimiCiz(v) {
    const b = v.benimOzet;
    // Anahtarla girildiyse kullanıcı kimliği yok, "senin kullanımın" da yok.
    $('benimKart').classList.toggle('gizli', !b);
    if (b) {
      const pay = v.ozet.maliyet ? (b.maliyet / v.ozet.maliyet) * 100 : 0;
      $('benimSatir').innerHTML =
        '<div class="sat"><span>Requests</span><span>' + b.istek + '</span></div>' +
        '<div class="sat"><span>Tokens</span><span>' + b.token + '</span></div>' +
        '<div class="sat toplam"><span>Your cost</span><span>' + para(b.maliyet) + '</span></div>' +
        '<div class="sat"><span>Share of company spend</span><span>%' + pay.toFixed(0) + '</span></div>';
    }

    const liste = v.anahtarKirilimi || [];
    $('anahtarSayac').textContent = liste.length + (liste.length === 1 ? ' key' : ' keys');
    const enB = Math.max(...liste.map(a => a.maliyet), 0) || 1;

    $('anahtarTablo').innerHTML = liste.length
      ? '<thead><tr><th>Key</th><th>Share</th><th>Owner</th><th>Requests</th><th>Cost</th></tr></thead><tbody>' +
        liste.map(a => {
          const genislik = (a.maliyet / enB) * 100;
          const sahip = a.benim
            ? '<span class="hap ok">you</span>'
            : a.ortak ? '<span class="hap">shared</span>' : '<span class="hap">—</span>';
          return '<tr><td>' + kacir(a.ad) +
            (a.aktif === false ? ' <span class="hap">revoked</span>' : '') + '</td>' +
            '<td><div class="oran"><div class="oranCubuk"><i style="width:' +
              genislik.toFixed(1) + '%"></i></div></div></td>' +
            '<td>' + sahip + '</td>' +
            '<td class="sayi">' + a.istek + '</td>' +
            '<td class="sayi">' + para(a.maliyet) + '</td></tr>';
        }).join('') + '</tbody>'
      : '';
  }

  // Giriş yolu ne olursa olsun uygulamaya aynı şekilde giriliyor.
  function uygulamayaGir(v) {
    hesap = v;
    document.title = v.name + ' · Usage Portal';
    $('menuMusteri').textContent = v.name;
    hesapCiz();
    $('girisEkran').classList.add('gizli');
    $('uygulama').classList.remove('gizli');
    bolumGoster('genel');
    offset = 0; kullanimGetir(false);
  }

  // E-posta ve şifreyle giriş. Oturum çerezle taşınıyor, anahtar saklanmıyor.
  async function hesapGirisi() {
    const e = $('eposta').value.trim(), s = $('sifre').value;
    if (!e || !s) return;
    $('btnHesap').disabled = true; $('hata').classList.add('gizli');
    try {
      const c = await fetch('/portal/api/session', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: e, password: s })
      });
      const v = await c.json();
      if (!c.ok) {
        $('hata').textContent = v.error || 'Sign-in failed.';
        $('hata').classList.remove('gizli');
        return;
      }
      anahtar = null; anahtarYaz(null);
      $('sifre').value = '';
      uygulamayaGir(v);
    } catch (err) {
      $('hata').textContent = 'Could not reach the server.';
      $('hata').classList.remove('gizli');
    } finally { $('btnHesap').disabled = false; }
  }

  $('girisSekme').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    [...$('girisSekme').children].forEach(x => x.classList.toggle('secili', x === b));
    $('yolHesap').classList.toggle('gizli', b.dataset.yol !== 'hesap');
    $('yolAnahtar').classList.toggle('gizli', b.dataset.yol !== 'anahtar');
    $('hata').classList.add('gizli');
  });

  $('sifreDegistir').addEventListener('click', async () => {
    const eski = $('sifreEski').value, yeni = $('sifreYeni').value;
    const not = $('sifreNot');
    not.classList.add('gizli');
    if (!eski || !yeni) return;

    $('sifreDegistir').disabled = true;
    try {
      const c = await fetch('/portal/api/password', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current: eski, next: yeni })
      });
      const v = await c.json();
      if (!c.ok) {
        not.textContent = v.error || 'Could not change the password.';
        not.classList.remove('gizli');
        return;
      }
      // Sunucu şifre değişince oturumu düşürüyor: eski çerezlerin izi artık
      // tutmuyor. Kullanıcıyı giriş ekranına alıyoruz.
      $('sifreEski').value = ''; $('sifreYeni').value = '';
      alert('Password changed. Please sign in again.');
      anahtar = null; hesap = null; anahtarYaz(null);
      $('uygulama').classList.add('gizli');
      $('girisEkran').classList.remove('gizli');
    } catch (e) {
      not.textContent = 'Could not reach the server.';
      not.classList.remove('gizli');
    } finally { $('sifreDegistir').disabled = false; }
  });

  $('btnHesap').addEventListener('click', hesapGirisi);
  $('eposta').addEventListener('keydown', e => { if (e.key === 'Enter') $('sifre').focus(); });
  $('sifre').addEventListener('keydown', e => { if (e.key === 'Enter') hesapGirisi(); });

  function ayarlarTazele() {
    // Hesap kartı yalnızca e-posta ile girildiğinde çıkıyor; anahtarla giren
    // için değiştirilecek bir şifre yok.
    const h = hesap && hesap.hesap;
    $('hesapKart').classList.toggle('gizli', !h);
    if (h) {
      $('hesapBilgi').innerHTML = 'Signed in as <b>' + kacir(h.email) + '</b>';
    }
    $('disaAktarDonem').textContent =
      gun === 0 ? 'All time' : 'Last ' + gun + ' days';
    $('disaAktarAdet').textContent = toplam ? toplam + ' requests' : '—';
  }

  // İndirme için fetch kullanılıyor, düz bağlantı değil: anahtar başlıkta
  // taşınmalı, adres çubuğunda görünmemeli.
  $('disaAktar').addEventListener('click', async () => {
    const d = $('disaAktar');
    d.disabled = true; d.textContent = 'Preparing...';
    $('disaAktarNot').classList.add('gizli');
    try {
      const c = await fetch('/portal/api/export?gun=' + gun, { headers: basliklar() });
      if (!c.ok) throw new Error('sunucu');
      const metin = await c.text();
      const bag = document.createElement('a');
      bag.href = URL.createObjectURL(new Blob([metin], { type:'text/csv;charset=utf-8' }));
      bag.download = 'kullanim-' + new Date().toISOString().slice(0,10) + '.csv';
      bag.click();
      URL.revokeObjectURL(bag.href);
      $('disaAktarNot').textContent = 'Download started.';
      $('disaAktarNot').classList.remove('gizli');
    } catch (e) {
      $('disaAktarNot').textContent = 'Could not prepare the file, please try again.';
      $('disaAktarNot').classList.remove('gizli');
    } finally {
      d.disabled = false; d.textContent = 'Download CSV';
    }
  });

  $('btn').addEventListener('click', () => girisYap());
  $('anahtar').addEventListener('keydown', e => { if (e.key === 'Enter') girisYap(); });
  $('menu').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || !b.dataset.bolum) return;
    bolumGoster(b.dataset.bolum);
  });
  $('tema').addEventListener('click', temaDegistir);
  $('temaKose').addEventListener('click', temaDegistir);

  $('cikis').addEventListener('click', async () => {
    // Çerez sunucu tarafında siliniyor; yalnızca yerelde temizlemek oturumu
    // kapatmazdı, çerez bir sonraki açılışta yine geçerli olurdu.
    try { await fetch('/portal/api/session', { method: 'DELETE' }); } catch (e) {}
    anahtar = null; hesap = null; anahtarYaz(null);
    $('anahtar').value = ''; $('sifre').value = ''; $('ozet').innerHTML = '';
    $('uygulama').classList.add('gizli'); $('girisEkran').classList.remove('gizli');
  });
  $('filtre').addEventListener('click', e => {
    const d = e.target.closest('button'); if (!d) return;
    [...$('filtre').children].forEach(b => b.classList.remove('secili'));
    d.classList.add('secili'); gun = Number(d.dataset.gun); sadeceHata = false; offset = 0;
    [...$('sekmeler').children].forEach((b,i) => b.classList.toggle('secili', i === 0));
    kullanimGetir(false);
  });
  $('sekmeler').addEventListener('click', e => {
    const d = e.target.closest('button'); if (!d) return;
    [...$('sekmeler').children].forEach(b => b.classList.remove('secili'));
    d.classList.add('secili'); sadeceHata = d.dataset.durum === 'hata'; offset = 0;
    kullanimGetir(false);
  });
  $('dahafazla').addEventListener('click', async () => {
    $('dahafazla').disabled = true; $('dahafazla').textContent = 'Loading...';
    offset += 50; await kullanimGetir(true);
    $('dahafazla').disabled = false; $('dahafazla').textContent = 'Load more';
  });
  $('yenile').addEventListener('click', async () => {
    $('yenile').disabled = true; $('yenile').textContent = 'Refreshing...';
    offset = 0;
    await hesapTazele();
    await kullanimGetir(false);
    $('yenile').disabled = false; $('yenile').textContent = 'Refresh';
  });

  // Sayfa açılışında oturum var mı diye bakılıyor.
  //
  // Önce çerez: hesapla giriş yapılmışsa sunucu kimliği zaten biliyor ve
  // hiçbir şey saklamamıza gerek yok. Yoksa eskiden saklanan anahtara
  // düşülüyor — mevcut müşteriler bir sürüm yükseltmesiyle kapıda kalmasın.
  (async () => {
    try {
      const c = await fetch('/portal/api/me');
      if (c.ok) { uygulamayaGir(await c.json()); return; }
    } catch (e) { /* sunucuya ulaşılamadıysa anahtar yoluna düş */ }

    const saklanan = anahtarOku();
    if (saklanan) girisYap(saklanan);
  })();
</script>
</body>
</html>`;

export async function portalRoutes(server: FastifyInstance) {
  server.get('/portal', async (request, reply) => {
    reply.type('text/html; charset=utf-8');
    return SAYFA;
  });

  // Anahtarı doğrular ve müşterinin kendi bilgisini döner.
  // Anahtarın kendisi geri gönderilmiyor; yalnızca ad ve izinli modeller.
  server.post('/portal/api/login', async (request, reply) => {
    const govde = request.body as { apiKey?: string } | undefined;
    const apiKey = govde?.apiKey?.trim();

    if (!apiKey) {
      return reply.status(400).send({ error: 'Key required.' });
    }

    const sonuc = await verifyClient(apiKey);

    // Hız limiti YALNIZCA başarısız denemeleri sayıyor. Sayaç doğrulamadan
    // önce çalışsaydı, aynı IP'den (örneğin aynı ofisten) yanlış anahtar
    // deneyen biri, doğru anahtarı olan kişiyi de kilitlerdi.
    //
    // Sıra security.ts ile aynı: önce kimlik, sonra hız limiti.
    if (!sonuc.success || !sonuc.client) {
      const hiz = await checkRateLimit(`portal-giris:${request.ip}`, 10, 60);
      if (!hiz.success) {
        return reply.status(429).send({
          error: 'Too many failed attempts. Try again in a minute.'
        });
      }
      return reply.status(Number(sonuc.status ?? 401)).send({
        error: 'Key not recognized.'
      });
    }

    // Anahtarın kendisi değil, hakkındaki bilgiler dönüyor.
    // Oturumla girişle aynı yapı: arayüz ikisini ayırt etmek zorunda kalmasın.
    const ozet = await musteriOzeti(String(sonuc.client.id), apiKey);
    return ozet;
  });

  // İsteği kimin yaptığını çözüyor. İki yol da kabul ediliyor:
  //
  //   1. Oturum çerezi — e-posta/şifre ile giriş yapmış kullanıcı
  //   2. Bearer anahtarı — eski yöntem
  //
  // İkisi bir süre yan yana duracak: mevcut müşteriler anahtarla giriyor ve
  // bir sürüm yükseltmesiyle kapıda kalmaları kabul edilemez. Hesaplar
  // yerleşince anahtarla giriş kaldırılacak, anahtar yalnızca ağ geçidi
  // isteklerinde kullanılacak.
  async function portalKimligi(request: {
    headers: Record<string, unknown>;
  }): Promise<{ clientId: string; kullaniciId: string | null } | null> {
    const hesap = await oturumdakiHesap(
      'musteri', request.headers.cookie as string | undefined
    );
    if (hesap?.clientId) return { clientId: hesap.clientId, kullaniciId: hesap.id };

    const baslik = request.headers.authorization as string | undefined;
    const apiKey = baslik?.startsWith('Bearer ') ? baslik.slice(7).trim() : undefined;
    if (!apiKey) return null;

    const sonuc = await verifyClient(apiKey);
    if (!sonuc.success || !sonuc.client) return null;
    // Anahtarla girişte "senin kullanımın" diye bir şey yok: anahtar kişiye
    // değil şirkete ait.
    return { clientId: String(sonuc.client.id), kullaniciId: null };
  }

  // Müşterinin görünen bilgileri. Hem anahtarla hem oturumla giriş sonrası
  // aynı yapı dönüyor ki arayüz ikisini ayırt etmek zorunda kalmasın.
  async function musteriOzeti(clientId: string, apiKey?: string, kullaniciId?: string | null) {
    const { data: musteri } = await supabase
      .from('clients')
      .select('id, name, allowed_models, allowed_domains, client_type')
      .eq('id', clientId)
      .single();
    if (!musteri) return null;

    const m = musteri as {
      id: string; name: string;
      allowed_models: string[] | null; allowed_domains: string[] | null;
      client_type: string | null;
    };

    // Portalda kişi YALNIZCA kendi anahtarlarını ve sahipsiz ortak
    // anahtarları görüyor.
    //
    // Önce şirketin bütün anahtarları listeleniyordu. Değerler maskeliydi ama
    // yine de yanlıştı: çalışan, meslektaşının anahtar adını, ortamını ve
    // durumunu görmek zorunda değil — kendi hesabına girdiğinde kendi
    // anahtarlarını bekliyor. Ortak anahtarlar listede kalıyor çünkü onların
    // harcaması şirket toplamına giriyor ve kimseye ait değiller.
    //
    // Şirketin tamamını görmek yöneticinin işi; o görünüm panelde duruyor.
    const { data: anahtarSatirlari } = await supabase
      .from('client_keys')
      .select('id, label, environment, is_active, created_at, key_prefix, user_id')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    const anahtarlar = ((anahtarSatirlari ?? []) as Array<{
      id: string; label: string | null; environment: string; is_active: boolean;
      created_at: string; key_prefix: string | null; user_id: string | null;
    }>).map((a) => ({
      id: a.id,
      ad: a.label,
      // Açık anahtar hiçbir zaman saklanmıyor; yalnızca önek var. Göçten önce
      // üretilenlerde o da yok — arayüz bunu "hidden" olarak gösteriyor.
      onEk: a.key_prefix,
      ortam: a.environment,
      aktif: a.is_active,
      olusturma: a.created_at,
      benim: !!(kullaniciId && a.user_id === kullaniciId),
      ortak: !a.user_id,
      // Anahtarla girildiyse hangi anahtarla girildiği işaretleniyor.
      buOturum: !!(apiKey && a.key_prefix && apiKey.startsWith(a.key_prefix))
    })).filter((a) => {
      // Kişi girişinde: kendi anahtarları + ortaklar.
      if (kullaniciId) return a.benim || a.ortak;
      // Anahtarla girişte kişi bilinmiyor; yalnızca o oturumun anahtarı ve
      // ortaklar gösteriliyor.
      return a.buOturum || a.ortak;
    });

    return {
      clientId: m.id,
      name: m.name,
      allowedModels: m.allowed_models ?? [],
      allowedDomains: m.allowed_domains ?? [],
      clientType: m.client_type ?? 'server-based',
      anahtarlar
    };
  }

  const URETIM = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

  // E-posta ve şifreyle giriş.
  server.post('/portal/api/session', async (request, reply) => {
    const g = request.body as { email?: string; password?: string } | undefined;
    const eposta = String(g?.email ?? '').trim();
    const sifre = String(g?.password ?? '');

    if (!eposta || !sifre) {
      return reply.status(400).send({ error: 'Email and password are required.' });
    }

    const sonuc = await girisDogrula('musteri', eposta, sifre);

    // Hız limiti yalnızca başarısız denemelerde — aynı ofisten yanlış şifre
    // deneyen biri doğru şifreyi bilen kişiyi kilitlemesin.
    if (!sonuc.ok) {
      const hiz = await checkRateLimit(`portal-oturum:${request.ip}`, 10, 60);
      if (!hiz.success) {
        return reply.status(429).send({ error: 'Too many failed attempts. Try again in a minute.' });
      }
      // Hangi kısmın yanlış olduğunu söylemiyoruz: "e-posta bulunamadı"
      // demek, hangi adreslerin kayıtlı olduğunu sızdırır.
      return reply.status(401).send({ error: 'Email or password is not correct.' });
    }

    reply.header('set-cookie', cerezYaz(CEREZ_ADI.musteri, sonuc.cerez, URETIM));
    const ozet = await musteriOzeti(sonuc.hesap.clientId!, undefined, sonuc.hesap.id);
    return { ...ozet, hesap: { id: sonuc.hesap.id, email: sonuc.hesap.email } };
  });

  server.delete('/portal/api/session', async (_request, reply) => {
    reply.header('set-cookie', cerezSil(CEREZ_ADI.musteri, URETIM));
    return { cikildi: true };
  });

  // Sayfa açıldığında oturum var mı diye bakılıyor.
  server.get('/portal/api/me', async (request, reply) => {
    const hesap = await oturumdakiHesap('musteri', request.headers.cookie);
    if (!hesap?.clientId) return reply.status(401).send({ error: 'No active session.' });

    const ozet = await musteriOzeti(hesap.clientId, undefined, hesap.id);
    if (!ozet) return reply.status(401).send({ error: 'No active session.' });
    return { ...ozet, hesap: { id: hesap.id, email: hesap.email } };
  });

  server.post('/portal/api/password', async (request, reply) => {
    const hesap = await oturumdakiHesap('musteri', request.headers.cookie);
    if (!hesap) return reply.status(401).send({ error: 'No active session.' });

    const g = request.body as { current?: string; next?: string } | undefined;
    const sonuc = await sifreDegistir(
      'musteri', hesap.id, String(g?.current ?? ''), String(g?.next ?? '')
    );
    if (!sonuc.ok) return reply.status(400).send({ error: sonuc.hata });

    // Şifre değişince eski çerezlerin izi tutmuyor; kullanıcının kendi
    // oturumu da düşüyor, bu yüzden çerezi temizliyoruz.
    reply.header('set-cookie', cerezSil(CEREZ_ADI.musteri, URETIM));
    return { degisti: true };
  });

  // Müşterinin kendi kullanım kayıtları.
  //
  // Hangi client'ın kayıtlarının döneceği, istekte gelen bir alandan değil
  // DOĞRULANMIŞ ANAHTARDAN belirleniyor. Müşteri başkasının kaydını isteyemez.
  //
  // İki ayrı sorgu var ve bu bilinçli:
  //   1. Özet ve model kırılımı SEÇİLİ DÖNEMİN TAMAMINDAN hesaplanıyor.
  //   2. Tablo satırları sayfa sayfa geliyor.
  // Tek sorgu olsaydı "daha fazla yükle" bastıkça toplam maliyet değişirdi.
  server.get('/portal/api/usage', async (request, reply) => {
    // Oturum çerezi ya da anahtar — ikisi de kabul.
    const kimlik = await portalKimligi(request as never);
    if (!kimlik) return reply.status(401).send({ error: 'Sign in to continue.' });
    const clientId = kimlik.clientId;

    const sorgu = request.query as { gun?: string; offset?: string; durum?: string };
    const sadeceHata = sorgu.durum === 'hata';
    const gun = Number(sorgu.gun ?? 30);
    const offset = Math.max(0, Number(sorgu.offset ?? 0));
    const SAYFA = 50;

    // Dönem başlangıcı. gun = 0 ise sınır yok.
    const baslangic = gun > 0
      ? new Date(Date.now() - gun * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const donemFiltresi = <T extends { gte: (k: string, v: string) => T }>(q: T): T =>
      baslangic ? q.gte('created_at', baslangic) : q;

    // 1. Dönemin tamamı — yalnızca özet için gereken kolonlar.
    const { data: tumu, error: hata1 } = await donemFiltresi(
      supabase
        .from('logs')
        .select('provider, model, status, input_tokens, output_tokens, cost, created_at, latency_ms, key_id')
        .eq('client_id', clientId)
        .limit(5000) as any
    );
    if (hata1) return reply.status(500).send({ error: 'Could not read records.' });

    const donem = (tumu ?? []) as Array<{
      provider: string; model: string; status: string; created_at: string;
      input_tokens: number | null; output_tokens: number | null;
      cost: number | null; latency_ms: number | null; key_id: string | null;
    }>;

    const ozet = donem.reduce(
      (t, k) => ({
        istek: t.istek + 1,
        basarisiz: t.basarisiz + (k.status === 'error' ? 1 : 0),
        bekleyen: t.bekleyen + (k.status === 'pending' ? 1 : 0),
        girdiToken: t.girdiToken + (k.input_tokens ?? 0),
        ciktiToken: t.ciktiToken + (k.output_tokens ?? 0),
        maliyet: t.maliyet + Number(k.cost ?? 0)
      }),
      { istek: 0, basarisiz: 0, bekleyen: 0, girdiToken: 0, ciktiToken: 0, maliyet: 0 }
    );

    // Günlük harcama serisi. Boş günler de diziye giriyor — yoksa grafik
    // yanıltıcı olur, kullanılmayan gün hiç yokmuş gibi görünür.
    // "Tümü" seçiliyse grafik, verinin gerçek başlangıcından bugüne uzanır.
    // Sabit 30 gün bırakılsaydı eski kayıtlar özete girer ama grafikte görünmezdi.
    const GRAFIK_GUN = (() => {
      if (gun > 0) return Math.min(gun, 30);
      const ilk = donem[0];
      if (!ilk) return 30;
      const enEski = donem.reduce(
        (a, k) => (String(k.created_at) < a ? String(k.created_at) : a),
        String(ilk.created_at)
      );
      const fark = Math.ceil((Date.now() - new Date(enEski).getTime()) / 86400000) + 1;
      return Math.min(Math.max(fark, 7), 90);
    })();
    type GunKaydi = { istek: number; basarisiz: number; token: number; maliyet: number };
    const bosGun = (): GunKaydi => ({ istek: 0, basarisiz: 0, token: 0, maliyet: 0 });

    const gunSayaci = new Map<string, GunKaydi>();
    for (const k of donem) {
      const g = String(k.created_at).slice(0, 10);
      const m = gunSayaci.get(g) ?? bosGun();
      m.istek += 1;
      if (k.status === 'error') m.basarisiz += 1;
      m.token += (k.input_tokens ?? 0) + (k.output_tokens ?? 0);
      m.maliyet += Number(k.cost ?? 0);
      gunSayaci.set(g, m);
    }
    const gunluk: Array<GunKaydi & { gun: string }> = [];
    for (let i = GRAFIK_GUN - 1; i >= 0; i--) {
      const g = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      gunluk.push({ gun: g, ...(gunSayaci.get(g) ?? bosGun()) });
    }

    const grup = new Map<string, { model: string; istek: number; girdiToken: number; ciktiToken: number; maliyet: number }>();
    for (const k of donem) {
      const ad = `${k.provider}/${k.model}`;
      const mevcut = grup.get(ad) ?? { model: ad, istek: 0, girdiToken: 0, ciktiToken: 0, maliyet: 0 };
      mevcut.istek += 1;
      mevcut.girdiToken += k.input_tokens ?? 0;
      mevcut.ciktiToken += k.output_tokens ?? 0;
      mevcut.maliyet += Number(k.cost ?? 0);
      grup.set(ad, mevcut);
    }
    const modeller = [...grup.values()].sort((a, b) => b.maliyet - a.maliyet);

    // Önceki dönem — aynı uzunlukta, hemen öncesi. Kıyas için.
    // OpenRouter'ın etkinlik panosunda da her metriğin yanında bu var:
    // rakam tek başına bir şey söylemiyor, "geçen döneme göre" söylüyor.
    let oncekiOzet: { istek: number; basarisiz: number; token: number; maliyet: number } | null = null;
    if (gun > 0) {
      const oncekiBas = new Date(Date.now() - 2 * gun * 24 * 60 * 60 * 1000).toISOString();
      const oncekiSon = new Date(Date.now() - gun * 24 * 60 * 60 * 1000).toISOString();
      const { data: onceki } = await supabase
        .from('logs')
        .select('status, input_tokens, output_tokens, cost, key_id')
        .eq('client_id', clientId)
        .gte('created_at', oncekiBas)
        .lt('created_at', oncekiSon)
        .limit(5000);
      const o = (onceki ?? []) as Array<{ status: string; input_tokens: number | null; output_tokens: number | null; cost: number | null }>;
      oncekiOzet = o.reduce(
        (t, k) => ({
          istek: t.istek + 1,
          basarisiz: t.basarisiz + (k.status === 'error' ? 1 : 0),
          token: t.token + (k.input_tokens ?? 0) + (k.output_tokens ?? 0),
          maliyet: t.maliyet + Number(k.cost ?? 0)
        }),
        { istek: 0, basarisiz: 0, token: 0, maliyet: 0 }
      );
    }

    // 2. Görüntülenecek sayfa. "Sadece başarısız" seçiliyse tablo filtreleniyor
    //    ama özet ve grafik dönemin tamamını göstermeye devam ediyor.
    let sayfaSorgu = supabase
      .from('logs')
      .select('provider, model, status, input_tokens, output_tokens, cost, latency_ms, created_at, error_message')
      .eq('client_id', clientId) as any;
    if (sadeceHata) sayfaSorgu = sayfaSorgu.eq('status', 'error');

    const { data: sayfa, error: hata2 } = await donemFiltresi(
      sayfaSorgu.order('created_at', { ascending: false }).range(offset, offset + SAYFA - 1)
    );
    if (hata2) return reply.status(500).send({ error: 'Could not read records.' });

    // Genel Bakış'ın ikinci sırası. Hepsi dönem verisinden hesaplanıyor,
    // ek sorgu yok.
    const basarili = donem.filter(k => k.status === 'success');
    const sureler = basarili.map(k => k.latency_ms ?? 0).filter(v => v > 0);
    const enCok = [...grup.values()].sort((a, b) => b.istek - a.istek)[0] ?? null;
    const sonKayit = donem.reduce<string | null>(
      (a, k) => (!a || String(k.created_at) > a ? String(k.created_at) : a), null);

    const ekstra = {
      ortalamaSure: sureler.length
        ? Math.round(sureler.reduce((a, v) => a + v, 0) / sureler.length) : null,
      basariOrani: ozet.istek ? (ozet.istek - ozet.basarisiz) / ozet.istek : null,
      enCokKullanilan: enCok ? { model: enCok.model, istek: enCok.istek } : null,
      sonIstek: sonKayit
    };

    // --- anahtar bazında kırılım ---
    //
    // "Kim ne harcadı" sorusunun cevabı kişi değil anahtar: ağ geçidine gelen
    // istekte insan yok. Sahibi olan anahtarlar bir kişiye bağlı, sahibi
    // olmayanlar ortak servis anahtarı ve kimsenin kendi kullanımı sayılmıyor.
    const { data: anahtarListesi } = await supabase
      .from('client_keys')
      .select('id, label, environment, is_active, user_id, key_prefix')
      .eq('client_id', clientId);

    const anahtarBilgi = new Map(
      ((anahtarListesi ?? []) as Array<{
        id: string; label: string | null; environment: string;
        is_active: boolean; user_id: string | null; key_prefix: string | null;
      }>).map((a) => [a.id, a])
    );

    const kirilimSayac = new Map<string, { istek: number; maliyet: number; token: number }>();
    for (const k of donem) {
      const anahtar = String((k as { key_id?: string | null }).key_id ?? 'atanmamis');
      const o = kirilimSayac.get(anahtar) ?? { istek: 0, maliyet: 0, token: 0 };
      o.istek += 1;
      o.maliyet += Number(k.cost ?? 0);
      o.token += (k.input_tokens ?? 0) + (k.output_tokens ?? 0);
      kirilimSayac.set(anahtar, o);
    }

    const anahtarKirilimi = [...kirilimSayac.entries()].map(([id, o]) => {
      const a = anahtarBilgi.get(id);
      return {
        keyId: id === 'atanmamis' ? null : id,
        // key_id sütunundan önceki kayıtlarda anahtar bilgisi yok.
        ad: a?.label ?? (id === 'atanmamis' ? 'Unattributed' : (a?.key_prefix ?? 'Unknown key')),
        ortam: a?.environment ?? null,
        aktif: a?.is_active ?? null,
        benim: !!(kimlik.kullaniciId && a?.user_id === kimlik.kullaniciId),
        ortak: !!a && !a.user_id,
        ...o
      };
    }).sort((x, y) => y.maliyet - x.maliyet);

    // Oturumla girildiyse "senin kullanımın" hesaplanabiliyor. Anahtarla
    // girişte kullanıcı kimliği yok, bu yüzden null dönüyor ve arayüz
    // yalnızca şirket toplamını gösteriyor.
    const benimOzet = kimlik.kullaniciId
      ? anahtarKirilimi.filter((a) => a.benim).reduce(
          (acc, a) => ({
            istek: acc.istek + a.istek,
            maliyet: acc.maliyet + a.maliyet,
            token: acc.token + a.token
          }),
          { istek: 0, maliyet: 0, token: 0 }
        )
      : null;

    // Kalan bütçe. Kişi kendi limitini görmeli — sürpriz "istekleriniz
    // durdu" mesajı almasın, dolmadan önce fark etsin.
    const { data: kisiSatir } = kimlik.kullaniciId
      ? await supabase.from('users')
          .select('monthly_budget, daily_budget')
          .eq('id', kimlik.kullaniciId).limit(1)
      : { data: null };
    const kisiLimit = (kisiSatir ?? [])[0] as
      { monthly_budget: number | null; daily_budget: number | null } | undefined;

    const { data: sirketSatir } = await supabase
      .from('clients').select('monthly_budget, daily_budget').eq('id', clientId).limit(1);
    const sirketLimit = (sirketSatir ?? [])[0] as
      { monthly_budget: number | null; daily_budget: number | null } | undefined;

    const benimButce = kimlik.kullaniciId
      ? await butceDurumu(kimlik.kullaniciId, {
          aylik: kisiLimit?.monthly_budget ?? null,
          gunluk: kisiLimit?.daily_budget ?? null
        })
      : null;

    const sirketButce = await butceDurumu(clientId, {
      aylik: sirketLimit?.monthly_budget ?? null,
      gunluk: sirketLimit?.daily_budget ?? null
    }, 'sirket');

    return {
      ozet,
      oncekiOzet,
      ekstra,
      benimOzet,
      benimButce,
      sirketButce,
      anahtarKirilimi,
      // Fiyat listesi arayüze gönderiliyor: istek detayında maliyet hesabı
      // yeniden yapılıp kayıtlı değerle karşılaştırılabilsin.
      fiyatlar: await priceList(),
      gunluk,
      modeller,
      kayitlar: sayfa ?? [],
      toplam: sadeceHata ? ozet.basarisiz : ozet.istek,
      offset
    };
  });

  // Kullanım kayıtlarını CSV olarak indirir.
  //
  // Ayraç olarak noktalı virgül kullanılıyor: Türkçe yerel ayarlı Excel
  // virgülü ondalık ayracı sayıyor, virgülle ayrılmış dosyayı tek sütuna
  // yapıştırıyor. Başa BOM ekleniyor, yoksa Türkçe karakterler bozuluyor.
  server.get('/portal/api/export', async (request, reply) => {
    // Oturum çerezi ya da anahtar — ikisi de kabul.
    const kimlik = await portalKimligi(request as never);
    if (!kimlik) return reply.status(401).send({ error: 'Sign in to continue.' });
    const clientId = kimlik.clientId;

    const gun = Number((request.query as { gun?: string }).gun ?? 30);
    const baslangic = gun > 0
      ? new Date(Date.now() - gun * 24 * 60 * 60 * 1000).toISOString()
      : null;

    let sorgu = supabase
      .from('logs')
      .select('created_at, provider, model, input_tokens, output_tokens, latency_ms, cost, status, error_message')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(10000) as any;
    if (baslangic) sorgu = sorgu.gte('created_at', baslangic);

    const { data, error } = await sorgu;
    if (error) return reply.status(500).send({ error: 'Could not read records.' });

    const alan = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    const satirlar = [
      ['tarih', 'saglayici', 'model', 'girdi_token', 'cikti_token', 'sure_ms', 'maliyet_usd', 'durum', 'hata'].join(';')
    ];
    for (const k of (data ?? []) as Array<Record<string, unknown>>) {
      satirlar.push([
        alan(k.created_at),
        alan(k.provider),
        alan(k.model),
        alan(k.input_tokens ?? 0),
        alan(k.output_tokens ?? 0),
        alan(k.latency_ms ?? 0),
        // Ondalık ayracı virgül: Türkçe Excel sayıyı böyle tanıyor.
        alan(String(Number(k.cost ?? 0).toFixed(8)).replace('.', ',')),
        alan(k.status),
        alan(k.error_message)
      ].join(';'));
    }

    const dosya = new Date().toISOString().slice(0, 10);
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="kullanim-${dosya}.csv"`);
    return '\uFEFF' + satirlar.join('\r\n');
  });
}

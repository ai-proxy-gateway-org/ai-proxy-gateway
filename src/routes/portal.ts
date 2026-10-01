// Müşteri portalı.
//
// Müşteri kendi proxy keyıyla giriş yapar ve yalnızca kendi kullanım
// kayıtlarını görür. Ayrı bir kimlik sistemi kurulmadı: key zaten
// verifyClient tarafından doğrulanabiliyor, ikinci bir giriş mekanizması
// kurmak gereksiz karmaşıklık olurdu.
//
// Sayfa HTML'i bu dosyada metin sabiti olarak duruyor. Ayrı bir .html dosyası
// okumak yerine böyle yapıldı: sunucusuz ortamda dağıtım paketine hangi
// dosyaların gireceği garanti değil, metin sabiti her zaman kodla birlikte gelir.

import type { Hono, Context } from 'hono';
import { STIL, YAZI_TIPI } from '../ui/stil.js';
import { verifyClient } from '../middleware/authMiddleware.js';
import { getBudgetStatus } from '../core/budget.js';
import {
  girisDogrula, oturumdakiHesap, sifreDegistir, CEREZ_ADI
} from '../core/kimlik.js';
import { cerezYaz, cerezSil } from '../utils/hesap.js';
import { supabase } from '../utils/supabaseClient.js';
import { hashApiKey } from '../utils/auth.js';
import { openDelivery } from '../core/keyDelivery.js';
import { checkRateLimit } from '../middleware/rateLimiter.js';
import { priceList } from '../core/modelCatalog.js';
import { govdeOku, istekIp } from '../utils/honoYardim.js';

const SAYFA = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Usage Portal</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23E6007E'/%3E%3Ctext x='16' y='22' font-family='system-ui,sans-serif' font-size='14' font-weight='700' fill='white' text-anchor='middle'%3EAP%3C/text%3E%3C/svg%3E">
${YAZI_TIPI}
<style>${STIL}
  /* Giriş yolu seçimi: hesap ya da key. Anahtar yolu geçici — hesaplar
     yerleşince kaldırılacak, o yüzden ikincil duruyor. */
  .girisSekme { display:flex; gap:.3rem; background:var(--sunk); padding:.25rem;
    border-radius:9px; margin:.6rem 0 1.1rem; }
  .girisSekme button { flex:1; padding:.45rem .6rem; font:inherit; font-size:.86rem;
    border:0; border-radius:7px; background:none; color:var(--ink-3); cursor:pointer; }
  .girisSekme button.selected { background:var(--surface); color:var(--ink); font-weight:500;
    box-shadow:0 1px 2px rgba(0,0,0,.06); }
  .alanEtiket { display:block; font-size:.85rem; color:var(--ink-3); }
  .alanEtiket input { margin-top:.35rem; }

  /* "Request a model" satırı: select hiç stillenmemişti, tarayıcı
     varsayılanıyla input/butonun yanında orantısız duruyordu. */
  .talepSatir { display:flex; gap:.5rem; flex-wrap:wrap; align-items:stretch; }
  .talepSatir select { font:inherit; font-size:.9rem; padding:.68rem .9rem;
    border:1px solid var(--line-2); border-radius:8px;
    background:var(--surface); color:var(--ink); width:auto; min-width:9rem; }
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
      <div class="smallTitle">Usage Portal</div>

      <div class="girisSekme" id="girisSekme">
        <button data-path="hesap" class="selected">Email</button>
        <button data-path="key">API key</button>
      </div>

      <div id="yolHesap">
        <label class="alanEtiket">Email
          <input id="eposta" type="email" placeholder="you@company.com" autocomplete="username">
        </label>
        <label class="alanEtiket" style="margin-top:.7rem">Password
          <input id="sifre" type="password" placeholder="••••••••••" autocomplete="current-password">
        </label>
        <button class="btn isDark " id="btnHesap" style="width:100%;margin-top:.9rem">Sign in</button>
        <div class="helpText" style="margin-top:.7rem">
          Accounts are created by your provider. Forgot your password? Ask them to reset it.
        </div>
      </div>

      <div id="yolAnahtar" class="hidden">
        <div class="helpText" style="margin:.35rem 0 .9rem">
          Sign in with the <code>sk-proxy-</code> key you were given.
        </div>
        <input id="key" type="password" placeholder="sk-proxy-..." autocomplete="off">
        <button class="btn isDark " id="btn" style="width:100%;margin-top:.7rem">Sign in</button>
        <div class="helpText" style="margin-top:.7rem">
          Signing in with a key still works, but accounts are the way forward:
          changing your key no longer locks you out.
        </div>
      </div>

      <div class="alert hidden" id="error"></div>
    </div>
  </div>
</div>

<!-- ================= UYGULAMA ================= -->
<div class="appWrap hidden" id="appWrap">

  <aside class="sidebar">
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
      <button data-section="genel" class="selected">
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
        Overview</button>
      <button data-section="requests">
        <svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
        Requests</button>
      <button data-section="price">
        <svg viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Pricing</button>
      <button data-section="key">
        <svg viewBox="0 0 24 24"><circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21l-2 2.5M17 12v3"/></svg>
        API Keys</button>
      <button data-section="settings">
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

  <div class="contentArea">
    <div class="topBar">
      <div>
        <h1 id="pageTitle">Overview</h1>
        <div class="altbilgi" id="pageSubtitle"></div>
      </div>
      <div style="display:flex;gap:.6rem;align-items:center">
        <div class="segment hidden" id="filter">
          <button data-day="7">7 days</button>
          <button data-day="30" class="selected">30 days</button>
          <button data-day="0">All time</button>
        </div>
        <button class="btn outlinedBtn" id="refresh">Refresh</button>
      </div>
    </div>

    <div class="mainBody">
      <div class="alert hidden" id="alert"></div>
      <div class="loading hidden" id="loading">Loading...</div>

      <div id="icerik">
        <!-- GENEL BAKIŞ -->
        <section data-section="genel">
          <div class="kart hidden" id="butceKart">
            <div class="smallTitle">Budget</div>
            <div class="helpText" style="margin:.3rem 0 .9rem">
              Requests stop when a limit is used up. Daily resets at midnight,
              monthly on the first.
            </div>
            <div id="butceSatir"></div>
          </div>
        </section>

        <!-- İSTEKLER -->
        <section data-section="requests" class="hidden">
          <div class="filterBar">
            <label class="filterArea">Status
              <select id="durumSuzgec">
                <option value="">All</option>
                <option value="basarili">Successful</option>
                <option value="error">Failed</option>
                <option value="bekleyen">Pending</option>
              </select>
            </label>
            <label class="filterArea">Model
              <select id="modelSuzgec"><option value="">All models</option></select>
            </label>
            <button class="suzgecDugme" id="benimSuzgec">Only mine</button>
            <button class="suzgecDugme hidden" id="suzgecSifirla">Clear</button>
            <div class="counter" id="counter" style="margin-left:auto"></div>
          </div>
          <div class="tableCard">
            <div class="scrollWrap"><table id="tablo"></table></div>
            <div class="emptyState hidden" id="bos"></div>
          </div>
          <button class="btn outlinedBtn hidden" id="dahafazla" style="width:100%;margin-top:.75rem">Load more</button>
        </section>

        <!-- PRICING -->
        <section data-section="price" class="hidden">
          <div class="rowHeader" style="margin-top:0">
            <div class="smallTitle">Model pricing</div>
            <div class="counter" id="fiyatSayac"></div>
          </div>
          <div class="filterBar">
            <label class="filterArea">Provider
              <select id="fSaglayici">
                <option value="">All providers</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google</option>
              </select>
            </label>
            <label class="filterArea">Search
              <input id="fArama" placeholder="Model name"
                style="font:inherit;font-size:.85rem;text-transform:none;letter-spacing:0;
                       padding:.35rem .6rem;border:1px solid var(--line-2);border-radius:8px;
                       background:var(--surface);color:var(--ink);min-width:12rem">
            </label>
            <button class="suzgecDugme" id="fSadeceAcik">Only what I can use</button>
          </div>
          <div class="tableCard"><div class="scrollWrap"><table id="fiyatTablo"></table></div></div>
          <div class="helpText" style="margin-top:.7rem">
            Prices are set by your system administrator and shown per 1M tokens.
          </div>

          <div class="rowHeader"><div class="smallTitle">Cost calculator</div></div>
          <div class="kart" style="max-width:44rem">
            <div class="helpText" style="margin-bottom:1.2rem">
              Estimate what a request will cost before you send it.
            </div>
            <div class="hesapForm">
              <label>Model<select id="hesapModel"></select></label>
              <label>Input tokens<input id="hesapGirdi" type="number" min="0" value="10000"></label>
              <label>Output tokens<input id="hesapCikti" type="number" min="0" value="2000"></label>
            </div>

            <dl class="propertyList" id="modelDetay" style="margin-top:1.4rem"></dl>
            <div class="hesap" id="hesapSonuc" style="margin-top:1.3rem"></div>

            <div class="helpText" style="margin-top:1rem">
              This is an estimate. To verify a real charge, open any record under
              <b>Requests</b> — the stored cost is recomputed and compared there.
            </div>
          </div>
        </section>

        <!-- AYARLAR -->
        <section data-section="settings" class="hidden">
          <div class="kart hidden" id="hesapKart" style="max-width:44rem;margin-bottom:.85rem">
            <div class="smallTitle">Your account</div>
            <div class="helpText" style="margin-top:.35rem" id="hesapBilgi"></div>

            <div class="formRow" style="margin-top:1.2rem;grid-template-columns:1fr 1fr">
              <label>Current password
                <input id="sifreEski" type="password" autocomplete="current-password"></label>
              <label>New password
                <input id="sifreYeni" type="password" autocomplete="new-password"
                       placeholder="at least 10 characters"></label>
            </div>
            <button class="btn isDark " id="sifreDegistir" style="margin-top:1.1rem">
              Change password</button>
            <div class="helpText" style="margin-top:.7rem">
              Changing your password signs you out everywhere, including sessions you forgot
              about on other devices.
            </div>
            <div class="alert hidden" id="sifreNot"></div>
          </div>

          <div class="kart" style="max-width:44rem">
            <div class="smallTitle">Key management</div>
            <div class="helpText" style="margin-top:.35rem">
              Contact your system administrator to rotate or revoke your key.
              This is not yet available from the portal.
            </div>
          </div>
        </section>

        <!-- ANAHTARIM -->
        <section data-section="key" class="hidden">
          <div class="kart" style="max-width:44rem">
            <div class="smallTitle">Key details</div>
            <dl class="propertyList" id="anahtarBilgi" style="margin-top:1rem"></dl>
          </div>
          <div class="kart hidden" id="teslimKart" style="max-width:44rem;margin-bottom:.85rem">
            <div class="smallTitle">Your new key</div>
            <div class="anahtarKutu" id="teslimSonuc" style="margin-top:.8rem"></div>
          </div>

          <div class="kart" style="max-width:44rem;margin-top:.85rem">
            <div class="smallTitle">Access permissions</div>
            <div class="helpText" style="margin-top:.3rem">
              These are set by your system administrator and cannot be changed here.
            </div>
            <dl class="propertyList" id="izinBilgi" style="margin-top:1rem"></dl>
          </div>

          <div class="kart" style="max-width:44rem;margin-top:.85rem">
            <div class="smallTitle">Request a model</div>
            <div class="helpText" style="margin-top:.3rem">
              Not on your list? Ask for it here instead of trying it blind —
              your administrator sees this in Access Requests.
            </div>
            <div class="talepSatir" style="margin-top:.8rem">
              <select id="talepSaglayici">
                <option value="openai">openai</option>
                <option value="anthropic">anthropic</option>
                <option value="gemini">gemini</option>
              </select>
              <input id="talepModel" placeholder="e.g. gpt-4o" style="width:auto;flex:1;min-width:10rem">
              <button class="btn isDark " id="talepGonder">Request access</button>
            </div>
            <div class="helpText hidden" id="talepNot" style="margin-top:.6rem"></div>
          </div>
        </section>
      </div>
    </div>
  </div>
</div>

<div class="backdrop hidden" id="backdrop"></div>
<aside class="sidePanel hidden" id="sidePanel">
  <div class="sidePanel-top">
    <div><h3 id="spTitle"></h3><div class="zaman" id="spTime"></div></div>
    <button class="kapat" id="ypKapat" aria-label="Close">&times;</button>
  </div>
  <div class="yanpanelGovde" id="spBody"></div>
</aside>

<script>
  let key = null, hesap = null, day = 30, offset = 0, toplam = 0,
      section = 'genel', sadeceBenim = false,
      durumSuzgec = '', modelSuzgec = '', fSadeceAcik = false;
  let prices = {};        // model → { input, output }, 1000 token başına
  let satirlar = [];        // ekranda duran request kayıtları

  // Anahtar tarayıcının kalıcı belleğinde ama SÜRE SINIRLI tutuluyor.
  // Süresiz saklamak istemedik: key aynı zamanda API keyı, tarayıcıda
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
  const escapeHtml = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Anahtarla girildiyse başlık ekleniyor; oturumla girildiyse çerez zaten
  // gidiyor ve key elimizde yok.
  const basliklar = () => key ? { authorization: 'Bearer ' + key } : {};

  // --- Tema: sistem tercihini izler, elle değiştirilirse hatırlar ---
  const AY = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
  const GUNES = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>';

  let themeChoice = null;

  function applyTheme(secim) {
    const kok = document.documentElement;
    if (secim) kok.setAttribute('data-tema', secim); else kok.removeAttribute('data-tema');
    const koyuMu = secim
      ? secim === 'isDark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const simge = koyuMu ? GUNES : AY;
    const yazi = koyuMu ? 'Light mode' : 'Dark mode';
    $('temaSimge').innerHTML = simge;
    $('temaYazi').textContent = yazi;
    $('temaKoseSimge').innerHTML = simge;
    $('temaKoseYazi').textContent = yazi;
  }

  function toggleTheme() {
    const kok = document.documentElement;
    const suAnKoyu = kok.getAttribute('data-tema') === 'isDark' ||
      (!kok.hasAttribute('data-tema') && matchMedia('(prefers-color-scheme: dark)').matches);
    themeChoice = suAnKoyu ? 'acik' : 'isDark';
    try { localStorage.setItem('proxy-tema', themeChoice); } catch (e) {}
    applyTheme(themeChoice);
  }

  try { themeChoice = localStorage.getItem('proxy-tema'); } catch (e) {}
  applyTheme(themeChoice);
  // Para biçimi: küçük tutarlarda anlamlı basamak kalsın, büyükte sadeleşsin.
  const money = (n) => { const v = Number(n);
    return '$' + (v === 0 ? '0.00' : v < 0.001 ? v.toFixed(6) : v < 1 ? v.toFixed(4) : v.toFixed(2)); };
  // 1 doların altındaki tutarlar iki basamağa yuvarlanırsa yanıltıcı oluyor:
  // 0.058248 → "0.06". Küçük tutarlarda anlamlı basamak korunuyor.
  const paraKisa = (n) => { const v = Number(n);
    return '$' + (v === 0 ? '0.00' : v < 0.001 ? v.toFixed(6) : v < 1 ? v.toFixed(4)
      : v < 1000 ? v.toFixed(2) : (v/1000).toFixed(1) + 'K'); };
  const thousand = (n) => Number(n).toLocaleString('en-GB');
  const date = (s) => new Date(s).toLocaleString('en-GB',
    { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  const dayDate = (s) => new Date(s).toLocaleDateString('en-GB',
    { day:'numeric', month:'long', year:'numeric' });

  const BASLIK = {
    genel:    ['Overview',   'Usage summary for the selected period'],
    usage: ['Usage',      'Breakdown by model'],
    requests: ['Requests',   'Individual request records'],
    key:  ['API Keys',   'Your key and access permissions'],
    settings:  ['Settings',   'Data export and account actions'],
    price:    ['Pricing',    'Model prices and cost calculator']
  };

  function showSection(yeni) {
    // Açığa çıkan key yalnızca gösterildiği an için ekranda kalmalı.
    // teslimAcmayiDene() bunu buradan hemen sonra kendi dolduruyor; başka
    // her geçişte (ki bu satır ondan önce çalışır) temizlenip gizleniyor —
    // aksi halde tab değişip "Anahtarım"a dönünce key hâlâ görünüyordu.
    $('teslimKart').classList.add('hidden');
    $('teslimSonuc').innerHTML = '';

    section = yeni;
    document.querySelectorAll('#menu button').forEach(b =>
      b.classList.toggle('selected', b.dataset.section === yeni));
    document.querySelectorAll('section[data-section]').forEach(s =>
      s.classList.toggle('hidden', s.dataset.section !== yeni));
    $('pageTitle').textContent = BASLIK[yeni][0];
    $('pageSubtitle').textContent = BASLIK[yeni][1];
    $('filter').classList.toggle('hidden',
      yeni === 'key' || yeni === 'settings' || yeni === 'price');
    if (yeni === 'settings') ayarlarTazele();

    // Kullanım ve request sekmelerine her girişte veri tazeleniyor. Önce
    // yalnızca girişte bir kez çekiliyordu: yeni bir request attıktan sonra
    // sekmeye dönünce eski liste duruyordu ve sayfayı elle yenilemek
    // gerekiyordu.
    if (yeni === 'requests' || yeni === 'genel') {
      offset = 0;
      kullanimGetir(false);
    }
  }

  const SAGLAYICI = { openai:'s-openai', anthropic:'s-anthropic', gemini:'s-gemini' };
  const saglayiciAdi = (m) => String(m).split('/')[0];
  const dot = (m) => '<span class="dotS ' + (SAGLAYICI[saglayiciAdi(m)] || '') + '"></span>';


  // Üç status var: success, error, pending. Önceden success dışındaki her şey
  // error sayılıyordu; pending error değil, kaydı henüz tamamlanmamış request.
  function statusBadge(k) {
    if (k.status === 'success') return '<span class="badge ok">success</span>';
    if (k.status === 'pending') return '<span class="badge pending">pending</span>';
    return '<span class="badge err">'+(k.error_message || 'error').slice(0,38)+'</span>';
  }

  function satirlariCiz(records, ekle) {
    if (ekle) satirlar = satirlar.concat(records); else satirlar = records.slice();
    const headers = ekle ? satirlar.length - records.length : 0;
    const g = records.map((k, i) =>
      '<tr class="clickable" tabindex="0" role="button" data-i="'+(headers+i)+'"><td class="sayi">'+date(k.created_at)+'</td>'+
      '<td>'+dot(k.provider)+escapeHtml(k.provider+'/'+k.model)+'</td>'+
      '<td class="sayi">'+(k.input_tokens ?? 0)+'</td>'+
      '<td class="sayi">'+(k.output_tokens ?? 0)+'</td>'+
      '<td class="sayi">'+(k.latency_ms ?? 0)+' ms</td>'+
      '<td class="sayi">'+money(k.cost ?? 0)+'</td>'+
      '<td>'+statusBadge(k)+'</td></tr>').join('');
    if (ekle) $('tablo').querySelector('tbody').insertAdjacentHTML('beforeend', g);
    else $('tablo').innerHTML = '<thead><tr><th>Time</th><th>Model</th><th>Input</th>'+
      '<th>Output</th><th>Latency</th><th>Cost</th><th>Status</th></tr></thead><tbody>'+g+'</tbody>';
  }

  function hesapCiz() {
    const liste = hesap.keys || [];

    // Anahtarın açık hali hiçbir zaman saklanmıyor — yalnızca ilk on bir
    // karakteri. Ondan öncesinde üretilenlerde o da yok; "null••••null" yerine
    // durumu açıkça yazıyoruz.
    $('anahtarBilgi').innerHTML = liste.length
      ? liste.map(a =>
          '<dt>' + (a.ad ? escapeHtml(a.ad) : '<span class="helpText">unnamed</span>') +
          (a.buOturum ? ' <span class="badge ok">this session</span>' : '') +
          (a.benim ? ' <span class="badge ok">yours</span>'
                   : a.ortak ? ' <span class="badge">shared</span>' : '') +
          '</dt><dd>' +
          '<span class="mono">' +
          (a.onEk ? escapeHtml(a.onEk) + '••••••••' : '<span class="helpText">hidden</span>') +
          '</span>' +
          ' · ' + escapeHtml(a.ortam) +
          ' · ' + (a.aktif ? '<span class="badge ok">active</span>'
                           : '<span class="badge">revoked</span>') +
          ' · ' + (a.olusturma ? dayDate(a.olusturma) : '—') +
          '</dd>').join('')
      : '<dt>Keys</dt><dd class="helpText">No keys yet.</dd>';
    $('izinBilgi').innerHTML =
      '<dt>Client type</dt><dd>' + (hesap.clientType === 'browser-based'
        ? 'Browser-based' : 'Server-based') + '</dd>' +
      '<dt>Available models</dt><dd>' + ((hesap.allowedModels || []).length
        ? hesap.allowedModels.map(m => '<span class="rozet">'+m+'</span>').join('')
        : '<span class="helpText">none defined</span>') + '</dd>' +
      '<dt>Allowed domains</dt><dd>' + ((hesap.allowedDomains || []).length
        ? hesap.allowedDomains.map(d => '<span class="rozet">'+d+'</span>').join('')
        : '<span class="helpText">no restriction</span>') + '</dd>';
  }

  // --- İstek detayı: cost yeniden hesaplanıp kayıtlı değerle karşılaştırılıyor ---
  function detayAc(k) {
    const keyName = k.provider + '/' + k.model;
    const f = prices[keyName];
    const gi = k.input_tokens ?? 0, ci = k.output_tokens ?? 0;
    const kayitli = Number(k.cost ?? 0);

    $('spTitle').innerHTML = dot(k.provider) + escapeHtml(keyName);
    $('spTime').textContent = new Date(k.created_at).toLocaleString('en-GB',
      { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit', second:'2-digit' });

    let mainBody =
      '<div class="sectionTitle">Summary</div>' +
      '<dl class="propertyList">' +
        '<dt>Status</dt><dd>' + statusBadge(k) + '</dd>' +
        '<dt>Latency</dt><dd>' + (k.latency_ms ?? 0) + ' ms</dd>' +
        '<dt>Input tokens</dt><dd>' + thousand(gi) + '</dd>' +
        '<dt>Output tokens</dt><dd>' + thousand(ci) + '</dd>' +
      '</dl>';

    // Kişi kendi isteğinin tam olarak ne sorup ne cevap aldığını görebilsin —
    // admin panelindeki aynı bölümün portal karşılığı.
    const bicimle = (t) => {
      if (t == null || t === '') return null;
      try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return t; }
    };
    const promptGosterim = bicimle(k.prompt);
    const cevapGosterim = bicimle(k.response);
    if (promptGosterim || cevapGosterim) {
      mainBody += '<div class="sectionTitle">Prompt &amp; response</div>';
      if (promptGosterim) mainBody += '<div class="helpText">Prompt</div><pre class="kodKutu">' + escapeHtml(promptGosterim) + '</pre>';
      if (cevapGosterim) mainBody += '<div class="helpText">Response</div><pre class="kodKutu">' + escapeHtml(cevapGosterim) + '</pre>';
    }

    if (k.status === 'pending') {
      mainBody += '<div class="sectionTitle">Cost</div>' +
        '<div class="dogrula pending">This request was not fully recorded. ' +
        'Token counts and cost are missing.</div>';
    } else if (!f) {
      mainBody += '<div class="sectionTitle">Cost</div>' +
        '<div class="dogrula err">⚠ No price defined for this model, ' +
        'cost cannot be computed.</div>';
    } else {
      const gm = (gi / 1000) * f.input;
      const cm = (ci / 1000) * f.output;
      const yeni = gm + cm;
      const uyusuyor = Math.abs(yeni - kayitli) < 0.0000005;

      mainBody +=
        '<div class="sectionTitle">Cost breakdown</div>' +
        '<div class="hesap">' +
          '<div class="sat"><span>input ' + thousand(gi) + ' ÷ 1000 × $' + f.input + '</span><span>' + money(gm) + '</span></div>' +
          '<div class="sat"><span>output ' + thousand(ci) + ' ÷ 1000 × $' + f.output + '</span><span>' + money(cm) + '</span></div>' +
          '<div class="cizgi"></div>' +
          '<div class="sat toplam"><span>recomputed</span><span>' + money(yeni) + '</span></div>' +
          '<div class="sat toplam"><span>stored value</span><span>' + money(kayitli) + '</span></div>' +
        '</div>' +
        (uyusuyor
          ? '<div class="dogrula ok">✓ Verified — stored value matches the current price.</div>'
          : '<div class="dogrula err">✗ Mismatch. The price may have changed after this ' +
            'record was written, or there is a calculation problem.</div>');
    }

    $('spBody').innerHTML = mainBody;
    $('backdrop').classList.remove('hidden'); $('sidePanel').classList.remove('hidden');
    requestAnimationFrame(() => {
      $('backdrop').classList.add('acik'); $('sidePanel').classList.add('acik');
    });
  }

  function detayKapat() {
    $('backdrop').classList.remove('acik'); $('sidePanel').classList.remove('acik');
    setTimeout(() => {
      $('backdrop').classList.add('hidden'); $('sidePanel').classList.add('hidden');
    }, 180);
  }

  $('backdrop').addEventListener('click', detayKapat);
  $('ypKapat').addEventListener('click', detayKapat);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') detayKapat(); });
  $('tablo').addEventListener('click', e => {
    const tr = e.target.closest('tr.clickable'); if (!tr) return;
    const k = satirlar[Number(tr.dataset.i)]; if (k) detayAc(k);
  });

  // --- Pricing: prices 1000 token başına saklanıyor, 1M üzerinden gösteriliyor ---
  const milyonBasi = (thousand) => Number(thousand) * 1000;

  function fiyatCiz() {
    const keys = Object.keys(prices).sort();
    if (!keys.length) {
      $('fiyatTablo').innerHTML = '';
      $('hesapSonuc').innerHTML = '';
      return;
    }

    const SAGLAYICI_ADI = { openai:'OpenAI', anthropic:'Anthropic', gemini:'Google' };

    const izinli = new Set((hesap && hesap.allowedModels) || []);
    const tavan = hesap ? hesap.maxOutputPrice : null;

    // Erişim üç durumlu.
    //
    // Önce yalnızca "enabled / not enabled" vardı ve yanlıştı: price tavanının
    // altındaki bir model izin listesinde olmasa da çağrılabiliyor. "not
    // enabled" yazmak kullanıcıya kapalı olduğunu söylüyordu.
    const erisim = (a) => {
      if (izinli.has(a)) return { badge: 'ok', yazi: 'yours' };
      const f = prices[a];
      if (tavan != null && f && f.output <= tavan)
        return { badge: 'ok', yazi: 'open — just use it' };
      return { badge: 'pending', yazi: 'needs approval' };
    };

    const sg = ($('fSaglayici') || {}).value || '';
    const ara = (($('fArama') || {}).value || '').trim().toLowerCase();
    const gorunen = keys.filter(a => {
      if (sg && saglayiciAdi(a) !== sg) return false;
      if (ara && !a.toLowerCase().includes(ara)) return false;
      if (fSadeceAcik && erisim(a).badge !== 'ok') return false;
      return true;
    });

    $('fiyatSayac').textContent = gorunen.length === keys.length
      ? keys.length + ' models'
      : gorunen.length + ' of ' + keys.length + ' models';

    $('fiyatTablo').innerHTML = gorunen.length
      ? '<thead><tr><th>Model</th><th>Provider</th><th>Input</th><th>Output</th><th>Access</th></tr></thead><tbody>' +
        gorunen.map(a => {
          const f = prices[a];
          const s2 = saglayiciAdi(a);
          const e = erisim(a);
          return '<tr><td>' + dot(a) + a.split('/')[1] + '</td>' +
            '<td>' + (SAGLAYICI_ADI[s2] || s2) + '</td>' +
            '<td class="sayi">$' + milyonBasi(f.input).toFixed(2) + ' / 1M</td>' +
            '<td class="sayi">$' + milyonBasi(f.output).toFixed(2) + ' / 1M</td>' +
            '<td><span class="badge ' + e.badge + '">' + e.yazi + '</span></td></tr>';
        }).join('') + '</tbody>'
      : '<tbody><tr><td style="padding:1.2rem" class="helpText">' +
        'No models match these filters.</td></tr></tbody>';

    // Hesaplayıcıda yalnızca kullanabildiği modeller — kullanamayacağı bir
    // modelin maliyetini hesaplamak yanıltıcı olur.
    const secilebilir = keys.filter(a => izinli.has(a));
    const oncekiSecim = $('hesapModel').value;
    $('hesapModel').innerHTML = (secilebilir.length ? secilebilir : keys)
      .map(a => '<option value="' + a + '">' + a + '</option>').join('');
    if (oncekiSecim && [...$('hesapModel').options].some(o => o.value === oncekiSecim)) {
      $('hesapModel').value = oncekiSecim;
    }
    hesapla();
  }

  function hesapla() {
    const a = $('hesapModel').value;
    const f = prices[a];
    if (!f) { $('hesapSonuc').innerHTML = ''; $('modelDetay').innerHTML = ''; return; }

    const SG = { openai:'OpenAI', anthropic:'Anthropic', gemini:'Google' };
    const sg = saglayiciAdi(a);
    $('modelDetay').innerHTML =
      '<dt>Provider</dt><dd>' + dot(a) + (SG[sg] || sg) + '</dd>' +
      '<dt>Model ID</dt><dd class="mono">' + a.split('/')[1] + '</dd>' +
      '<dt>Input price</dt><dd class="mono">$' + milyonBasi(f.input).toFixed(2) + ' / 1M tokens</dd>' +
      '<dt>Output price</dt><dd class="mono">$' + milyonBasi(f.output).toFixed(2) + ' / 1M tokens</dd>';

    const gi = Math.max(0, Number($('hesapGirdi').value) || 0);
    const ci = Math.max(0, Number($('hesapCikti').value) || 0);
    const gm = (gi / 1000) * f.input;
    const cm = (ci / 1000) * f.output;

    $('hesapSonuc').innerHTML =
      '<div class="sat"><span>input ' + thousand(gi) + ' ÷ 1M × $' +
        milyonBasi(f.input).toFixed(2) + '</span><span>' + money(gm) + '</span></div>' +
      '<div class="sat"><span>output ' + thousand(ci) + ' ÷ 1M × $' +
        milyonBasi(f.output).toFixed(2) + '</span><span>' + money(cm) + '</span></div>' +
      '<div class="cizgi"></div>' +
      '<div class="sat toplam"><span>estimated cost</span><span>' + money(gm + cm) + '</span></div>';
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
        body: JSON.stringify({ apiKey: key }) });
      if (!c.ok) return;
      hesap = await c.json();
      $('menuMusteri').textContent = hesap.name;
      hesapCiz();
      fiyatCiz();
    } catch (e) { /* tazeleme başarısızsa eldeki bilgiyle devam */ }
  }

  async function kullanimGetir(ekle) {
    $('alert').classList.add('hidden');
    if (!ekle) {
      if (!satirlar.length) $('loading').classList.remove('hidden');
      $('icerik').classList.add('mesgul');
    }
    try {
      const c = await fetch('/portal/api/usage?day='+day+'&offset='+offset+
        (durumSuzgec ? '&status='+durumSuzgec : '')+
        (modelSuzgec ? '&model='+encodeURIComponent(modelSuzgec) : '')+
        (sadeceBenim ? '&kapsam=benim' : ''), { headers: basliklar() });
      if (!c.ok) throw new Error('sunucu');
      const v = await c.json();
      toplam = v.toplam;
      if (v.prices) { prices = v.prices; fiyatCiz(); }
      if (!ekle) {
        modelSuzgecDoldur(v.donemModelleri);
        // Süzgeç açıksa temizleme düğmesi görünsün.
        $('suzgecSifirla').classList.toggle('hidden',
          !durumSuzgec && !modelSuzgec && !sadeceBenim);
        butceCiz(v);
      }
      if (!v.records.length && !ekle) {
        $('tablo').innerHTML = '';
        $('bos').innerHTML = '<div class="simge">◷</div><h3>'+
          (durumSuzgec || modelSuzgec || sadeceBenim
            ? 'Nothing matches these filters' : 'No records in this period')+'</h3><p>'+
          (durumSuzgec || modelSuzgec || sadeceBenim
            ? 'Clear a filter or widen the period.'
            : 'Try selecting a different period.')+'</p>';
        $('bos').classList.remove('hidden');
        $('counter').textContent = ''; $('dahafazla').classList.add('hidden');
      } else {
        $('bos').classList.add('hidden');
        satirlariCiz(v.records, ekle);
        const g = offset + v.records.length;
        $('counter').textContent = g + ' / ' + toplam;
        $('dahafazla').classList.toggle('hidden', g >= toplam);
      }
    } catch (e) {
      $('alert').textContent = 'Could not load usage data. Check your connection and try again.';
      $('alert').classList.remove('hidden');
    } finally {
      $('loading').classList.add('hidden'); $('icerik').classList.remove('mesgul');
    }
  }

  async function girisYap(hazirAnahtar) {
    const saklı = typeof hazirAnahtar === 'string' ? hazirAnahtar : null;
    const d = saklı || $('key').value.trim(); if (!d) return;
    $('btn').disabled = true; $('error').classList.add('hidden');
    try {
      const c = await fetch('/portal/api/login', { method:'POST',
        headers:{ 'content-type':'application/json' }, body: JSON.stringify({ apiKey: d }) });
      const v = await c.json();
      if (!c.ok) {
        anahtarYaz(null);   // saklanan key artık geçersizse clearBtn
        if (!saklı) {
          $('error').textContent = v.error || 'Sign-in failed.';
          $('error').classList.remove('hidden');
        }
        return;
      }
      key = d; anahtarYaz(d);
      uygulamayaGir(v);
    } catch (e) {
      $('error').textContent = 'Could not reach the server.'; $('error').classList.remove('hidden');
    } finally { $('btn').disabled = false; }
  }

  // Bütçe çubuğu. Sayı tek başına "ne kadar kaldı"yı hissettirmiyor;
  // dolan kısmı görmek daha hızlı okunuyor.

  // Kalan amount, sınırdan monthırt edilebilecek kadar hassas yazılıyor.
  //
  // money() basamak sayısını değerin kendi büyüklüğüne göre seçiyor: 4.999836
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
    const renk = oran >= 100 ? 'var(--red)' : oran >= 80 ? 'var(--sari)' : 'var(--yesil)';
    return '<div style="margin-bottom:1rem">' +
      '<div class="oran" style="justify-content:space-between;margin-bottom:.35rem">' +
      '<span class="helpText">' + etiket + '</span>' +
      '<span class="helpText">' + money(harcama) + ' of $' + sinir +
      ' · <b>' + paraKalan(kalan, sinir) + ' left</b></span></div>' +
      '<div class="oranCubuk"><i style="width:' + oran.toFixed(1) + '%;background:' + renk + '"></i></div>' +
      (oran >= 100
        ? '<div class="helpText" style="margin-top:.35rem;color:var(--red)">' +
          'Used up — requests are being rejected.</div>'
        : oran >= 80
          ? '<div class="helpText" style="margin-top:.35rem;color:var(--sari)">' +
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

    $('butceKart').classList.toggle('hidden', !parca);
    if (parca) $('butceSatir').innerHTML = parca;
  }

  // Teslim bağlantısı. Adres /portal/reveal/<token> ise key bir kez
  // gösteriliyor. Giriş yapılmadan açılamıyor; giriş sonrası kaldığı yerden
  // devam etsin diye uygulamaya girer girmez çalışıyor.
  async function teslimAcmayiDene() {
    // Düzenli ifade yerine parçalama: şablon dizesi içindeki ters bölü
    // kaçışları çıktıda eriyor ve ifadeyi bozuyor.
    const parcalar = location.pathname.split('/');
    if (parcalar[1] !== 'portal' || parcalar[2] !== 'reveal' || !parcalar[3]) return;
    const token = parcalar[3];
    try {
      const c = await fetch('/portal/api/reveal/' + encodeURIComponent(token),
        { headers: basliklar() });
      const v = await c.json();
      if (!c.ok) throw new Error(v.error || 'This link is no longer valid.');

      showSection('key');
      $('teslimKart').classList.remove('hidden');
      $('teslimSonuc').innerHTML =
        '<div class="helpText" style="margin-bottom:.5rem">' +
        'Copy it now &mdash; this link has just been used up and the key ' +
        'cannot be shown again.</div><code>' + escapeHtml(v.key) + '</code>';
    } catch (e) {
      showSection('key');
      $('teslimKart').classList.remove('hidden');
      $('teslimSonuc').innerHTML =
        '<div class="alert">' + escapeHtml(e.message) + '</div>';
    } finally {
      // Adresi temizliyoruz: yenilemede tekrar denenmesin, geçmişte kalmasın.
      history.replaceState(null, '', '/portal');
    }
  }

  // Giriş yolu ne olursa olsun uygulamaya aynı şekilde giriliyor.
  function uygulamayaGir(v) {
    hesap = v;
    document.title = v.name + ' · Usage Portal';
    $('menuMusteri').textContent = v.name;
    hesapCiz();
    $('girisEkran').classList.add('hidden');
    $('appWrap').classList.remove('hidden');
    showSection('genel');
    offset = 0; kullanimGetir(false);
    }
  // teslimAcmayiDene artik sayfa yuklendiginde cagriliyor

  // E-posta ve şifreyle giriş. Oturum çerezle taşınıyor, key saklanmıyor.
  async function hesapGirisi() {
    const e = $('eposta').value.trim(), s = $('sifre').value;
    if (!e || !s) return;
    $('btnHesap').disabled = true; $('error').classList.add('hidden');
    try {
      const c = await fetch('/portal/api/session', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: e, password: s })
      });
      const v = await c.json();
      if (!c.ok) {
        $('error').textContent = v.error || 'Sign-in failed.';
        $('error').classList.remove('hidden');
        return;
      }
      key = null; anahtarYaz(null);
      $('sifre').value = '';
      uygulamayaGir(v);
    } catch (err) {
      $('error').textContent = 'Could not reach the server.';
      $('error').classList.remove('hidden');
    } finally { $('btnHesap').disabled = false; }
  }

  $('girisSekme').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    [...$('girisSekme').children].forEach(x => x.classList.toggle('selected', x === b));
    $('yolHesap').classList.toggle('hidden', b.dataset.path !== 'hesap');
    $('yolAnahtar').classList.toggle('hidden', b.dataset.path !== 'key');
    $('error').classList.add('hidden');
  });

  $('sifreDegistir').addEventListener('click', async () => {
    const eski = $('sifreEski').value, yeni = $('sifreYeni').value;
    const not = $('sifreNot');
    not.classList.add('hidden');
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
        not.classList.remove('hidden');
        return;
      }
      // Sunucu şifre değişince oturumu düşürüyor: eski çerezlerin izi artık
      // tutmuyor. Kullanıcıyı giriş ekranına alıyoruz.
      $('sifreEski').value = ''; $('sifreYeni').value = '';
      alert('Password changed. Please sign in again.');
      key = null; hesap = null; anahtarYaz(null);
      $('appWrap').classList.add('hidden');
      $('girisEkran').classList.remove('hidden');
    } catch (e) {
      not.textContent = 'Could not reach the server.';
      not.classList.remove('hidden');
    } finally { $('sifreDegistir').disabled = false; }
  });

  $('talepGonder').addEventListener('click', async () => {
    const provider = $('talepSaglayici').value;
    const model = $('talepModel').value.trim();
    const not = $('talepNot');
    not.classList.add('hidden');
    if (!model) return;

    $('talepGonder').disabled = true;
    try {
      const c = await fetch('/portal/api/request-access', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, model })
      });
      const v = await c.json();
      not.textContent = c.ok
        ? 'Sent — your administrator will see this in Access Requests.'
        : (v.error || 'Could not send the request.');
      not.classList.remove('hidden');
      if (c.ok) $('talepModel').value = '';
    } catch {
      not.textContent = 'Could not reach the server.';
      not.classList.remove('hidden');
    } finally { $('talepGonder').disabled = false; }
  });

  $('btnHesap').addEventListener('click', hesapGirisi);
  $('eposta').addEventListener('keydown', e => { if (e.key === 'Enter') $('sifre').focus(); });
  $('sifre').addEventListener('keydown', e => { if (e.key === 'Enter') hesapGirisi(); });

  function ayarlarTazele() {
    // Hesap kartı yalnızca e-posta ile girildiğinde çıkıyor; anahtarla giren
    // için değiştirilecek bir şifre yok.
    const h = hesap && hesap.hesap;
    $('hesapKart').classList.toggle('hidden', !h);
    if (h) {
      $('hesapBilgi').innerHTML = 'Signed in as <b>' + escapeHtml(h.email) + '</b>';
    }
  }

  $('btn').addEventListener('click', () => girisYap());
  $('key').addEventListener('keydown', e => { if (e.key === 'Enter') girisYap(); });
  $('menu').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || !b.dataset.section) return;
    showSection(b.dataset.section);
  });
  $('tema').addEventListener('click', toggleTheme);
  $('temaKose').addEventListener('click', toggleTheme);

  $('cikis').addEventListener('click', async () => {
    // Çerez sunucu tarafında siliniyor; yalnızca yerelde temizlemek oturumu
    // kapatmazdı, çerez bir sonraki açılışta yine geçerli olurdu.
    try { await fetch('/portal/api/session', { method: 'DELETE' }); } catch (e) {}
    key = null; hesap = null; anahtarYaz(null);
    $('key').value = ''; $('sifre').value = ''; $('icerik').innerHTML = '';
    $('appWrap').classList.add('hidden'); $('girisEkran').classList.remove('hidden');
  });
  $('filter').addEventListener('click', e => {
    const d = e.target.closest('button'); if (!d) return;
    [...$('filter').children].forEach(b => b.classList.remove('selected'));
    d.classList.add('selected'); day = Number(d.dataset.day); offset = 0;
    kullanimGetir(false);
  });
  // Kapsam süzgeci. Varsayılan şirketin tamamı; tek düğmeyle kendi
  // isteklerine iniyorsun. İki tab olarak durduğunda liste ikiye
  // bölünmüş gibi okunuyordu — burada asıl görünüm bir tane, süzgeç isteğe
  // bağlı.
  $('benimSuzgec').addEventListener('click', () => {
    sadeceBenim = !sadeceBenim;
    $('benimSuzgec').classList.toggle('selected', sadeceBenim);
    offset = 0; kullanimGetir(false);
  });
  // Fiyat listesi süzgeçleri. Katalog 100'ü aştığı için liste tek başına
  // okunmuyor; sağlayıcı ve ad araması en çok işe yarayan ikisi.
  $('fSaglayici').addEventListener('change', fiyatCiz);
  $('fArama').addEventListener('input', fiyatCiz);
  $('fSadeceAcik').addEventListener('click', () => {
    fSadeceAcik = !fSadeceAcik;
    $('fSadeceAcik').classList.toggle('selected', fSadeceAcik);
    fiyatCiz();
  });

  $('durumSuzgec').addEventListener('change', () => {
    durumSuzgec = $('durumSuzgec').value; offset = 0; kullanimGetir(false);
  });
  $('modelSuzgec').addEventListener('change', () => {
    modelSuzgec = $('modelSuzgec').value; offset = 0; kullanimGetir(false);
  });
  $('suzgecSifirla').addEventListener('click', () => {
    durumSuzgec = ''; modelSuzgec = ''; sadeceBenim = false;
    $('durumSuzgec').value = ''; $('modelSuzgec').value = '';
    $('benimSuzgec').classList.remove('selected');
    offset = 0; kullanimGetir(false);
  });

  // Model kutusu dönemde geçen modellerle doluyor: listede olmayan bir modeli
  // seçtirmek boş sonuç vermekten başka işe yaramıyor.
  function modelSuzgecDoldur(liste) {
    const kutu = $('modelSuzgec');
    if (!liste) return;
    const selected = kutu.value;
    kutu.innerHTML = '<option value="">All models</option>' +
      liste.map(m => '<option value="' + escapeHtml(m.model) + '">' +
        escapeHtml(m.model.split('/')[1]) + ' (' + m.request + ')</option>').join('');
    if ([...kutu.options].some(o => o.value === selected)) kutu.value = selected;
  }


  $('dahafazla').addEventListener('click', async () => {
    $('dahafazla').disabled = true; $('dahafazla').textContent = 'Loading...';
    offset += 50; await kullanimGetir(true);
    $('dahafazla').disabled = false; $('dahafazla').textContent = 'Load more';
  });
  $('refresh').addEventListener('click', async () => {
    $('refresh').disabled = true; $('refresh').textContent = 'Refreshing...';
    offset = 0;
    await hesapTazele();
    await kullanimGetir(false);
    $('refresh').disabled = false; $('refresh').textContent = 'Refresh';
  });

  // Sayfa açılışında oturum var mı diye bakılıyor.
  //
  // Önce çerez: hesapla giriş yapılmışsa sunucu kimliği zaten biliyor ve
  // hiçbir şey saklamamıza gerek yok. Yoksa eskiden saklanan anahtara
  // düşülüyor — mevcut müşteriler bir sürüm yükseltmesiyle kapıda kalmasın.
  (async () => {
    // URL kontrolu - Sayfa portal/reveal ise key gosterme ekranini ac
    const parcalar = location.pathname.split('/');
    if (parcalar[1] === 'portal' && parcalar[2] === 'reveal') {
      $('girisEkran').classList.add('hidden');
      $('appWrap').classList.remove('hidden');
      teslimAcmayiDene();
      return;
    }

    try {
      const c = await fetch('/portal/api/me');
      if (c.ok) { uygulamayaGir(await c.json()); return; }
    } catch (e) { /* sunucuya ulasilamadiysa key yoluna dus */ }

    const saklanan = anahtarOku();
    if (saklanan) girisYap(saklanan);
  })();
</script>
</body>
</html>`;

export function portalRoutes(app: Hono) {
  app.get('/portal', async (c) => {
    return c.html(SAYFA);
  });

  // Teslim bağlantısı aynı sayfayı sunuyor; jetonu istemci taraf adresten
  // okuyup açıyor. Ayrı bir sayfa yazmak yerine böyle: kişi giriş yapmamışsa
  // zaten giriş ekranını görüyor, girince bağlantı kaldığı yerden işliyor.
  app.get('/portal/reveal/:token', async (c) => {
    return c.html(SAYFA);
  });

  // Anahtarı doğrular ve müşterinin kendi bilgisini döner.
  // Anahtarın kendisi geri gönderilmiyor; yalnızca ad ve izinli modeller.
  app.post('/portal/api/login', async (c) => {
    const bodyEl = await govdeOku<{ apiKey?: string }>(c);
    const apiKey = bodyEl?.apiKey?.trim();

    if (!apiKey) {
      return c.json({ error: 'Key required.' }, 400);
    }

    const sonuc = await verifyClient(apiKey);

    // Hız limiti YALNIZCA başarısız denemeleri sayıyor. Sayaç doğrulamadan
    // önce çalışsaydı, aynı IP'den (örneğin aynı ofisten) yanlış key
    // deneyen biri, doğru keyı olan kişiyi de kilitlerdi.
    //
    // Sıra security.ts ile aynı: önce kimlik, sonra hız limiti.
    if (!sonuc.success || !sonuc.client) {
      const hiz = await checkRateLimit(`portal-giris:${istekIp(c)}`, 10, 60);
      if (!hiz.success) {
        return c.json({
          error: 'Too many failed attempts. Try again in a minute.'
        }, 429);
      }
      return c.json({
        error: 'Key not recognized.'
      }, (Number(sonuc.status ?? 401)) as any);
    }

    // Anahtarın kendisi değil, hakkındaki bilgiler dönüyor.
    // Oturumla girişle aynı yapı: arayüz ikisini monthırt etmek zorunda kalmasın.
    const summary = await musteriOzeti(String(sonuc.client.id), apiKey);
    return c.json(summary);
  });

  // İsteği kimin yaptığını çözüyor. İki path da kabul ediliyor:
  //
  //   1. Oturum çerezi — e-posta/şifre ile giriş yapmış kullanıcı
  //   2. Bearer keyı — eski yöntem
  //
  // İuser bir süre yan yana duracak: mevcut müşteriler anahtarla giriyor ve
  // bir sürüm yükseltmesiyle kapıda kalmaları kabul edilemez. Hesaplar
  // yerleşince anahtarla giriş kaldırılacak, key yalnızca ağ geçidi
  // isteklerinde kullanılacak.
  async function portalKimligi(c: Context): Promise<{ clientId: string; kullaniciId: string | null } | null> {
    const hesap = await oturumdakiHesap('musteri', c.req.header('cookie'));
    if (hesap?.clientId) return { clientId: hesap.clientId, kullaniciId: hesap.id };

    const title = c.req.header('authorization');
    const apiKey = title?.startsWith('Bearer ') ? title.slice(7).trim() : undefined;
    if (!apiKey) return null;

    const sonuc = await verifyClient(apiKey);
    if (!sonuc.success || !sonuc.client) return null;
    // Anahtarla girişte "senin kullanımın" diye bir şey yok: key kişiye
    // değil şirkete ait.
    return { clientId: String(sonuc.client.id), kullaniciId: null };
  }

  // Müşterinin görünen bilgileri. Hem anahtarla hem oturumla giriş sonrası
  // aynı yapı dönüyor ki arayüz ikisini monthırt etmek zorunda kalmasın.
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

    // Portalda kişi YALNIZCA kendi keysını ve sahipsiz ortak
    // keysı görüyor.
    //
    // Önce şirketin bütün keysı listeleniyordu. Değerler maskeliydi ama
    // yine de yanlıştı: çalışan, meslektaşının key adını, ortamını ve
    // durumunu görmek zorunda değil — kendi hesabına inputğinde kendi
    // keysını bekliyor. Ortak keys listede kalıyor çünkü onların
    // harcaması şirket toplamına giriyor ve kimseye ait değiller.
    //
    // Şirketin tamamını görmek yöneticinin işi; o görünüm panelde duruyor.
    const { data: anahtarSatirlari } = await supabase
      .from('client_keys')
      .select('id, label, environment, is_active, created_at, key_prefix, user_id')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    const keys = ((anahtarSatirlari ?? []) as Array<{
      id: string; label: string | null; environment: string; is_active: boolean;
      created_at: string; key_prefix: string | null; user_id: string | null;
    }>).map((a) => ({
      id: a.id,
      ad: a.label,
      // Açık key hiçbir zaman saklanmıyor; yalnızca önek var. Göçten önce
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
      // Kişi girişinde: kendi keysı + ortaklar.
      if (kullaniciId) return a.benim || a.ortak;
      // Anahtarla girişte kişi bilinmiyor; yalnızca o oturumun keyı ve
      // ortaklar gösteriliyor.
      return a.buOturum || a.ortak;
    });

    // Kişinin kendi izin listesi ve etkin price tavanı.
    //
    // Fiyat sayfasındaki "Access" sütunu bunları kullanıyor: tavanın
    // altındaki model listede olmasa da çağrılabiliyor, "not enabled"
    // yazmak yanlış olurdu.
    let kisiIzin: string[] | null = null;
    let kisiTavan: number | null = null;
    if (kullaniciId) {
      const { data: k } = await supabase
        .from('users').select('allowed_models, max_output_price')
        .eq('id', kullaniciId).limit(1);
      const satir = (k ?? [])[0] as
        { allowed_models: string[] | null; max_output_price: number | null } | undefined;
      kisiIzin = satir?.allowed_models ?? [];
      kisiTavan = satir?.max_output_price ?? null;
    }

    const { data: sirketTavanSatir } = await supabase
      .from('clients').select('max_output_price').eq('id', clientId).limit(1);
    const sirketTavan =
      ((sirketTavanSatir ?? [])[0] as { max_output_price: number | null } | undefined)
        ?.max_output_price ?? null;

    const etkinTavan = kisiTavan !== null && sirketTavan !== null
      ? Math.min(kisiTavan, sirketTavan)
      : (kisiTavan ?? sirketTavan);

    return {
      clientId: m.id,
      name: m.name,
      allowedModels: kisiIzin ?? m.allowed_models ?? [],
      maxOutputPrice: etkinTavan,
      allowedDomains: m.allowed_domains ?? [],
      clientType: m.client_type ?? 'server-based',
      keys
    };
  }

  const URETIM = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

  // E-posta ve şifreyle giriş.
  app.post('/portal/api/session', async (c) => {
    const g = await govdeOku<{ email?: string; password?: string }>(c);
    const eposta = String(g?.email ?? '').trim();
    const sifre = String(g?.password ?? '');

    if (!eposta || !sifre) {
      return c.json({ error: 'Email and password are required.' }, 400);
    }

    const sonuc = await girisDogrula('musteri', eposta, sifre);

    // Hız limiti yalnızca başarısız denemelerde — aynı ofisten yanlış şifre
    // deneyen biri doğru şifreyi bilen kişiyi kilitlemesin.
    if (!sonuc.ok) {
      const hiz = await checkRateLimit(`portal-oturum:${istekIp(c)}`, 10, 60);
      if (!hiz.success) {
        return c.json({ error: 'Too many failed attempts. Try again in a minute.' }, 429);
      }
      // Hangi kısmın yanlış olduğunu söylemiyoruz: "e-posta bulunamadı"
      // demek, hangi adreslerin kayıtlı olduğunu sızdırır.
      return c.json({ error: 'Email or password is not correct.' }, 401);
    }

    c.header('set-cookie', cerezYaz(CEREZ_ADI.musteri, sonuc.cerez, URETIM));
    const summary = await musteriOzeti(sonuc.hesap.clientId!, undefined, sonuc.hesap.id);
    return c.json({ ...summary, hesap: { id: sonuc.hesap.id, email: sonuc.hesap.email } });
  });

  app.delete('/portal/api/session', async (c) => {
    c.header('set-cookie', cerezSil(CEREZ_ADI.musteri, URETIM));
    return c.json({ cikildi: true });
  });

  // Sayfa açıldığında oturum var mı diye bakılıyor.
  app.get('/portal/api/me', async (c) => {
    const hesap = await oturumdakiHesap('musteri', c.req.header('cookie'));
    if (!hesap?.clientId) return c.json({ error: 'No active session.' }, 401);

    const summary = await musteriOzeti(hesap.clientId, undefined, hesap.id);
    if (!summary) return c.json({ error: 'No active session.' }, 401);
    return c.json({ ...summary, hesap: { id: hesap.id, email: hesap.email } });
  });

  app.post('/portal/api/password', async (c) => {
    const hesap = await oturumdakiHesap('musteri', c.req.header('cookie'));
    if (!hesap) return c.json({ error: 'No active session.' }, 401);

    const g = await govdeOku<{ current?: string; next?: string }>(c);
    const sonuc = await sifreDegistir(
      'musteri', hesap.id, String(g?.current ?? ''), String(g?.next ?? '')
    );
    if (!sonuc.ok) return c.json({ error: sonuc.error }, 400);

    // Şifre değişince eski çerezlerin izi tutmuyor; kullanıcının kendi
    // oturumu da düşüyor, bu yüzden çerezi temizliyoruz.
    c.header('set-cookie', cerezSil(CEREZ_ADI.musteri, URETIM));
    return c.json({ degisti: true });
  });

  // Kişi, gerçek bir AI isteği atmadan doğrudan izin accessRequest edebilsin diye.
  //
  // Gerçek key gerektirmiyor — kişi zaten oturumuyla giriş yapmış, kimliği
  // belli. Ayrı bir "accessRequests" tablosu açmıyoruz: mevcut Access Requests ekranı
  // reddedilen logs satırlarını tarıyor, biz de aynı kalıba uyan bir satır
  // yazıyoruz. Admin tarafında hiçbir kod değişmiyor, accessRequest kendiliğinden
  // People > Access Requests'te beliriyor.
  app.post('/portal/api/request-access', async (c) => {
    const hesap = await oturumdakiHesap('musteri', c.req.header('cookie'));
    if (!hesap?.clientId) return c.json({ error: 'No active session.' }, 401);

    const g = await govdeOku<{ provider?: string; model?: string }>(c);
    const provider = String(g?.provider ?? '').trim();
    const model = String(g?.model ?? '').trim();
    if (!provider || !model) {
      return c.json({ error: 'Provider and model are required.' }, 400);
    }

    // Talebi kişiye bağlamak için onun bir keyı lazım; yoksa şirket
    // adına düşer (ortak key reddi ile aynı davranış).
    const { data: keys } = await supabase
      .from('client_keys').select('id').eq('user_id', hesap.id).limit(1);
    const keyId = (keys ?? [])[0]?.id ?? null;

    const now = new Date().toISOString();
    const { error } = await supabase.from('logs').insert([{
      client_id: hesap.clientId,
      key_id: keyId,
      provider, model,
      status: 'error',
      error_message: `Model '${model}' is not enabled for your account. Requested directly from the portal.`,
      created_at: now,
      completed_at: now
    }]);
    if (error) return c.json({ error: 'Could not submit the request.' }, 500);
    return c.json({ ok: true });
  });

  // Anahtar teslim bağlantısını açar.
  //
  // Yönetici keyı üretiyor ama açık değeri görmüyor; bu uç, keyı
  // sahibine bir kez gösteriyor. Oturum şart — bağlantı sızsa bile başkası
  // açamıyor.
  app.get('/portal/api/reveal/:token', async (c) => {
    const token = c.req.param('token');
    const sonuc = await openDelivery(String(token ?? ''));
    if (!sonuc.ok) return c.json({ error: sonuc.error }, sonuc.status as any);
    return c.json({ key: sonuc.key });
  });

  // Anahtar üretimi bilerek YALNIZCA yönetici panelinde.
  //
  // Portala "kendi keyını üret" düğmesi eklenmişti ve geri alındı. Gerekçe:
  // şu an bir portal hesabı ele geçirilse saldırgan keyı göremiyor, yalnızca
  // önekini görüyor — request atamıyor. Üretim düğmesi olsaydı çalınan bir şifre
  // doğrudan çalışan bir anahtara dönüşürdü. Şifrenin yeniden sorulması bunu
  // zorlaştırır ama şifre zaten çalınmışsa engellemez.
  //
  // Anahtarı kaybeden kişi yöneticiden yenisini istiyor. Küçük bir ekipte bu
  // cost, hesap ele geçirmesinin doğrudan API erişimine dönüşmesi riskinden
  // ucuz.

  // Müşterinin kendi kullanım kayıtları.
  //
  // Hangi client'ın kayıtlarının döneceği, istekte gelen bir alandan değil
  // DOĞRULANMIŞ ANAHTARDAN belirleniyor. Müşteri başkasının kaydını isteyemez.
  //
  // İki ayrı sorgu var ve bu bilinçli:
  //   1. Özet ve model kırılımı SEÇİLİ DÖNEMİN TAMAMINDAN hesaplanıyor.
  //   2. Tablo satırları sayfa sayfa geliyor.
  // Tek sorgu olsaydı "daha fazla yükle" bastıkça toplam cost değişirdi.
  app.get('/portal/api/usage', async (c) => {
    // Oturum çerezi ya da key — ikisi de kabul.
    const kimlik = await portalKimligi(c);
    if (!kimlik) return c.json({ error: 'Sign in to continue.' }, 401);
    const clientId = kimlik.clientId;

    const sorgu = c.req.query();
    // Durum süzgeci artık üç değer alıyor. Eskiden yalnızca "error" vardı;
    // başarılı ya da bekleyen istekleri monthıklamak mümkün değildi.
    const durumSuzgec = ['error', 'basarili', 'bekleyen'].includes(String(sorgu.status ?? ''))
      ? String(sorgu.status) : null;
    const durumKarsiligi: Record<string, string> = {
      error: 'error', basarili: 'success', bekleyen: 'pending'
    };
    const modelSuzgec = String(sorgu.model ?? '').trim() || null;
    const sadeceHata = durumSuzgec === 'error';
    // İstek listesi ya kişinin kendi keysıyla süzülüyor ya da şirketin
    // tamamını gösteriyor. Özet, grafik ve bütçe her iki durumda da şirket
    // ölçeğinde kalıyor — orada kıyas için şirket toplamı gerekiyor.
    const sadeceBenim = sorgu.kapsam === 'benim';
    const day = Number(sorgu.day ?? 30);
    const offset = Math.max(0, Number(sorgu.offset ?? 0));
    const SAYFA = 50;

    // Dönem başlangıcı. day = 0 ise sınır yok.
    const baslangic = day > 0
      ? new Date(Date.now() - day * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const donemFiltresi = <T extends { gte: (k: string, v: string) => T }>(q: T): T =>
      baslangic ? q.gte('created_at', baslangic) : q;

    // 1. Dönemin tamamı — yalnızca özet için gereken kolonlar.
    const { data: all, error: hata1 } = await donemFiltresi(
      supabase
        .from('logs')
        .select('provider, model, status, input_tokens, output_tokens, cost, created_at, latency_ms, key_id')
        .eq('client_id', clientId)
        .limit(5000) as any
    );
    if (hata1) return c.json({ error: 'Could not read records.' }, 500);

    const donem = (all ?? []) as Array<{
      provider: string; model: string; status: string; created_at: string;
      input_tokens: number | null; output_tokens: number | null;
      cost: number | null; latency_ms: number | null; key_id: string | null;
    }>;

    // Model kırılımı, süzgeç kutusunu doldurmak için (donemModelleri).
    // Şirket geneli kırılım tablosu ve kişisel kırılım kaldırıldı — admin
    // panelindeki analitikle birebir tekrar ediyorlardı.
    function modelKirilimi(records: typeof donem) {
      const grup = new Map<string, {
        model: string; request: number; girdiToken: number; ciktiToken: number; cost: number;
      }>();
      for (const k of records) {
        const ad = `${k.provider}/${k.model}`;
        const mevcut = grup.get(ad) ?? { model: ad, request: 0, girdiToken: 0, ciktiToken: 0, cost: 0 };
        mevcut.request += 1;
        mevcut.girdiToken += k.input_tokens ?? 0;
        mevcut.ciktiToken += k.output_tokens ?? 0;
        mevcut.cost += Number(k.cost ?? 0);
        grup.set(ad, mevcut);
      }
      return [...grup.values()].sort((a, b) => b.cost - a.cost);
    }

    const modeller = modelKirilimi(donem);

    // 2. Görüntülenecek sayfa. "Sadece başarısız" seçiliyse tablo filtreleniyor.
    let sayfaSorgu = supabase
      .from('logs')
      .select('provider, model, status, input_tokens, output_tokens, cost, latency_ms, created_at, error_message, prompt, response')
      .eq('client_id', clientId) as any;
    if (durumSuzgec) sayfaSorgu = sayfaSorgu.eq('status', durumKarsiligi[durumSuzgec]);
    if (modelSuzgec) {
      const [sag, ...kalan] = modelSuzgec.split('/');
      sayfaSorgu = sayfaSorgu.eq('provider', sag).eq('model', kalan.join('/'));
    }

    // "Sadece benim" seçiliyse kişinin sahip olduğu keysın kayıtları.
    // Anahtarı olmayan biri için boş liste doğru sonuç.
    let benimAnahtarKimlikleri: string[] = [];
    if (sadeceBenim && kimlik.kullaniciId) {
      const { data: ka } = await supabase
        .from('client_keys').select('id').eq('user_id', kimlik.kullaniciId);
      benimAnahtarKimlikleri = ((ka ?? []) as Array<{ id: string }>).map((x) => x.id);
      sayfaSorgu = benimAnahtarKimlikleri.length
        ? sayfaSorgu.in('key_id', benimAnahtarKimlikleri)
        : sayfaSorgu.eq('key_id', '00000000-0000-0000-0000-000000000000');
    }

    const { data: sayfa, error: hata2 } = await donemFiltresi(
      sayfaSorgu.order('created_at', { ascending: false }).range(offset, offset + SAYFA - 1)
    );
    if (hata2) return c.json({ error: 'Could not read records.' }, 500);

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
      ? await getBudgetStatus(kimlik.kullaniciId, {
          aylik: kisiLimit?.monthly_budget ?? null,
          gunluk: kisiLimit?.daily_budget ?? null
        })
      : null;

    const sirketButce = await getBudgetStatus(clientId, {
      aylik: sirketLimit?.monthly_budget ?? null,
      gunluk: sirketLimit?.daily_budget ?? null
    }, 'client');

    return c.json({
      benimButce,
      sirketButce,
      // Fiyat listesi arayüze gönderiliyor: request detayında cost hesabı
      // yeniden yapılıp kayıtlı değerle karşılaştırılabilsin.
      prices: await priceList(),
      records: sayfa ?? [],
      // Sayaç uygulanan süzgeçlerin hepsini yansıtıyor; dönem verisi zaten
      // elimizde, ek sorgu gerekmiyor.
      toplam: donem.filter((k) => {
        if (durumSuzgec && k.status !== durumKarsiligi[durumSuzgec]) return false;
        if (modelSuzgec && `${k.provider}/${k.model}` !== modelSuzgec) return false;
        if (sadeceBenim && !(k.key_id && benimAnahtarKimlikleri.includes(k.key_id))) return false;
        return true;
      }).length,
      // Süzgeç kutusunu doldurmak için dönemde geçen modeller.
      donemModelleri: modeller.map((m) => ({ model: m.model, request: m.request })),
      offset
    });
  });
}

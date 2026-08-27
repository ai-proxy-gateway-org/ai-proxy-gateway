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
import { verifyClient } from '../middleware/authMiddleware.js';
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
  /* Açık tema: temel tanım. Koyu tema yalnızca simgeleri değiştiriyor,
     bileşenlerin hiçbiri renk sabiti kullanmıyor. */
  :root {
    --ground:#f7f7f8; --surface:#fff; --sunk:#f2f3f5; --kenar:#fbfbfc;
    --ink:#0d0d0f; --ink-2:#3f434c; --ink-3:#767b87;
    --line:#eaebee; --line-2:#dcdee3;
    --dugme:#111214; --dugmeYazi:#fff; --dugmeHover:#2a2d33;
    --mavi:#2563eb;
    --yesil:#0f7b47; --yesil-soft:#e9f7ef;
    --kirmizi:#c0392b; --kirmizi-soft:#fdeeeb;
    --sari:#8a6100; --sari-soft:#fdf3e0;
    --golge:0 1px 2px rgba(16,18,22,.05), 0 0 0 1px rgba(16,18,22,.04);
    --satirHover:#fafafb; --menuSecili:#e9eaed;
    --menu:238px;
    color-scheme:light;
  }

  /* Sistem koyu tema — kullanıcı elle açık seçmediyse */
  @media (prefers-color-scheme: dark) {
    :root:not([data-tema="acik"]) {
      --ground:#0e0f12; --surface:#17181c; --sunk:#1e2026; --kenar:#131418;
      --ink:#e9eaee; --ink-2:#b2b6bf; --ink-3:#7f838d;
      --line:#24262c; --line-2:#33363e;
      --dugme:#e9eaee; --dugmeYazi:#0e0f12; --dugmeHover:#cbcdd4;
      --mavi:#6ea8fe;
      --yesil:#5fcf9a; --yesil-soft:#12291f;
      --kirmizi:#f08b7f; --kirmizi-soft:#2d1a17;
      --sari:#e0b464; --sari-soft:#2b2214;
      --golge:0 1px 2px rgba(0,0,0,.3), 0 0 0 1px rgba(255,255,255,.05);
      --satirHover:#1b1d22; --menuSecili:#23262d;
      color-scheme:dark;
    }
  }

  /* Elle koyu seçildiyse — sistem ne derse desin */
  :root[data-tema="koyu"] {
    --ground:#0e0f12; --surface:#17181c; --sunk:#1e2026; --kenar:#131418;
    --ink:#e9eaee; --ink-2:#b2b6bf; --ink-3:#7f838d;
    --line:#24262c; --line-2:#33363e;
    --dugme:#e9eaee; --dugmeYazi:#0e0f12; --dugmeHover:#cbcdd4;
    --mavi:#6ea8fe;
    --yesil:#5fcf9a; --yesil-soft:#12291f;
    --kirmizi:#f08b7f; --kirmizi-soft:#2d1a17;
    --sari:#e0b464; --sari-soft:#2b2214;
    --golge:0 1px 2px rgba(0,0,0,.3), 0 0 0 1px rgba(255,255,255,.05);
    --satirHover:#1b1d22; --menuSecili:#23262d;
    color-scheme:dark;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--ground); color:var(--ink);
    font-family:Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size:15.5px; line-height:1.58; -webkit-font-smoothing:antialiased;
    letter-spacing:-0.006em; }
  .mono { font-family:"JetBrains Mono", ui-monospace, monospace; font-variant-numeric:tabular-nums; }

  /* ================= GİRİŞ EKRANI ================= */
  .girisSayfa { min-height:100vh; display:flex; align-items:center; justify-content:center;
                padding:1.5rem; position:relative; }
  .temaKose { position:absolute; top:1.25rem; right:1.5rem; display:flex; align-items:center;
              gap:.45rem; background:var(--surface); border:1px solid var(--line-2);
              border-radius:8px; padding:.45rem .8rem; font:inherit; font-size:.85rem;
              color:var(--ink-2); cursor:pointer; }
  .temaKose:hover { background:var(--sunk); }
  .temaKose svg { width:15px; height:15px; stroke:currentColor; fill:none;
                  stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
  .girisKutu { width:100%; max-width:26rem; }
  .marka { display:flex; align-items:center; gap:.6rem; margin-bottom:1.5rem; }
  .markaSimge { width:30px; height:30px; border-radius:8px; background:var(--dugme);
                color:var(--dugmeYazi); display:flex; align-items:center; justify-content:center;
                font-weight:700; font-size:.85rem; }
  .markaAd { font-weight:700; font-size:1rem; letter-spacing:-.01em; }

  /* ================= UYGULAMA KABUĞU ================= */
  .uygulama { display:flex; min-height:100vh; }
  .yanmenu { width:var(--menu); flex:0 0 var(--menu); background:var(--kenar);
             border-right:1px solid var(--line); padding:1.1rem .75rem;
             display:flex; flex-direction:column; position:sticky; top:0; height:100vh; }
  .menuUst { padding:.25rem .5rem 1.1rem; }
  .menuMusteri { font-size:.78rem; color:var(--ink-3); margin-top:.15rem;
                 overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .menuBaslik { font-size:.7rem; font-weight:600; letter-spacing:.06em;
                text-transform:uppercase; color:var(--ink-3);
                padding:.5rem .6rem .35rem; }
  nav { display:flex; flex-direction:column; gap:1px; }
  nav button { display:flex; align-items:center; gap:.65rem; width:100%;
    padding:.56rem .65rem; border:0; border-radius:7px; background:none; cursor:pointer;
    font:inherit; font-size:.92rem; color:var(--ink-2); text-align:left; }
  nav button:hover { background:var(--sunk); }
  nav button.secili { background:var(--menuSecili); color:var(--ink); font-weight:600; }
  nav button:disabled { color:var(--ink-3); opacity:.55; cursor:default; }
  nav button:disabled:hover { background:none; }
  nav svg { width:16px; height:16px; flex:0 0 16px; stroke:currentColor;
            fill:none; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
  .yakinda { margin-left:auto; font-size:.66rem; color:var(--ink-3);
             border:1px solid var(--line-2); border-radius:4px; padding:.05rem .3rem; }
  .menuAlt { margin-top:auto; padding-top:.75rem; border-top:1px solid var(--line); }

  .icerikAlan { flex:1 1 auto; min-width:0; }
  .ustCubuk { background:var(--surface); border-bottom:1px solid var(--line);
              padding:1.25rem 2.5rem; display:flex; justify-content:space-between;
              align-items:center; gap:1rem; flex-wrap:wrap; position:sticky; top:0; z-index:5; }
  .ustCubuk h1 { font-size:1.3rem; font-weight:700; margin:0; letter-spacing:-.02em; }
  .ustCubuk .altbilgi { font-size:.82rem; color:var(--ink-3); margin-top:.1rem; }
  .govde { padding:2.25rem 2.5rem 5rem; max-width:78rem; }

  /* ================= ORTAK ================= */
  .dugme { font:inherit; font-size:.86rem; font-weight:500; line-height:1;
           padding:.58rem 1rem; border-radius:8px; border:1px solid transparent;
           cursor:pointer; transition:.12s; }
  .dugme:focus-visible { outline:2px solid var(--mavi); outline-offset:2px; }
  .dugme:disabled { opacity:.5; cursor:default; }
  .koyu { background:var(--dugme); color:var(--dugmeYazi); }
  .koyu:hover:not(:disabled) { background:var(--dugmeHover); }
  .cerceveli { background:var(--surface); color:var(--ink); border-color:var(--line-2); }
  .cerceveli:hover:not(:disabled) { background:var(--sunk); }

  .segment { display:inline-flex; background:var(--sunk); border-radius:8px; padding:3px; gap:2px; }
  .segment button { font:inherit; font-size:.83rem; font-weight:500; padding:.38rem .85rem;
    border:0; border-radius:6px; background:none; color:var(--ink-3); cursor:pointer; }
  .segment button.secili { background:var(--surface); color:var(--ink);
                           box-shadow:0 1px 2px rgba(0,0,0,.12); }

  .kart { background:var(--surface); border-radius:16px; padding:1.9rem 2.15rem;
          box-shadow:var(--golge); }
  .baslikkucuk { font-size:1.05rem; font-weight:700; margin:0; letter-spacing:-.01em; }
  .yardim { font-size:.88rem; color:var(--ink-3); }
  .satirbasi { display:flex; justify-content:space-between; align-items:center;
               gap:1rem; flex-wrap:wrap; margin:2.25rem 0 1rem; }
  .satirbasi:first-child { margin-top:0; }

  .metrikkart { display:grid; grid-template-columns:repeat(4,1fr); gap:.85rem; }
  @media (max-width:1180px) { .metrikkart { grid-template-columns:repeat(2,1fr); } }
  @media (max-width:520px)  { .metrikkart { grid-template-columns:1fr; } }
  .metrik { background:var(--surface); border-radius:14px; padding:1.35rem 1.5rem;
    box-shadow:var(--golge); }
  .metrik .ad { font-size:.9rem; font-weight:600; color:var(--ink); }
  .metrik .aciklama { font-size:.78rem; color:var(--ink-3); margin-top:.1rem; }
  .metrik .sayi { font-size:2.1rem; font-weight:600; margin-top:.65rem;
    letter-spacing:-.035em; line-height:1.05; font-variant-numeric:tabular-nums; }
  .metrik .fark { font-size:.8rem; color:var(--ink-3); margin-top:.65rem;
                  display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
  .etiket-degisim { display:inline-flex; align-items:center; gap:.2rem;
    font-size:.78rem; font-weight:600; padding:.16rem .5rem; border-radius:6px;
    background:var(--sunk); color:var(--ink-2);
    font-variant-numeric:tabular-nums; white-space:nowrap; }
  .etiket-degisim.kotu { background:var(--kirmizi-soft); color:var(--kirmizi); }
  .etiket-degisim.iyi  { background:var(--yesil-soft);  color:var(--yesil); }

  .grafikUst { display:flex; justify-content:space-between; align-items:baseline;
               gap:1rem; flex-wrap:wrap; margin-bottom:1.4rem; }
  .grafikbaslik { font-size:.9rem; color:var(--ink-2); }
  .grafikOkuma { font-size:.85rem; color:var(--ink-3); }
  .grafikOkuma b { color:var(--ink); font-weight:600; }
  .imlec { stroke:var(--line-2); stroke-width:1; stroke-dasharray:3 3; }
  .yakala { fill:transparent; cursor:crosshair; }
  .vurgu { fill:var(--mavi); stroke:#fff; stroke-width:2; }
  svg.cizim { display:block; width:100%; height:auto; overflow:visible; }
  .kilavuz { stroke:var(--line); stroke-width:1; }
  .taban { stroke:var(--line-2); stroke-width:1; }
  .cizgi { fill:none; stroke:var(--mavi); stroke-width:2; stroke-linejoin:round; }
  .dolgu { fill:var(--mavi); opacity:.07; }
  .eksenyazi { fill:var(--ink-3); font-size:11.5px; font-family:Inter, sans-serif; }
  .nokta { fill:var(--mavi); }

  input { width:100%; padding:.68rem .9rem; font:inherit; font-size:.9rem;
    font-family:"JetBrains Mono", ui-monospace, monospace;
    border:1px solid var(--line-2); border-radius:8px; background:var(--surface); color:var(--ink); }
  input:focus { outline:2px solid var(--mavi); outline-offset:-1px; border-color:transparent; }

  /* Sağlayıcı renkleri — süs değil, kodlama. Aynı renk grafikte,
     tabloda ve dağılımda aynı sağlayıcıyı gösteriyor. */
  .nokta-s { display:inline-block; width:8px; height:8px; border-radius:50%;
             margin-right:.5rem; vertical-align:middle; background:var(--ink-3); }
  .s-openai    { background:#10a37f; }
  .s-anthropic { background:#c96442; }
  .s-gemini    { background:#3b82f6; }

  .oran { display:flex; align-items:center; gap:.6rem; min-width:11rem; }
  .oranCubuk { flex:1 1 auto; height:6px; border-radius:3px; background:var(--sunk);
               overflow:hidden; min-width:5rem; }
  .oranCubuk i { display:block; height:100%; border-radius:3px; }
  .oranYuzde { font-family:"JetBrains Mono", ui-monospace, monospace;
               font-size:.78rem; color:var(--ink-3); width:2.6rem; text-align:right; }

  .ikincil-olculer { display:grid; grid-template-columns:repeat(4,1fr);
                     gap:.85rem; margin-top:.85rem; }
  @media (max-width:1180px) { .ikincil-olculer { grid-template-columns:repeat(2,1fr); } }
  @media (max-width:520px)  { .ikincil-olculer { grid-template-columns:1fr; } }
  .olcu { background:var(--surface); border-radius:14px; padding:1.1rem 1.35rem;
          box-shadow:var(--golge); }
  .olcu .ad { font-size:.82rem; color:var(--ink-3); }
  .olcu .deger { font-size:1.12rem; font-weight:600; margin-top:.25rem;
                 letter-spacing:-.015em; }

  .hap { display:inline-block; font-size:.75rem; font-weight:500; padding:.16rem .55rem;
         border-radius:999px; }
  .hap.ok { background:var(--yesil-soft); color:var(--yesil); }
  .hap.err { background:var(--kirmizi-soft); color:var(--kirmizi); }
  .hap.bek { background:var(--sari-soft); color:var(--sari); }
  .rozet { display:inline-block; font-family:"JetBrains Mono", ui-monospace, monospace;
    font-size:.74rem; background:var(--sunk); border-radius:6px;
    padding:.22rem .55rem; margin:.2rem .3rem .2rem 0; color:var(--ink-2); }

  .tablokart { background:var(--surface); border-radius:16px; overflow:hidden;
    box-shadow:var(--golge); }
  .kaydir { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:.89rem; min-width:38rem; }
  th, td { text-align:left; padding:.85rem 1.35rem; white-space:nowrap; }
  th { font-size:.79rem; color:var(--ink-3); font-weight:500; border-bottom:1px solid var(--line); }
  td { border-bottom:1px solid var(--line); color:var(--ink-2); }
  tbody tr:last-child td { border-bottom:0; }
  tbody tr:hover { background:var(--satirHover); }
  td.sayi { font-family:"JetBrains Mono", ui-monospace, monospace;
            font-variant-numeric:tabular-nums; color:var(--ink); }

  .sekmeler { display:flex; gap:1.6rem; }
  .sekmeler button { background:none; border:0; border-bottom:2px solid transparent;
    padding:.3rem 0 .55rem; font:inherit; font-size:.9rem; color:var(--ink-3); cursor:pointer; }
  .sekmeler button.secili { color:var(--mavi); border-bottom-color:var(--mavi); font-weight:600; }
  .sekmeler .adet { font-family:"JetBrains Mono", ui-monospace, monospace;
    font-size:.8rem; color:var(--ink-3); margin-left:.35rem; }

  .ozellik { display:grid; grid-template-columns:11rem 1fr; gap:.9rem 1rem;
             font-size:.91rem; align-items:baseline; }
  .ozellik dt { color:var(--ink-3); }
  .ozellik dd { margin:0; color:var(--ink); }

  /* Yan panel — Helicone'daki gibi sağdan açılıyor */
  .perde { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:20;
           opacity:0; transition:opacity .16s; }
  .perde.acik { opacity:1; }
  .yanpanel { position:fixed; top:0; right:0; bottom:0; width:min(30rem,100%);
              background:var(--surface); z-index:21; overflow-y:auto;
              box-shadow:-8px 0 28px rgba(0,0,0,.25);
              transform:translateX(100%); transition:transform .18s ease-out; }
  .yanpanel.acik { transform:translateX(0); }
  .yanpanelUst { display:flex; justify-content:space-between; align-items:flex-start;
                 gap:1rem; padding:1.5rem 1.75rem 1rem; border-bottom:1px solid var(--line); }
  .yanpanelUst h3 { font-size:1.05rem; font-weight:700; margin:0; letter-spacing:-.015em; }
  .yanpanelUst .zaman { font-size:.82rem; color:var(--ink-3); margin-top:.15rem; }
  .kapat { background:none; border:0; font-size:1.35rem; line-height:1; color:var(--ink-3);
           cursor:pointer; padding:.1rem .35rem; border-radius:6px; }
  .kapat:hover { background:var(--sunk); color:var(--ink); }
  .yanpanelGovde { padding:1.5rem 1.75rem 2.5rem; }
  .bolumBaslik { font-size:.75rem; font-weight:600; letter-spacing:.05em;
                 text-transform:uppercase; color:var(--ink-3); margin:1.75rem 0 .8rem; }
  .bolumBaslik:first-child { margin-top:0; }

  .hesap { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:.83rem;
           background:var(--sunk); border-radius:10px; padding:1rem 1.15rem; }
  .hesap .sat { display:flex; justify-content:space-between; gap:1rem; padding:.2rem 0; }
  .hesap .sat span:first-child { color:var(--ink-3); }
  .hesap .cizgi { border-top:1px solid var(--line-2); margin:.6rem 0; }
  .hesap .toplam { font-weight:500; }
  .dogrula { display:flex; align-items:center; gap:.55rem; margin-top:1rem;
             font-size:.87rem; padding:.7rem .9rem; border-radius:9px; }
  .dogrula.ok  { background:var(--yesil-soft); color:var(--yesil); }
  .dogrula.err { background:var(--kirmizi-soft); color:var(--kirmizi); }
  .dogrula.bek { background:var(--sari-soft); color:var(--sari); }
  tbody tr.tiklanir { cursor:pointer; }

  .hesapForm { display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; }
  @media (max-width:640px) { .hesapForm { grid-template-columns:1fr; } }
  .hesapForm label { display:flex; flex-direction:column; gap:.4rem;
                     font-size:.85rem; color:var(--ink-3); }
  .hesapForm select { padding:.6rem .8rem; font:inherit; font-size:.9rem;
    border:1px solid var(--line-2); border-radius:8px; background:var(--surface);
    color:var(--ink); }
  .hesapForm input { font-size:.9rem; }

  .gizli { display:none; }
  #icerik { transition:opacity .12s; }
  #icerik.mesgul { opacity:.45; pointer-events:none; }
  .uyari { background:var(--kirmizi-soft); color:var(--kirmizi); border-radius:8px;
           padding:.75rem 1rem; font-size:.87rem; margin:1rem 0; }
  .bosdurum { text-align:center; padding:3rem 1.5rem; }
  .bosdurum .simge { width:44px; height:44px; border-radius:12px; background:var(--sunk);
    display:inline-flex; align-items:center; justify-content:center; font-size:1.15rem; margin-bottom:.9rem; }
  .bosdurum h3 { font-size:1rem; font-weight:700; margin:0 0 .3rem; }
  .bosdurum p { color:var(--ink-3); font-size:.88rem; margin:0; }
  .yukleniyor { color:var(--ink-3); padding:2.5rem 0; font-size:.9rem; text-align:center; }
  .sayac { font-family:"JetBrains Mono", ui-monospace, monospace;
           font-size:.78rem; color:var(--ink-3); }

  @media (max-width: 820px) {
    .yanmenu { position:static; height:auto; width:100%; flex:1 1 auto;
               border-right:0; border-bottom:1px solid var(--line); }
    .uygulama { flex-direction:column; }
    nav { flex-direction:row; overflow-x:auto; }
    nav button { white-space:nowrap; }
    .yakinda, .menuAlt { display:none; }
    .ustCubuk, .govde { padding-left:1.25rem; padding-right:1.25rem; }
  }
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
      <div class="yardim" style="margin:.35rem 0 .9rem">
        Sign in with the <code>sk-proxy-</code> key you were given.
      </div>
      <input id="anahtar" type="password" placeholder="sk-proxy-..." autocomplete="off">
      <button class="dugme koyu" id="btn" style="width:100%;margin-top:.7rem">Sign in</button>
      <div class="yardim" style="margin-top:.7rem">Your session stays open for 12 hours.</div>
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
          <div class="satirbasi"><div class="baslikkucuk">By model</div></div>
          <div class="tablokart"><div class="kaydir"><table id="kirilim"></table></div></div>
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
              CSV olarak indir</button>
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
    const a = hesap.anahtar;
    $('anahtarBilgi').innerHTML =
      '<dt>Key</dt><dd class="mono">' + a.onEk + '••••••••' + a.sonEk + '</dd>' +
      '<dt>Status</dt><dd>' + (a.aktif ? '<span class="hap ok">active</span>'
                                      : '<span class="hap err">inactive</span>') + '</dd>' +
      '<dt>Environment</dt><dd>' + a.ortam + '</dd>' +
      '<dt>Created</dt><dd>' + (a.olusturma ? gunTarih(a.olusturma) : '—') + '</dd>';
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

    $('fiyatTablo').innerHTML =
      '<thead><tr><th>Model</th><th>Provider</th><th>Input</th><th>Output</th></tr></thead><tbody>' +
      anahtarlar.map(a => {
        const f = fiyatlar[a];
        const sg = saglayiciAdi(a);
        return '<tr><td>' + nokta(a) + a.split('/')[1] + '</td>' +
          '<td>' + (SAGLAYICI_ADI[sg] || sg) + '</td>' +
          '<td class="sayi">$' + milyonBasi(f.input).toFixed(2) + ' / 1M</td>' +
          '<td class="sayi">$' + milyonBasi(f.output).toFixed(2) + ' / 1M</td></tr>';
      }).join('') + '</tbody>';

    if (!$('hesapModel').options.length) {
      $('hesapModel').innerHTML = anahtarlar
        .map(a => '<option value="' + a + '">' + a + '</option>').join('');
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

  async function kullanimGetir(ekle) {
    $('uyari').classList.add('gizli');
    if (!ekle) {
      if (!$('ozet').innerHTML) $('yukleniyor').classList.remove('gizli');
      $('icerik').classList.add('mesgul');
    }
    try {
      const c = await fetch('/portal/api/usage?gun='+gun+'&offset='+offset+
        (sadeceHata ? '&durum=hata' : ''), { headers:{ authorization:'Bearer '+anahtar } });
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
      anahtar = d; hesap = v; anahtarYaz(d);
      document.title = v.name + ' · Usage Portal';
      $('menuMusteri').textContent = v.name;
      hesapCiz();
      $('girisEkran').classList.add('gizli');
      $('uygulama').classList.remove('gizli');
      bolumGoster('genel');
      offset = 0; kullanimGetir(false);
    } catch (e) {
      $('hata').textContent = 'Could not reach the server.'; $('hata').classList.remove('gizli');
    } finally { $('btn').disabled = false; }
  }

  function ayarlarTazele() {
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
      const c = await fetch('/portal/api/export?gun=' + gun,
        { headers:{ authorization:'Bearer ' + anahtar } });
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

  $('cikis').addEventListener('click', () => {
    anahtar = null; hesap = null; anahtarYaz(null);
    $('anahtar').value = ''; $('ozet').innerHTML = '';
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
    offset = 0; await kullanimGetir(false);
    $('yenile').disabled = false; $('yenile').textContent = 'Refresh';
  });

  // Sayfa yenilendiyse saklanan anahtarla sessizce gir.
  const saklanan = anahtarOku();
  if (saklanan) girisYap(saklanan);
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
    const { data: anahtarKaydi } = await supabase
      .from('client_keys')
      .select('environment, is_active, created_at')
      .eq('key_hash', hashApiKey(apiKey))
      .single();

    return {
      clientId: String(sonuc.client.id),
      name: String(sonuc.client.name),
      allowedModels: (sonuc.client.allowed_models as string[] | null) ?? [],
      allowedDomains: (sonuc.client.allowed_domains as string[] | null) ?? [],
      clientType: String(sonuc.client.client_type ?? 'server-based'),
      anahtar: {
        onEk: apiKey.slice(0, 11),
        sonEk: apiKey.slice(-4),
        ortam: anahtarKaydi?.environment ?? '—',
        aktif: anahtarKaydi?.is_active ?? true,
        olusturma: anahtarKaydi?.created_at ?? null
      }
    };
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
    const baslik = request.headers.authorization;
    const apiKey = baslik?.startsWith('Bearer ') ? baslik.slice(7).trim() : undefined;

    if (!apiKey) return reply.status(401).send({ error: 'Key required.' });

    const sonuc = await verifyClient(apiKey);
    if (!sonuc.success || !sonuc.client) {
      return reply.status(401).send({ error: 'Key not recognized.' });
    }
    const clientId = String(sonuc.client.id);

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
        .select('provider, model, status, input_tokens, output_tokens, cost, created_at, latency_ms')
        .eq('client_id', clientId)
        .limit(5000) as any
    );
    if (hata1) return reply.status(500).send({ error: 'Could not read records.' });

    const donem = (tumu ?? []) as Array<{
      provider: string; model: string; status: string; created_at: string;
      input_tokens: number | null; output_tokens: number | null;
      cost: number | null; latency_ms: number | null;
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
        .select('status, input_tokens, output_tokens, cost')
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

    return {
      ozet,
      oncekiOzet,
      ekstra,
      // Fiyat listesi arayüze gönderiliyor: istek detayında maliyet hesabı
      // yeniden yapılıp kayıtlı değerle karşılaştırılabilsin.
      fiyatlar: priceList(),
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
    const baslik = request.headers.authorization;
    const apiKey = baslik?.startsWith('Bearer ') ? baslik.slice(7).trim() : undefined;
    if (!apiKey) return reply.status(401).send({ error: 'Key required.' });

    const sonuc = await verifyClient(apiKey);
    if (!sonuc.success || !sonuc.client) {
      return reply.status(401).send({ error: 'Key not recognized.' });
    }
    const clientId = String(sonuc.client.id);

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

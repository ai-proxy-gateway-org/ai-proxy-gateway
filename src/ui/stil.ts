// Portal ve yönetici panelinin ortak tasarım dili.
//
// İkisi de aynı CSS'i kullanıyor ki görünüm ayrışmasın. Değişiklik tek yerde
// yapılıyor, iki ekran birden etkileniyor.

export const STIL = `
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
  .hap:not(.ok):not(.err):not(.bek) { background:var(--sunk); color:var(--ink-3); }
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
  /* Kişinin kendi model dağılımı için ara başlık. */
  /* Tablo başlığındaki süzgeç satırı — Excel'deki gibi sütunun altında. */
  thead tr.suzgecSatiri th { padding-top:0; padding-bottom:.55rem;
    background:var(--sunk); border-bottom:1px solid var(--line-2); }
  thead tr.suzgecSatiri select { cursor:pointer; }

  /* İstek listesinin süzgeç çubuğu. */
  .suzgecCubugu { display:flex; align-items:flex-end; gap:.9rem; flex-wrap:wrap;
    margin:0 0 .9rem; }
  .suzgecAlan { display:flex; flex-direction:column; gap:.25rem;
    font-size:.75rem; text-transform:uppercase; letter-spacing:.04em; color:var(--ink-3); }
  .suzgecAlan select { font:inherit; font-size:.85rem; text-transform:none;
    letter-spacing:0; padding:.35rem .6rem; border:1px solid var(--line-2);
    border-radius:8px; background:var(--surface); color:var(--ink); }

  /* Liste üstündeki isteğe bağlı süzgeç düğmesi. */
  .suzgecDugme { font:inherit; font-size:.82rem; padding:.35rem .8rem; cursor:pointer;
    border:1px solid var(--line-2); border-radius:999px; background:transparent;
    color:var(--ink-3); }
  .suzgecDugme:hover { border-color:var(--mavi); color:var(--ink); }
  .suzgecDugme.secili { border-color:var(--mavi); color:var(--mavi);
    background:color-mix(in srgb, var(--mavi) 12%, transparent); }

  .hesap .altBaslik { font-size:.72rem; text-transform:uppercase; letter-spacing:.05em;
    color:var(--ink-3); margin:.9rem 0 .4rem; }
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
`;

export const YAZI_TIPI = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">`;

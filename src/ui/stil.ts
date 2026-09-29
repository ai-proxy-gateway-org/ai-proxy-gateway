// Portal ve yönetici panelinin ortak tasarım dili.
//
// İkisi de aynı CSS'i kullanıyor ki görünüm ayrışmasın. Değişiklik tek yerde
// yapılıyor, iki ekran birden etkileniyor.
//
// Renk paleti: iceberg.digital — Deep Navy / Steel Blue / Ice White

export const STIL = `
  /* ========= ICEBERG DIGITAL PALETTE =========
     Primary:  #074683 (Deep Water Navy)
     Accent:   #1B5E98 (Matisse Blue)
     Hover:    #4484B4 (Steel Blue)
     Highlight:#71A6D2 (Iceberg Light Blue)
     Surface:  #F4F7FA (Ice White)
     ============================================ */

  :root {
    --ground:#F0F3F7; --surface:#fff; --sunk:#E8ECF2; --kenar:#F4F7FA;
    --ink:#0B1929; --ink-2:#3A4A5C; --ink-3:#6B7B8D;
    --line:#E0E6ED; --line-2:#CDD5DF;
    --dugme:#074683; --dugmeYazi:#fff; --dugmeHover:#1B5E98;
    --mavi:#1B5E98;
    --yesil:#0C7C59; --yesil-soft:#E6F5EE;
    --kirmizi:#C0392B; --kirmizi-soft:#FDEEEB;
    --sari:#8A6D00; --sari-soft:#FDF3E0;
    --golge:0 1px 3px rgba(7,70,131,.06), 0 0 0 1px rgba(7,70,131,.04);
    --satirHover:#F6F9FC; --menuSecili:#DDE8F3;
    --accent:#4484B4; --accent-soft:#E3EEF7;
    --menu:248px;
    color-scheme:light;
  }

  /* Sistem koyu tema — kullanıcı elle açık seçmediyse */
  @media (prefers-color-scheme: dark) {
    :root:not([data-tema="acik"]) {
      --ground:#0A0F18; --surface:#111827; --sunk:#1A2332; --kenar:#0D1420;
      --ink:#E2E8F0; --ink-2:#94A3B8; --ink-3:#64748B;
      --line:#1E293B; --line-2:#334155;
      --dugme:#71A6D2; --dugmeYazi:#0A0F18; --dugmeHover:#4484B4;
      --mavi:#71A6D2;
      --yesil:#6EE7B7; --yesil-soft:#132A1F;
      --kirmizi:#FCA5A5; --kirmizi-soft:#2D1B1B;
      --sari:#FCD34D; --sari-soft:#2B2314;
      --golge:0 1px 3px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.04);
      --satirHover:#151D2C; --menuSecili:#1E2D40;
      --accent:#4484B4; --accent-soft:#172336;
      color-scheme:dark;
    }
  }

  /* Elle koyu seçildiyse — sistem ne derse desin */
  :root[data-tema="koyu"] {
    --ground:#0A0F18; --surface:#111827; --sunk:#1A2332; --kenar:#0D1420;
    --ink:#E2E8F0; --ink-2:#94A3B8; --ink-3:#64748B;
    --line:#1E293B; --line-2:#334155;
    --dugme:#71A6D2; --dugmeYazi:#0A0F18; --dugmeHover:#4484B4;
    --mavi:#71A6D2;
    --yesil:#6EE7B7; --yesil-soft:#132A1F;
    --kirmizi:#FCA5A5; --kirmizi-soft:#2D1B1B;
    --sari:#FCD34D; --sari-soft:#2B2314;
    --golge:0 1px 3px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.04);
    --satirHover:#151D2C; --menuSecili:#1E2D40;
    --accent:#4484B4; --accent-soft:#172336;
    color-scheme:dark;
  }

  * { box-sizing:border-box; }
  body { margin:0; background:var(--ground); color:var(--ink);
    font-family:'Inter', ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size:15px; line-height:1.6; -webkit-font-smoothing:antialiased;
    letter-spacing:-0.01em; }
  .mono { font-family:"JetBrains Mono", ui-monospace, monospace; font-variant-numeric:tabular-nums; }

  /* ================= GİRİŞ EKRANI ================= */
  .girisSayfa { min-height:100vh; display:flex; align-items:center; justify-content:center;
                padding:1.5rem; position:relative;
                background:linear-gradient(135deg, #074683 0%, #1B5E98 40%, #4484B4 100%); }
  .temaKose { position:absolute; top:1.25rem; right:1.5rem; display:flex; align-items:center;
              gap:.45rem; background:rgba(255,255,255,.15); backdrop-filter:blur(12px);
              border:1px solid rgba(255,255,255,.2);
              border-radius:10px; padding:.45rem .8rem; font:inherit; font-size:.85rem;
              color:rgba(255,255,255,.85); cursor:pointer; }
  .temaKose:hover { background:rgba(255,255,255,.25); }
  .temaKose svg { width:15px; height:15px; stroke:currentColor; fill:none;
                  stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
  .girisKutu { width:100%; max-width:26rem; background:var(--surface);
               border-radius:20px; padding:2.5rem 2.2rem;
               box-shadow:0 20px 60px rgba(7,70,131,.2), 0 0 0 1px rgba(7,70,131,.05); }
  .marka { display:flex; align-items:center; gap:.7rem; margin-bottom:1.8rem; }
  .markaSimge { width:34px; height:34px; border-radius:10px; background:var(--dugme);
                color:var(--dugmeYazi); display:flex; align-items:center; justify-content:center;
                font-weight:700; font-size:.85rem;
                box-shadow:0 2px 8px rgba(7,70,131,.3); }
  .markaAd { font-weight:700; font-size:1.05rem; letter-spacing:-.015em; color:var(--ink); }

  /* ================= UYGULAMA KABUĞU ================= */
  .uygulama { display:flex; min-height:100vh; }
  .yanmenu { width:var(--menu); flex:0 0 var(--menu); background:var(--kenar);
             border-right:1px solid var(--line); padding:1.2rem .85rem;
             display:flex; flex-direction:column; position:sticky; top:0; height:100vh; }
  .menuUst { padding:.25rem .55rem 1.2rem; }
  .menuMusteri { font-size:.78rem; color:var(--ink-3); margin-top:.15rem;
                 overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .menuBaslik { font-size:.68rem; font-weight:600; letter-spacing:.07em;
                text-transform:uppercase; color:var(--accent);
                padding:.6rem .65rem .35rem; }
  nav { display:flex; flex-direction:column; gap:2px; }
  nav button { display:flex; align-items:center; gap:.7rem; width:100%;
    padding:.6rem .7rem; border:0; border-radius:9px; background:none; cursor:pointer;
    font:inherit; font-size:.9rem; color:var(--ink-2); text-align:left;
    transition:all .12s; }
  nav button:hover { background:var(--sunk); color:var(--ink); }
  nav button.secili { background:var(--menuSecili); color:var(--dugme); font-weight:600; }
  nav button:disabled { color:var(--ink-3); opacity:.55; cursor:default; }
  nav button:disabled:hover { background:none; }
  nav svg { width:17px; height:17px; flex:0 0 17px; stroke:currentColor;
            fill:none; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
  .yakinda { margin-left:auto; font-size:.64rem; color:var(--accent);
             border:1px solid var(--accent); border-radius:5px; padding:.1rem .35rem;
             opacity:.6; }
  .menuAlt { margin-top:auto; padding-top:.75rem; border-top:1px solid var(--line); }

  .icerikAlan { flex:1 1 auto; min-width:0; }
  .ustCubuk { background:var(--surface); border-bottom:1px solid var(--line);
              padding:1.3rem 2.5rem; display:flex; justify-content:space-between;
              align-items:center; gap:1rem; flex-wrap:wrap; position:sticky; top:0; z-index:5; }
  .ustCubuk h1 { font-size:1.35rem; font-weight:700; margin:0; letter-spacing:-.025em;
                 color:var(--ink); }
  .ustCubuk .altbilgi { font-size:.82rem; color:var(--ink-3); margin-top:.1rem; }
  .govde { padding:2.25rem 2.5rem 5rem; max-width:78rem; }

  /* ================= ORTAK ================= */
  .dugme { font:inherit; font-size:.86rem; font-weight:500; line-height:1;
           padding:.6rem 1.1rem; border-radius:10px; border:1px solid transparent;
           cursor:pointer; transition:all .15s ease; }
  .dugme:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .dugme:disabled { opacity:.5; cursor:default; }
  .koyu { background:var(--dugme); color:var(--dugmeYazi);
          box-shadow:0 1px 3px rgba(7,70,131,.2); }
  .koyu:hover:not(:disabled) { background:var(--dugmeHover);
    box-shadow:0 2px 8px rgba(7,70,131,.25); transform:translateY(-1px); }
  .cerceveli { background:var(--surface); color:var(--ink); border-color:var(--line-2); }
  .cerceveli:hover:not(:disabled) { background:var(--sunk); border-color:var(--accent); }

  .segment { display:inline-flex; background:var(--sunk); border-radius:10px; padding:3px; gap:2px; }
  .segment button { font:inherit; font-size:.83rem; font-weight:500; padding:.4rem .9rem;
    border:0; border-radius:8px; background:none; color:var(--ink-3); cursor:pointer;
    transition:all .12s; }
  .segment button.secili { background:var(--surface); color:var(--dugme);
                           box-shadow:0 1px 3px rgba(0,0,0,.08); }

  .kart { background:var(--surface); border-radius:16px; padding:1.9rem 2.15rem;
          box-shadow:var(--golge); }
  .baslikkucuk { font-size:1.05rem; font-weight:700; margin:0; letter-spacing:-.015em; }
  .yardim { font-size:.88rem; color:var(--ink-3); }
  .satirbasi { display:flex; justify-content:space-between; align-items:center;
               gap:1rem; flex-wrap:wrap; margin:2.25rem 0 1rem; }
  .satirbasi:first-child { margin-top:0; }

  .metrikkart { display:grid; grid-template-columns:repeat(4,1fr); gap:1rem; }
  @media (max-width:1180px) { .metrikkart { grid-template-columns:repeat(2,1fr); } }
  @media (max-width:520px)  { .metrikkart { grid-template-columns:1fr; } }
  .metrik { background:var(--surface); border-radius:16px; padding:1.4rem 1.6rem;
    box-shadow:var(--golge); transition:box-shadow .15s, transform .15s; }
  .metrik:hover { box-shadow:0 4px 16px rgba(7,70,131,.08);
                  transform:translateY(-1px); }
  .metrik .ad { font-size:.88rem; font-weight:600; color:var(--ink-2); }
  .metrik .aciklama { font-size:.77rem; color:var(--ink-3); margin-top:.1rem; }
  .metrik .sayi { font-size:2.1rem; font-weight:700; margin-top:.7rem;
    letter-spacing:-.04em; line-height:1.05; font-variant-numeric:tabular-nums;
    color:var(--dugme); }
  .metrik .sayi.uyari { color:var(--sari); }
  .metrik .sayi.tehlike { color:var(--kirmizi); }

  .kartUyari { border:1px solid color-mix(in srgb, var(--sari) 35%, var(--line-2));
    background:color-mix(in srgb, var(--sari-soft) 55%, var(--surface)); }
  .metrik .fark { font-size:.8rem; color:var(--ink-3); margin-top:.65rem;
                  display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
  .etiket-degisim { display:inline-flex; align-items:center; gap:.2rem;
    font-size:.78rem; font-weight:600; padding:.18rem .55rem; border-radius:8px;
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
  .vurgu { fill:var(--dugme); stroke:#fff; stroke-width:2; }
  svg.cizim { display:block; width:100%; height:auto; overflow:visible; }
  .kilavuz { stroke:var(--line); stroke-width:1; }
  .taban { stroke:var(--line-2); stroke-width:1; }
  .cizgi { fill:none; stroke:var(--dugme); stroke-width:2; stroke-linejoin:round; }
  .dolgu { fill:var(--dugme); opacity:.06; }
  .eksenyazi { fill:var(--ink-3); font-size:11.5px; font-family:Inter, sans-serif; }
  .nokta { fill:var(--dugme); }

  input { width:100%; padding:.68rem .9rem; font:inherit; font-size:.9rem;
    font-family:"JetBrains Mono", ui-monospace, monospace;
    border:1px solid var(--line-2); border-radius:10px; background:var(--surface); color:var(--ink);
    transition:border-color .15s, box-shadow .15s; }
  input:focus { outline:none; border-color:var(--accent);
    box-shadow:0 0 0 3px rgba(68,132,180,.15); }

  /* Sağlayıcı renkleri — süs değil, kodlama */
  .nokta-s { display:inline-block; width:8px; height:8px; border-radius:50%;
             margin-right:.5rem; vertical-align:middle; background:var(--ink-3); }
  .s-openai    { background:#10a37f; }
  .s-anthropic { background:#c96442; }
  .s-gemini    { background:#4484B4; }

  .oran { display:flex; align-items:center; gap:.6rem; min-width:11rem; }
  .oranCubuk { flex:1 1 auto; height:6px; border-radius:4px; background:var(--sunk);
               overflow:hidden; min-width:5rem; }
  .oranCubuk i { display:block; height:100%; border-radius:4px; }
  .oranYuzde { font-family:"JetBrains Mono", ui-monospace, monospace;
               font-size:.78rem; color:var(--ink-3); width:2.6rem; text-align:right; }

  .ikincil-olculer { display:grid; grid-template-columns:repeat(4,1fr);
                     gap:1rem; margin-top:1rem; }
  @media (max-width:1180px) { .ikincil-olculer { grid-template-columns:repeat(2,1fr); } }
  @media (max-width:520px)  { .ikincil-olculer { grid-template-columns:1fr; } }
  .olcu { background:var(--surface); border-radius:16px; padding:1.15rem 1.4rem;
          box-shadow:var(--golge); }
  .olcu .ad { font-size:.82rem; color:var(--ink-3); }
  .olcu .deger { font-size:1.12rem; font-weight:600; margin-top:.25rem;
                 letter-spacing:-.015em; }

  .hap { display:inline-block; font-size:.74rem; font-weight:600; padding:.2rem .6rem;
         border-radius:999px; letter-spacing:.01em; }
  .hap.ok { background:var(--yesil-soft); color:var(--yesil); }
  .hap.err { background:var(--kirmizi-soft); color:var(--kirmizi); }
  .hap.bek { background:var(--sari-soft); color:var(--sari); }
  .hap:not(.ok):not(.err):not(.bek) { background:var(--sunk); color:var(--ink-3); }
  .rozet { display:inline-block; font-family:"JetBrains Mono", ui-monospace, monospace;
    font-size:.74rem; background:var(--accent-soft); border-radius:7px;
    padding:.22rem .55rem; margin:.2rem .3rem .2rem 0; color:var(--accent); }

  .tablokart { background:var(--surface); border-radius:16px; overflow:hidden;
    box-shadow:var(--golge); }
  .kaydir { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:.88rem; min-width:38rem; }
  th, td { text-align:left; padding:.85rem 1.35rem; white-space:nowrap; }
  th { font-size:.78rem; color:var(--ink-3); font-weight:600; border-bottom:1px solid var(--line);
       text-transform:uppercase; letter-spacing:.03em; }
  td { border-bottom:1px solid var(--line); color:var(--ink-2); }
  tbody tr:last-child td { border-bottom:0; }
  tbody tr:hover { background:var(--satirHover); }
  tbody tr { transition:background .1s; }
  td.sayi { font-family:"JetBrains Mono", ui-monospace, monospace;
            font-variant-numeric:tabular-nums; color:var(--ink); }

  .sekmeler { display:flex; gap:1.8rem; }
  .sekmeler button { background:none; border:0; border-bottom:2px solid transparent;
    padding:.35rem 0 .6rem; font:inherit; font-size:.9rem; color:var(--ink-3); cursor:pointer;
    transition:all .12s; }
  .sekmeler button:hover { color:var(--ink-2); }
  .sekmeler button.secili { color:var(--dugme); border-bottom-color:var(--dugme); font-weight:600; }
  .sekmeler .adet { font-family:"JetBrains Mono", ui-monospace, monospace;
    font-size:.8rem; color:var(--ink-3); margin-left:.35rem; }

  .ozellik { display:grid; grid-template-columns:11rem 1fr; gap:.9rem 1rem;
             font-size:.91rem; align-items:baseline; }
  .ozellik dt { color:var(--ink-3); }
  .ozellik dd { margin:0; color:var(--ink); }

  /* Yan panel — sağdan açılıyor */
  .perde { position:fixed; inset:0; background:rgba(7,70,131,.35); backdrop-filter:blur(4px);
           z-index:20; opacity:0; transition:opacity .18s; }
  .perde.acik { opacity:1; }
  .yanpanel { position:fixed; top:0; right:0; bottom:0; width:min(30rem,100%);
              background:var(--surface); z-index:21; overflow-y:auto;
              box-shadow:-12px 0 40px rgba(7,70,131,.15);
              transform:translateX(100%); transition:transform .2s ease-out; }
  .yanpanel.acik { transform:translateX(0); }
  .yanpanelUst { display:flex; justify-content:space-between; align-items:flex-start;
                 gap:1rem; padding:1.6rem 1.8rem 1.1rem; border-bottom:1px solid var(--line); }
  .yanpanelUst h3 { font-size:1.05rem; font-weight:700; margin:0; letter-spacing:-.015em; }
  .yanpanelUst .zaman { font-size:.82rem; color:var(--ink-3); margin-top:.15rem; }
  .kapat { background:none; border:0; font-size:1.35rem; line-height:1; color:var(--ink-3);
           cursor:pointer; padding:.2rem .4rem; border-radius:8px; transition:all .12s; }
  .kapat:hover { background:var(--sunk); color:var(--ink); }
  .yanpanelGovde { padding:1.5rem 1.8rem 2.5rem; }
  .bolumBaslik { font-size:.72rem; font-weight:700; letter-spacing:.06em;
                 text-transform:uppercase; color:var(--accent); margin:1.8rem 0 .8rem; }
  .bolumBaslik:first-child { margin-top:0; }

  .hesap { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:.83rem;
           background:var(--sunk); border-radius:12px; padding:1rem 1.15rem; }
  .hesap .sat { display:flex; justify-content:space-between; gap:1rem; padding:.2rem 0; }
  .hesap .sat span:first-child { color:var(--ink-3); }
  .hesap .cizgi { border-top:1px solid var(--line-2); margin:.6rem 0; }
  .hesap .toplam { font-weight:500; }

  .kodKutu { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:.78rem;
    background:var(--sunk); border-radius:12px; padding:.9rem 1.1rem; margin:.4rem 0 0;
    white-space:pre-wrap; word-break:break-word; max-height:16rem; overflow-y:auto;
    border:1px solid var(--line); }

  thead tr.suzgecSatiri th { padding-top:0; padding-bottom:.55rem;
    background:var(--sunk); border-bottom:1px solid var(--line-2); }
  thead tr.suzgecSatiri select { cursor:pointer; }

  th.sutunBaslik { position:relative; }
  .sutunOk { background:none; border:0; color:var(--ink-3); cursor:pointer;
    font-size:.7rem; padding:.1rem .3rem; margin-left:.15rem; border-radius:4px;
    vertical-align:middle; }
  .sutunOk:hover { background:var(--line-2); color:var(--ink); }
  .sutunOk.etkin { color:var(--dugme); }
  .sutunFiltrePopup { position:absolute; top:100%; left:0; margin-top:.3rem;
    background:var(--surface); border:1px solid var(--line-2); border-radius:12px;
    box-shadow:0 12px 32px rgba(7,70,131,.15), 0 0 0 1px rgba(7,70,131,.03);
    padding:.75rem; min-width:11rem; z-index:20; text-transform:none;
    letter-spacing:normal; font-weight:400; cursor:default; }
  .sutunFiltrePopup label { display:flex; align-items:center; gap:.45rem;
    font-size:.85rem; color:var(--ink-2); padding:.2rem 0; cursor:pointer; white-space:nowrap; }
  .sutunFiltrePopup input[type="text"], .sutunFiltrePopup input[type="number"] {
    font:inherit; font-size:.83rem; padding:.35rem .5rem; border:1px solid var(--line-2);
    border-radius:8px; background:var(--sunk); color:var(--ink); width:100%; }
  .sutunFiltrePopup .araGrubu { display:flex; align-items:center; gap:.4rem; }
  .sutunFiltrePopup .araGrubu input { width:4.5rem; }
  .sutunFiltrePopup .temizle { display:block; margin-top:.5rem; font-size:.78rem;
    color:var(--accent); background:none; border:0; cursor:pointer; padding:.15rem 0; }

  /* İstek listesi süzgeç çubuğu */
  .suzgecCubugu { display:flex; align-items:flex-end; gap:.9rem; flex-wrap:wrap;
    margin:0 0 .9rem; }
  .suzgecAlan { display:flex; flex-direction:column; gap:.25rem;
    font-size:.75rem; text-transform:uppercase; letter-spacing:.04em; color:var(--ink-3); }
  .suzgecAlan select { font:inherit; font-size:.85rem; text-transform:none;
    letter-spacing:0; padding:.38rem .65rem; border:1px solid var(--line-2);
    border-radius:10px; background:var(--surface); color:var(--ink);
    transition:border-color .15s; }
  .suzgecAlan select:focus { border-color:var(--accent); outline:none; }

  .suzgecDugme { font:inherit; font-size:.82rem; padding:.38rem .85rem; cursor:pointer;
    border:1px solid var(--line-2); border-radius:999px; background:transparent;
    color:var(--ink-3); transition:all .12s; }
  .suzgecDugme:hover { border-color:var(--accent); color:var(--ink); }
  .suzgecDugme.secili { border-color:var(--dugme); color:var(--dugme);
    background:var(--accent-soft); }

  .hesap .altBaslik { font-size:.72rem; text-transform:uppercase; letter-spacing:.05em;
    color:var(--ink-3); margin:.9rem 0 .4rem; }
  .dogrula { display:flex; align-items:center; gap:.55rem; margin-top:1rem;
             font-size:.87rem; padding:.75rem 1rem; border-radius:10px; }
  .dogrula.ok  { background:var(--yesil-soft); color:var(--yesil); }
  .dogrula.err { background:var(--kirmizi-soft); color:var(--kirmizi); }
  .dogrula.bek { background:var(--sari-soft); color:var(--sari); }
  tbody tr.tiklanir { cursor:pointer; }

  .hesapForm { display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; }
  @media (max-width:640px) { .hesapForm { grid-template-columns:1fr; } }
  .hesapForm label { display:flex; flex-direction:column; gap:.4rem;
                     font-size:.85rem; color:var(--ink-3); }
  .hesapForm select { padding:.6rem .8rem; font:inherit; font-size:.9rem;
    border:1px solid var(--line-2); border-radius:10px; background:var(--surface);
    color:var(--ink); transition:border-color .15s; }
  .hesapForm select:focus { border-color:var(--accent); outline:none; }
  .hesapForm input { font-size:.9rem; }

  .gizli { display:none; }
  #icerik { transition:opacity .15s; }
  #icerik.mesgul { opacity:.45; pointer-events:none; }
  .uyari { background:var(--kirmizi-soft); color:var(--kirmizi); border-radius:10px;
           padding:.75rem 1rem; font-size:.87rem; margin:1rem 0; }
  .basarili { background:var(--yesil-soft); color:var(--yesil); border-radius:10px;
              padding:.75rem 1rem; font-size:.87rem; margin:1rem 0; }
  .bosdurum { text-align:center; padding:3.5rem 1.5rem; }
  .bosdurum .simge { width:48px; height:48px; border-radius:14px; background:var(--accent-soft);
    display:inline-flex; align-items:center; justify-content:center; font-size:1.2rem;
    margin-bottom:1rem; color:var(--accent); }
  .bosdurum h3 { font-size:1rem; font-weight:700; margin:0 0 .35rem; }
  .bosdurum p { color:var(--ink-3); font-size:.88rem; margin:0; }
  .yukleniyor { color:var(--ink-3); padding:2.5rem 0; font-size:.9rem; text-align:center; }
  .sayac { font-family:"JetBrains Mono", ui-monospace, monospace;
           font-size:.78rem; color:var(--ink-3); }

  /* Scrollbar styling for webkit browsers */
  ::-webkit-scrollbar { width:6px; height:6px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:var(--line-2); border-radius:3px; }
  ::-webkit-scrollbar-thumb:hover { background:var(--ink-3); }

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

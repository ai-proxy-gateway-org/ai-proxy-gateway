import type { Hono } from 'hono';
import { openDelivery } from '../core/keyDelivery.js';

export function revealRoutes(app: Hono) {
  // Standalone API endpoint to consume and decrypt the one-time token
  app.get('/api/reveal/:token', async (c) => {
    const token = c.req.param('token');
    const sonuc = await openDelivery(String(token ?? ''));
    if (!sonuc.ok) return c.json({ error: sonuc.error }, sonuc.status as any);
    return c.json({ key: sonuc.key });
  });

  // Standalone HTML page for opening the one-time secret delivery link
  // Works completely independent of the portal — no login, no session, no ENABLE_PORTAL required.
  app.get('/reveal/:token', async (c) => {
    const token = c.req.param('token');
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Secure Key Delivery · Iceberg X</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #070b14;
  --surface: #0f172a;
  --surface-hover: #1e293b;
  --line: #1e293b;
  --line-highlight: #334155;
  --cyan: #38bdf8;
  --cyan-dim: rgba(56, 189, 248, 0.12);
  --text: #f8fafc;
  --muted: #94a3b8;
  --danger: #f87171;
  --ok: #34d399;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}
.card {
  width: 100%;
  max-width: 480px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 2rem;
  box-shadow: 0 20px 45px rgba(0,0,0,0.5), 0 0 40px rgba(56,189,248,0.06);
  position: relative;
  overflow: hidden;
}
.card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #38bdf8, #818cf8);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--cyan);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 1.25rem;
}
h1 {
  font-size: 1.35rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}
p.desc {
  font-size: 0.9rem;
  color: var(--muted);
  line-height: 1.5;
  margin-bottom: 1.5rem;
}
.keyBox {
  background: #030712;
  border: 1px solid var(--line-highlight);
  border-radius: 10px;
  padding: 1rem 1.1rem;
  margin-bottom: 1.25rem;
  word-break: break-all;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.92rem;
  color: #38bdf8;
  position: relative;
  user-select: all;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 0.85rem 1.25rem;
  border-radius: 10px;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  border: none;
}
.btnPrimary {
  background: var(--cyan);
  color: #030712;
}
.btnPrimary:hover {
  background: #7dd3fc;
  box-shadow: 0 4px 15px rgba(56,189,248,0.3);
}
.tag {
  display: inline-block;
  padding: 0.3rem 0.65rem;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  margin-bottom: 1rem;
}
.tagOk {
  background: rgba(52, 211, 153, 0.15);
  color: var(--ok);
}
.tagErr {
  background: rgba(248, 113, 113, 0.15);
  color: var(--danger);
}
.hidden { display: none !important; }
.footer {
  margin-top: 1.5rem;
  text-align: center;
  font-size: 0.8rem;
  color: var(--muted);
}
</style>
</head>
<body>
<div class="card">
  <div class="brand">✦ Iceberg X Platform</div>
  
  <div id="loadingState">
    <h1>Retrieving API Key...</h1>
    <p class="desc">Please wait while the one-time link is verified and decrypted.</p>
  </div>

  <div id="successState" class="hidden">
    <span class="tag tagOk">Single-Use Link Consumed</span>
    <h1>Your API Key is Ready</h1>
    <p class="desc">This link has now been permanently burned. Copy your key below and store it securely &mdash; it cannot be shown again.</p>
    <div class="keyBox" id="keyContent">sk-proxy-...</div>
    <button class="btn btnPrimary" id="copyBtn">Copy API Key</button>
  </div>

  <div id="errorState" class="hidden">
    <span class="tag tagErr">Link Expired</span>
    <h1>Link No Longer Valid</h1>
    <p class="desc" id="errorMsg">This one-time delivery link has either already been consumed or has expired. Please contact your team administrator to issue a new key.</p>
  </div>

  <div class="footer">Encrypted End-to-End Key Delivery</div>
</div>

<script>
(async () => {
  const token = ${JSON.stringify(token)};
  const loading = document.getElementById('loadingState');
  const success = document.getElementById('successState');
  const error = document.getElementById('errorState');
  const keyContent = document.getElementById('keyContent');
  const copyBtn = document.getElementById('copyBtn');
  const errorMsg = document.getElementById('errorMsg');

  try {
    const res = await fetch('/api/reveal/' + encodeURIComponent(token));
    const data = await res.json();
    loading.classList.add('hidden');

    if (!res.ok || !data.key) {
      errorMsg.textContent = data.error || 'This link is no longer valid or has already been opened.';
      error.classList.remove('hidden');
      return;
    }

    keyContent.textContent = data.key;
    success.classList.remove('hidden');

    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(data.key);
        copyBtn.textContent = 'Copied to Clipboard! ✓';
        copyBtn.style.background = '#34d399';
        setTimeout(() => {
          copyBtn.textContent = 'Copy API Key';
          copyBtn.style.background = '';
        }, 2500);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(keyContent);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        copyBtn.textContent = 'Key Selected — Press Ctrl+C';
      }
    };
  } catch (err) {
    loading.classList.add('hidden');
    errorMsg.textContent = 'Network error while attempting to reveal key.';
    error.classList.remove('hidden');
  }
})();
</script>
</body>
</html>`;
    return c.html(html);
  });
}

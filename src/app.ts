import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { authMiddleware } from './middleware/authMiddleware.js';
import { rateLimitMiddleware } from './middleware/rateLimitMiddleware.js';
import { dbService } from './services/databaseService.js';
import { getProviderKey } from './utils/vault.js';

// Hono uygulamasını başlatıyoruz
const app = new Hono();

// Sağlık kontrolü rotası
//
// charset açıkça belirtiliyor: onsuz bazı tarayıcılar (ör. Safari, adres
// çubuğuna doğrudan yazınca) UTF-8 dışı bir kodlamayla göstermeye çalışıyor
// ve Türkçe karakterler bozuk çıkıyordu.
app.get('/', (c) => {
  return c.json(
    { message: 'Hono Edge Proxy hazır ve şimşek gibi!' },
    200,
    { 'content-type': 'application/json; charset=UTF-8' }
  );
});

// Yapay zeka isteklerini karşılayacak TEK VE ANA Proxy Endpoint'i
// Sırasıyla Auth ve Rate Limit middleware'leri çalışacak
app.post('/v1/chat/completions', authMiddleware, rateLimitMiddleware, async (c) => {
  const client = c.get('client');
  const startTime = Date.now();

  try {
    // 1. Müşteriden gelen isteği oku
    const body = await c.req.json();
    const model = body.model || 'gpt-4o'; 
    const provider = 'openai'; 

    // 2. Asenkron Log Başlat (Pending)
    const logId = await dbService.logRequestStart(client.id, provider, model);

    // 3. Vault (Kasa) üzerinden sağlayıcının (OpenAI) gerçek API anahtarını al (Önbellekli / SWR)
    const realApiKey = await getProviderKey(provider, c);

    // 4. Edge Uyumlu Native Fetch ile AI API'sine İstek At
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${realApiKey}`
      },
      body: JSON.stringify(body)
    });

    const data = await aiResponse.json();
    const latencyMs = Date.now() - startTime;

    // 5. Token ve Cost verilerini topla
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const isSuccess = aiResponse.ok;
    const errorMessage = isSuccess ? undefined : data.error?.message;

    // 6. EDGE Büyüsü: Log işlemini arka planda tamamla (Kullanıcıyı bekletmez)
    if (logId) {
      const logPromise = dbService.logRequestComplete(
        logId, provider, model, inputTokens, outputTokens, latencyMs, isSuccess, errorMessage
      );
      
      try {
        if (c.executionCtx && c.executionCtx.waitUntil) {
          c.executionCtx.waitUntil(logPromise);
        } else {
          logPromise.catch(console.error);
        }
      } catch (e) {
        logPromise.catch(console.error); // Fallback for Node.js
      }
    }

    // 7. Sonucu döndür
    return c.json(data, aiResponse.status as any);

  } catch (error: any) {
    console.error("Proxy Error:", error);
    return c.json({ success: false, error: 'Internal Edge Proxy Error' }, 500);
  }
});

// Admin (yönetim paneli) her kurulumda gerekli — müşteri/fiyat/model
// yönetimi başka yoldan yapılamıyor. Bu yüzden koşulsuz yükleniyor.
const { adminRoutes } = await import('./routes/admin.js');
adminRoutes(app);

// Portal (müşteri paneli) her şirket için gerekli değil — bazı kurulumlarda
// maliyet merkezi olarak takip ediliyor, kullanıcı kendi harcamasını
// görmüyor. ENABLE_PORTAL kapalıyken dynamic import() kullanılıyor: statik
// import olsaydı kod her zaman pakete girerdi, bayrak yalnızca route
// kaydını atlardı. Böyle, kapalıyken o kod hiç çalışmıyor.
if (process.env.ENABLE_PORTAL === 'true') {
  const { portalRoutes } = await import('./routes/portal.js');
  portalRoutes(app);
}

// Lokal test için Node.js sunucusunu ayağa kaldırma.
//
// Bu koşula bağlı değildi — Vercel'de (sunucusuz ortamda) her fonksiyon
// çağrısında da çalışmaya çalışıyordu, orada anlamsız/hatalı bir yan etki.
// Yalnızca yerelde, Vercel dışında çalışırken başlasın.
if (process.env.VERCEL !== '1') {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  console.log(`Hono Sunucusu http://127.0.0.1:${port} adresinde başlatıldı`);

  serve({
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1' // Node.js v17+ IPv6 localhost çakışmasını önler
  });
}

// Vercel Edge'de çalışması için default export şarttır
export default app;
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './middleware/authMiddleware.js';
import { rateLimitMiddleware } from './middleware/rateLimitMiddleware.js';
import { dbService } from './services/databaseService.js';
import { getProviderKey, invalidateVaultKey } from './utils/vault.js';
import {
  getOrCreateSession, addMessageToSession, getActiveSession,
  getSessionMessages, generateSessionSummary
} from './utils/sessionManager.js';
import { runSecurityChain } from './core/security.js';

// Hono uygulamasını başlatıyoruz
const app = new Hono();

// CORS destegi
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
}));

app.use('*', async (c, next) => {
  c.header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
  await next();
});

// Hata yakalayıcı: Tüm yakalanmamış hataları konsola basar (Debug için)
app.onError((err, c) => {
  console.error('HONO ERROR:', err.message, err.stack);
  return c.json({ success: false, error: 'Internal server error' }, 500);
});

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

  const apiKey = (c.req.header('Authorization') || '').replace('Bearer ', '');
  const origin = c.req.header('Origin') ?? null;
  const security = await runSecurityChain({ apiKey, origin });
  
  if (!security.ok) {
    return c.json({ success: false, error: security.error }, 403);
  }

  // try bloğunun dışında tanımlı: sağlayıcıya ulaşmadan önce bir şey
  // patlarsa (ör. kasa/vault erişilemezse) alttaki catch bloğu da bu
  // kayda erişip "başarısız" diye kapatabilsin diye. Önceden bu durumda
  // kayıt sonsuza kadar "pending" kalıyordu — prompt kaydedilmiş oluyordu
  // ama hiçbir zaman başarısız olarak işaretlenmiyordu, error sebebi de
  // hiç yazılmıyordu.
  let logId: string | null = null;
  let provider = 'openai';
  let model = 'gpt-4o';

  try {
    // 1. Müşteriden gelen isteği oku
    const body = await c.req.json();
    model = body.model || 'gpt-4o';

    // Sağlayıcı Tespiti (Basit Routing)
    if (model.includes('claude')) provider = 'anthropic';
    if (model.includes('gemini')) provider = 'gemini';

    // Oturum (Session) Yönetimi:
    // X-Summarize header'ı varsa onu kullan, yoksa müşterinin admin settingına bak.
    const headerSummarize = c.req.header('X-Summarize');
    const summaryEnabled = headerSummarize !== undefined
      ? headerSummarize === 'true'
      : !!client.summary_enabled;

    const session = await getOrCreateSession(client.id, summaryEnabled);

    // 2. Asenkron Log Başlat (Pending)
    //
    // İsteğin tam metni burada kaydediliyor — cevaptan önce elimizdeki tek
    // şey bu. messages yoksa (beklenmedik bir gövde gelirse) gövdenin
    // tamamı saklanıyor, hiç kayıt kaybetmemek için.
    const promptText = JSON.stringify(body.messages ?? body);
    logId = await dbService.logRequestStart(client.id, provider, model, promptText);

    // Tehlike taraması (Arka planda çalışır, Edge function'ı bekletmez)
    if (logId && promptText) {
      try {
        if (c.executionCtx?.waitUntil) {
          c.executionCtx.waitUntil(dbService.checkModeration(logId, promptText));
        } else {
          dbService.checkModeration(logId, promptText).catch(console.error);
        }
      } catch(e) {}
    }

    // 3. Vault (Kasa) üzerinden gerçek API keyını al (Önbellekli / SWR)
    const realApiKey = await getProviderKey(provider, c);

    // 4. Sağlayıcıya Göre URL ve Header Ayarı

    // --- SEMANTIC CACHE CHECK ---
    let semanticCacheHit = null;
    try {
      if (promptText && promptText.length > 10) {
        semanticCacheHit = await checkSemanticCache(model, promptText);
      }
    } catch(e) {}

    if (semanticCacheHit) {
      // Return cached response instantly!
      const latencyMs = Date.now() - startTime;
      if (logId) {
        dbService.logRequestComplete(
          logId, provider, model, 0, 0, latencyMs, true, undefined, semanticCacheHit
        ).catch(console.error);
      }
      return c.json({
        id: "chatcmpl-semantic-cached",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: semanticCacheHit },
          finish_reason: "stop"
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      }, 200, { 'X-Cache': 'HIT-SEMANTIC' });
    }
    // ----------------------------

    let fetchUrl = 'https://api.openai.com/v1/chat/completions';
    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${realApiKey}`
    };

    if (provider === 'anthropic') {
      fetchUrl = 'https://api.anthropic.com/v1/messages';
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': realApiKey,
        'anthropic-version': '2023-06-01'
      };
    } else if (provider === 'gemini') {
      // Gemini'nin OpenAI uyumluluk katmanını kullanıyoruz (OpenAI formatıyla çalışır)
      fetchUrl = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${realApiKey}`
      };
    }

    // 5. Edge Uyumlu Native Fetch ile AI API'sine İstek At
    const aiResponse = await fetch(fetchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const data = await aiResponse.json();
    const latencyMs = Date.now() - startTime;

    // 6. Token ve Cost verilerini topla
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const isSuccess = aiResponse.ok;
    const errorMessage = isSuccess ? undefined : data.error?.message;

    // Cevabın okunabilir metnini sağlayıcıya göre çıkar; hangi şekle
    // denk geldiğini bilemiyorsak (ya da error gövdesiyse) ham JSON'u
    // saklıyoruz — hiçbir zaman boş kalmasın diye.
    const responseText =
      data.content?.[0]?.text ??      // anthropic
      data.choices?.[0]?.message?.content ?? // openai / gemini (uyumluluk katmanı)
      JSON.stringify(data);
    // Save to Semantic Cache if successful
    if (isSuccess && responseText && !errorMessage) {
      if (c.executionCtx?.waitUntil) {
        c.executionCtx.waitUntil(saveToSemanticCache(model, promptText, responseText));
      } else {
        saveToSemanticCache(model, promptText, responseText).catch(console.error);
      }
    }


    // 7. EDGE Büyüsü: Log işlemini arka planda tamamla (Kullanıcıyı bekletmez)
    if (logId) {
      const logPromise = dbService.logRequestComplete(
        logId, provider, model, inputTokens, outputTokens, latencyMs, isSuccess, errorMessage, responseText
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

    // 8. Oturum Takibi: Soru-cevap çiftini oturuma ekle (arka planda, sıfır gecikme)
    if (session.summaryEnabled && isSuccess) {
      const sessionPromise = addMessageToSession(
        client.id, session.sessionId, promptText, responseText, model, provider
      );
      try {
        if (c.executionCtx?.waitUntil) {
          c.executionCtx.waitUntil(sessionPromise);
        } else {
          sessionPromise.catch(console.error);
        }
      } catch (e) {
        sessionPromise.catch(console.error);
      }
    }

    // 9. Sonucu döndür
    return c.json(data, aiResponse.status as any);

  } catch (error: any) {
    console.error("Proxy Error:", error);

    // Kayıt "pending" olarak asılı kalmasın diye burada da kapatılıyor.
    // Sağlayıcıya hiç ulaşılamamış olsa bile (ör. kasa erişilemezse) kim
    // ne sormuş görülebilsin diye prompt zaten kaydedilmişti; en azından
    // isteğin başarısız olduğu ve nedeni de görünsün.
    if (logId) {
      const latencyMs = Date.now() - startTime;
      const failPromise = dbService.logRequestComplete(
        logId, provider, model, null, null, latencyMs, false,
        String(error?.message ?? 'Internal Edge Proxy Error')
      );
      try {
        if (c.executionCtx && c.executionCtx.waitUntil) {
          c.executionCtx.waitUntil(failPromise);
        } else {
          failPromise.catch(console.error);
        }
      } catch (e) {
        failPromise.catch(console.error);
      }
    }

    return c.json({ success: false, error: 'Internal Edge Proxy Error' }, 500);
  }
});

// ─── Oturum (Session) API Endpoint'leri ───────────────────────────────────

// Müşterinin aktif oturumunu görüntüle
app.get('/v1/sessions/current', authMiddleware, async (c) => {
  const client = c.get('client');
  const session = await getActiveSession(client.id);

  if (!session) {
    return c.json({ active: false, message: 'Aktif oturum bulunamadı.' });
  }

  return c.json({
    active: true,
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    messageCount: session.messageCount,
    summaryEnabled: session.summaryEnabled,
  });
});

// Belirli bir oturumun mesajlarını getir (aktif oturum — Redis'ten)
app.get('/v1/sessions/:sessionId/messages', authMiddleware, async (c) => {
  const client = c.get('client');
  const sessionId = c.req.param('sessionId');
  const session = await getActiveSession(client.id);

  if (!session || session.sessionId !== sessionId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const messages = await getSessionMessages(sessionId);
  return c.json({ sessionId, messageCount: messages.length, messages });
});

// Manuel olarak özet tetikle (oturum bitmeden de çağrılabilir)
app.post('/v1/sessions/:sessionId/summarize', authMiddleware, async (c) => {
  const client = c.get('client');
  const sessionId = c.req.param('sessionId');
  const messages = await getSessionMessages(sessionId);

  if (messages.length === 0) {
    return c.json({ error: 'Bu oturumda özetlenecek mesaj bulunamadı.' }, 404);
  }

  const { summary, inputTokens, outputTokens } = await generateSessionSummary(sessionId);

  // Özeti kalıcı olarak veritabanına kaydet
  const session = await getActiveSession(client.id);
  const cost = ((inputTokens / 1000) * 0.00015) + ((outputTokens / 1000) * 0.0006); // gpt-4o-mini priceı
  await dbService.saveSession(
    sessionId,
    client.id,
    session?.startedAt ?? new Date().toISOString(),
    messages.length / 2, // her soru-cevap çifti = 2 mesaj
    summary,
    inputTokens + outputTokens,
    cost
  );

  return c.json({ sessionId, summary, tokens: inputTokens + outputTokens, cost });
});

// Müşterinin geçmiş oturumlarını listele (veritabanından — kalıcı kayıtlar)
app.get('/v1/sessions/history', authMiddleware, async (c) => {
  const client = c.get('client');
  const limit = parseInt(c.req.query('limit') || '10');
  const sessions = await dbService.getSessionsByClient(client.id, limit);
  return c.json({ sessions });
});

// Admin (yönetim paneli) her kurulumda gerekli — müşteri/price/model
// yönetimi başka yoldan yapılamıyor. Bu yüzden koşulsuz yükleniyor.
const { adminRoutes } = await import('./routes/admin.js');
adminRoutes(app);

// Tek kullanımlık anahtar teslim rotası — portal kapalı olsa bile çalışır
const { revealRoutes } = await import('./routes/reveal.js');
revealRoutes(app);

// Portal (müşteri paneli) her şirket için gerekli değil — bazı kurulumlarda
// cost merkezi olarak takip ediliyor, kullanıcı kendi harcamasını
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
  console.log(`Hono Server http://127.0.0.1:${port} started atı`);

  serve({
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1' // Node.js v17+ IPv6 localhost çakışmasını önler
  });
}

// Vercel Edge'de çalışması için default export şarttır
export default app;
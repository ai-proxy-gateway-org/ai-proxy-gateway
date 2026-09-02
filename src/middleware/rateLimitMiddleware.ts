// src/middleware/rateLimitMiddleware.ts
import type { Context, Next } from 'hono';
import { checkRateLimit } from './rateLimiter.js';
export async function rateLimitMiddleware(c: Context, next: Next) {
  // authMiddleware'den geçen müşteri bilgisini alıyoruz
  const client = c.get('client');
  
  if (!client) {
    return c.json({ error: 'Unauthorized: Client information missing' }, 401);
  }

  // Örnek: Dakikada 60 istek sınırı (Bu değerleri dinamik olarak client veritabanından da çekebilirsin)
  const result = await checkRateLimit(client.id, 60, 60);

  if (!result.success) {
    // Limit aşıldıysa Hono üzerinden 429 hatası dönüyoruz
    return c.json({ error: result.error }, result.status as any);
  }

  // Limit aşılmadıysa, müşteriye kaç hakkı kaldığını HTTP başlıklarında (header) gösterelim
  if (result.remaining !== undefined) {
    c.header('X-RateLimit-Remaining', result.remaining.toString());
  }

  await next();
}
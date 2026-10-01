// src/middleware/rateLimitMiddleware.ts
import type { Context, Next } from 'hono';
import { checkRateLimit } from './rateLimiter.js';

export async function rateLimitMiddleware(c: Context, next: Next) {
  // authMiddleware'den geçen müşteri bilgisini alıyoruz
  const client = c.get('client');
  
  if (!client) {
    return c.json({ error: 'Unauthorized: Client information missing' }, 401);
  }

  // Örnek: Dakikada 60 request sınırı (Bu değerleri dinamik olarak client veritabanından da çekebilirsin)
  const user = c.get('user');
  
  // Rate limit �nceli�i: User -> Team -> Default 60
  const limit = user?.rate_limit ?? client.rate_limit ?? 60;
  
  // Hangi ID baz al�narak limitlenecek? User varsa user.id, yoksa team.id
  const limitId = user ? user.id : client.id;
  
  const result = await checkRateLimit(limitId, limit, limit);

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
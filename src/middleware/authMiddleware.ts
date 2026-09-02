import type { Context, Next } from 'hono';
import { dbService } from '../services/databaseService.js';

// test.ts dosyasının kullandığı ortak Doğrulama Fonksiyonu
export async function verifyClient(token: string) {
  return await dbService.verifyClient(token);
}

// Hono Sunucusunun Kullandığı Middleware
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: Missing or invalid token' }, 401);
  }

  const token = authHeader.split(' ')[1];
  const result = await verifyClient(token);

  if (!result.success) {
    // Statüs kodunu tip güvenliği için (her ihtimale karşı) parse ediyoruz
    const status = (result.status || 401) as any;
    return c.json({ error: result.error }, status);
  }

  // Müşteri bilgilerini Hono context'ine (c) ekleyip akışa devam et
  c.set('client', result.client);
  await next();
}
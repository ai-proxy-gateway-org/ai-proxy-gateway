// Portal ve admin route'larının Hono'ya çevrilirken ortak ihtiyaç duyduğu
// küçük yardımcılar. Fastify'da request.body/request.ip hazır geliyordu;
// Hono'da karşılıkları yok, burada tek yerden sağlanıyor.
import type { Context } from 'hono';

// İstek gövdesi boş/bozuksa Fastify'da request.body sessizce undefined
// oluyordu; Hono'da c.req.json() bu durumda fırlatıyor. Aynı davranışı
// korumak için hepsi bunun üzerinden okunuyor.
export async function govdeOku<T>(c: Context): Promise<T | undefined> {
  try {
    return await c.req.json() as T;
  } catch {
    return undefined;
  }
}

// Vercel'de gerçek istemci IP'si x-forwarded-for başlığında gelir; doğrudan
// soket adresi yok (sunucusuz). Yalnızca başarısız giriş denemelerini IP
// başına sınırlamak için kullanılıyor.
export function istekIp(c: Context): string {
  const baslik = c.req.header('x-forwarded-for');
  return baslik?.split(',')[0]?.trim() || 'unknown';
}

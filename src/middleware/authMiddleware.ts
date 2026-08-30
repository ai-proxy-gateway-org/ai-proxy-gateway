import type { Request, Response, NextFunction } from 'express';
import { dbService } from '../services/databaseService.js'; // Ana şalterimizi (Adaptörü) çağırıyoruz

// 1. test.ts dosyasının ve middleware'in ortak kullandığı Doğrulama Fonksiyonu
export async function verifyClient(token: string) {
  // Drizzle sorgularını sildik, bütün işi Adaptöre paslıyoruz!
  return await dbService.verifyClient(token);
}

// 2. Express Sunucusunun Kullandığı Middleware
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.split(' ')[1];
  
  // Üstteki verifyClient fonksiyonunu çağırıyoruz (O da adaptörü çağırıyor)
  const result = await verifyClient(token);

  if (!result.success) {
    return res.status(result.status || 401).json({ error: result.error });
  }

  // Müşteri bilgilerini request objesine ekleyip akışa devam et
  req.client = result.client;
  next();
}
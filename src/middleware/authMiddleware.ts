import type { Request, Response, NextFunction } from 'express';
import { hashApiKey } from '../utils/auth.js';
import { db } from '../db/index.js';
import { client_keys, clients } from '../db/schema.js';
import { eq } from 'drizzle-orm';

// 1. test.ts dosyasının ve middleware'in ortak kullandığı Doğrulama Fonksiyonu
export async function verifyClient(token: string) {
  try {
    const hashedKey = hashApiKey(token);

    const [keyData] = await db
      .select({ client_id: client_keys.client_id, environment: client_keys.environment })
      .from(client_keys)
      .where(eq(client_keys.key_hash, hashedKey));

    if (!keyData) {
      return { success: false, error: 'Unauthorized: Key not found', status: 401 };
    }

    const [clientData] = await db
      .select({
        id: clients.id,
        name: clients.name,
        is_active: clients.is_active,
        client_type: clients.client_type,
        
        allowed_domains: clients.allowed_domains,
        allowed_models: clients.allowed_models
      })
      .from(clients)
      .where(eq(clients.id, keyData.client_id));

    if (!clientData || !clientData.is_active) {
      return { success: false, error: 'Forbidden: Client is inactive or not found', status: 403 };
    }

    return { success: true, client: clientData };
  } catch (error) {
    console.error('Auth Error:', error);
    return { success: false, error: 'Internal Server Error', status: 500 };
  }
}

// 2. Express Sunucusunun Kullandığı Middleware
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.split(' ')[1];
  
  // Üstteki verifyClient fonksiyonunu çağırıyoruz
  const result = await verifyClient(token);

  if (!result.success) {
    return res.status(result.status || 401).json({ error: result.error });
  }

  // Müşteri bilgilerini request objesine ekleyip akışa devam et
  req.client = result.client;
  next();
}
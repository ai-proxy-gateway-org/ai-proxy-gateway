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

<<<<<<< HEAD
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
=======
    const { data: keyData, error: keyError } = await supabase
      .from('client_keys')
      .select(`
        id,
        is_active,
        environment,
        clients (
          id,
          name,
          is_active,
          client_type,
          allowed_domains,
          allowed_models
        )
      `)
      .eq('key_hash', hashedKey)
      .single();

    if (keyError || !keyData) {
      return { success: false, error: 'Unauthorized: Key not found', status: 401 };
    }

    const client = keyData.clients;
    const clientDetails = Array.isArray(client) ? client[0] : client;

    if (!keyData.is_active || !clientDetails?.is_active) {
      return { success: false, error: 'Forbidden: Client or key is inactive', status: 403 };
    }

    return {
      success: true,
      // Anahtarın kimliği: isteğin hangi anahtarla geldiği kayda yazılıyor,
      // böylece bir şirketin harcaması anahtar bazında kırılabiliyor.
      keyId: keyData.id,
      client: {
        id: clientDetails.id,
        name: clientDetails.name,
        environment: keyData.environment,
        client_type: clientDetails.client_type,
        allowed_domains: clientDetails.allowed_domains,
        allowed_models: clientDetails.allowed_models
      }
    };

  } catch (error) {
    console.error('Unexpected error during authentication:', error);
    return { success: false, error: 'Internal server error', status: 500 };
>>>>>>> main
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
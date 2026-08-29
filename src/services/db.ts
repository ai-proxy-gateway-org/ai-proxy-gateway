// src/services/db.ts
import { db } from '../db/index.js';
import { clients, client_keys } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { generateProxyKey, hashApiKey } from '../utils/auth.js';

/**
 * Creates a new client and assigns a generated API key.
 * @param name Name of the client (e.g., "Marketing Dept")
 * @param environment Environment (e.g., "production", "local")
 */
export async function createNewClient(name: string, environment: string) {
  try {
    // 1. Yeni Client'ı (Müşteriyi) veritabanına ekle
    // Drizzle'ın .returning() özelliği sayesinde eklenen veriyi anında geri alırız
    const [newClient] = await db.insert(clients)
      .values({ 
        name: name,
        
        client_type: 'server-based'
      })
      .returning({ id: clients.id });

    // 2. Güvenli API Anahtarını üret
    const plainApiKey = generateProxyKey();
    const hashedKey = hashApiKey(plainApiKey);

    // 3. Üretilen anahtarı veritabanına kaydet ve müşteriye bağla
    await db.insert(client_keys)
      .values({
        client_id: newClient.id,
        key_hash: hashedKey,
        environment: environment
      });

    return {
      success: true,
      clientId: newClient.id,
      plainApiKey: plainApiKey,
      message: "Client successfully created. Please save the API key now, it will not be shown again!"
    };

  } catch (error) {
    console.error("System Error:", error);
    return { success: false, error };
  }
}
// src/db/DrizzleAdapter.ts
import type { IDatabase } from '../interfaces/IDatabase.js';
import { db } from './index.js'; // Senin kurduğun Drizzle bağlantısı
import { clients, client_keys, logs } from './schema.js';
// ...
import { eq } from 'drizzle-orm';
import { hashApiKey, generateProxyKey } from '../utils/auth.js';
import pricingData from '../model_pricing.json';


type PricingMap = Record<string, { input: number; output: number }>;
const pricing: PricingMap = pricingData;

// DrizzleAdapter, IDatabase sözleşmesine (kurallarına) uymak zorundadır
export class DrizzleAdapter implements IDatabase {
  
  async createNewClient(name: string, environment: string) {
    try {
      // 1. Müşteriyi oluştur ve türünü 'server-based' olarak sabitle
      const [newClient] = await db.insert(clients)
        .values({ name, client_type: 'server-based' })
        .returning({ id: clients.id });

      const plainApiKey = generateProxyKey();
      const hashedKey = hashApiKey(plainApiKey);

      // 2. Anahtarı oluştur ve 'environment' bilgisini buraya kaydet
      await db.insert(client_keys)
        .values({ client_id: newClient.id, key_hash: hashedKey, environment });

      return { success: true, clientId: newClient.id, plainApiKey };
    } catch (error) {
      console.error("DB Error:", error);
      return { success: false, error };
    }
  }

  async verifyClient(token: string) {
    try {
      const hashedKey = hashApiKey(token);
      const [keyData] = await db.select().from(client_keys).where(eq(client_keys.key_hash, hashedKey));

      if (!keyData) return { success: false, error: 'Unauthorized: Key not found', status: 401 };

      const [clientData] = await db.select().from(clients).where(eq(clients.id, keyData.client_id));

      if (!clientData || !clientData.is_active) {
        return { success: false, error: 'Forbidden: Client is inactive or not found', status: 403 };
      }

      return { success: true, client: clientData };
    } catch (error) {
      return { success: false, error: 'Internal Server Error', status: 500 };
    }
  }

  async logRequestStart(clientId: string, provider: string, model: string) {
    try {
      const [newLog] = await db.insert(logs)
        .values({ client_id: clientId, provider, model, status: 'pending' })
        .returning({ id: logs.id });
      return newLog.id;
    } catch (error) {
      return null;
    }
  }

  async logRequestComplete(logId: string, provider: string, model: string, inputTokens: number | null, outputTokens: number | null, latencyMs: number, isSuccess: boolean = true, error_message?: string) {
    try {
      const modelKey = `${provider}/${model}`;
      const modelPricing = pricing[modelKey];
      let totalCost = 0;

      if (modelPricing && inputTokens !== null && outputTokens !== null) {
        totalCost = ((inputTokens / 1000) * modelPricing.input) + ((outputTokens / 1000) * modelPricing.output);
      }

      await db.update(logs)
        .set({
          status: isSuccess ? 'success' : 'error',
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost: totalCost,
          latency_ms: latencyMs,
          completed_at: new Date(),
          error_message: error_message || null
        })
        .where(eq(logs.id, logId));
    } catch (error) {
      console.error('Error updating log:', error);
    }
  }
}
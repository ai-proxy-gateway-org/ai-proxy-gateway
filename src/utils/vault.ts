import { Redis } from '@upstash/redis'
import type { Context } from 'hono'

import * as crypto from 'crypto';

function getEncryptionKey() {
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_TOKEN || 'default-unsafe-secret-please-change';
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

function decrypt(text: string): string {
  const parts = text.split(':');
  if (parts.length !== 3) return text; // Fallback for unencrypted legacy keys
  const [ivHex, encHex, tagHex] = parts;
  if (!ivHex || !encHex || !tagHex) return text;
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}


// Projedeki mevcut Upstash Redis bağlantımızı kullanıyoruz (isteğe bağlı / lazy)
let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

// Kasa (Vault) servisimizin hidden adresi ve yetki keyı
const VAULT_API_URL = process.env.VAULT_API_URL
const VAULT_ACCESS_TOKEN = process.env.VAULT_ACCESS_TOKEN

interface CachedKey {
  apiKey: string;
  staleAt: number;
}

export async function getProviderKey(provider: string, c?: Context): Promise<string> {
  // Eğer Kasa (Vault) URL'i tanımlanmamışsa (örn. açık kaynak test ortamı),
  // doğrudan .env dosyasındaki yerel değişkenlere başvur (Fallback mekanizması)
  if (!VAULT_API_URL) {
    const envKeyName = `${provider.toUpperCase()}_API_KEY`;
    const localKey = process.env[envKeyName];
    if (!localKey) {
      throw new Error(`Vault is disabled and ${envKeyName} was not found in environment variables.`);
    }
    return localKey;
  }

  const cacheKey = `vault_key:${provider}`
  const redis = getRedis();

  // 1. ADIM: Önce Redis'e (Önbelleğe) bak (Süre: ~2-5ms)
  if (redis) {
    try {
      const cachedData = await redis.get<CachedKey | string>(cacheKey)
      
      if (cachedData) {
        // Eski düz metin formatını desteklemek için ufak bir kontrol
        if (typeof cachedData === 'string') {
          return cachedData;
        }

        const { apiKey, staleAt } = cachedData;
        const decryptedApiKey = decrypt(apiKey);
        
        // Eğer verinin süresi geçmişse ama hala Redis'te yaşıyorsa (Stale)
        // Kullanıcıyı hiç bekletmeden (0ms gecikme ile) arkada yenilemeyi tetikle.
        if (Date.now() > staleAt) {
          const refreshPromise = refreshKeyInVault(provider, cacheKey).catch(console.error);
          
          // Hono (Edge) ortamında fonksiyonun yarıda kesilmemesi için waitUntil kullanımı
          try {
            if (c?.executionCtx?.waitUntil) {
              c.executionCtx.waitUntil(refreshPromise);
            }
          } catch (e) {
            // Fallback for Node.js
          }
        }

        // Anahtar bellekte var, (eskimiş olsa bile) anında döndür!
        return decryptedApiKey;
      }
    } catch (e) {
      // Redis erişilemezse doğrudan Vault'tan çekmeye devam et
    }
  }

  // 2. ADIM: Redis'te HİÇ yoksa (İlk İstek), mecbur bekleyip Kasa'dan (Vault) çekeceğiz
  return await refreshKeyInVault(provider, cacheKey);
}

// Arka planda sessizce (veya ilk istekte bekleyerek) çalışan asıl Vault okuma fonksiyonu
async function refreshKeyInVault(provider: string, cacheKey: string): Promise<string> {
  const response = await fetch(`${VAULT_API_URL}/keys/${provider}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${VAULT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Vault service unreachable. Status: ${response.status}`)
  }

  const data = await response.json()
  const realApiKey = data.apiKey

  // 3. ADIM: Kasa'dan alınan taze keyı Redis'e kaydet.
  // staleAt: 5 dakika (300,000 ms) sonra "eskimiş" kabul edilecek (Arka planda yenilenecek)
  // ex: Redis'ten tamamen silinmesi için 2 saat (7200 sn) veriyoruz ki aradaki 2 saatte gelen ilk müşteri beklemeyip stale veriyi alabilsin.
  const redis = getRedis();
  if (redis) {
    try {
      const cacheObject: CachedKey = {
        apiKey: encrypt(realApiKey),
        staleAt: Date.now() + 300 * 1000 // 5 dk sonra bayat
      }

      await redis.set(cacheKey, cacheObject, { ex: 7200 })
    } catch {
      // Ignore Redis write failure in fail-open mode
    }
  }

  return realApiKey;
}

/**
 * Bir saglayicidan 401 hatasi alininca onbellegi temizler,
 * boylece bir sonraki istekte Vault'tan taze anahtar cekilir.
 */
export async function invalidateVaultKey(provider: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const cacheKey = `vault_key:${provider}`;
  await redis.del(cacheKey);
  console.log(`[Vault] ${provider} cache invalidated.`);
}

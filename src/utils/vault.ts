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
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}


// Projedeki mevcut Upstash Redis bağlantımızı kullanıyoruz
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

// Kasa (Vault) servisimizin gizli adresi ve yetki anahtarı
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
      throw new Error(`Kasa devre dışı ancak .env dosyasında ${envKeyName} bulunamadı!`);
    }
    return localKey;
  }

  const cacheKey = `vault_key:${provider}`

  // 1. ADIM: Önce Redis'e (Önbelleğe) bak (Süre: ~2-5ms)
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
    throw new Error(`Vault servisine ulaşılamadı. Durum: ${response.status}`)
  }

  const data = await response.json()
  const realApiKey = data.apiKey

  // 3. ADIM: Kasa'dan alınan taze anahtarı Redis'e kaydet.
  // staleAt: 5 dakika (300,000 ms) sonra "eskimiş" kabul edilecek (Arka planda yenilenecek)
  // ex: Redis'ten tamamen silinmesi için 2 saat (7200 sn) veriyoruz ki aradaki 2 saatte gelen ilk müşteri beklemeyip stale veriyi alabilsin.
  const cacheObject: CachedKey = {
    apiKey: encrypt(realApiKey),
    staleAt: Date.now() + 300 * 1000 // 5 dk sonra bayat
  }

  await redis.set(cacheKey, cacheObject, { ex: 7200 })

  return realApiKey;
}
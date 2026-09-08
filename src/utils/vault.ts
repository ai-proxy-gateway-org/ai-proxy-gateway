import { Redis } from '@upstash/redis'

// Projedeki mevcut Upstash Redis bağlantımızı kullanıyoruz
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

// Kasa (Vault) servisimizin gizli adresi ve yetki anahtarı
const VAULT_API_URL = process.env.VAULT_API_URL!
const VAULT_ACCESS_TOKEN = process.env.VAULT_ACCESS_TOKEN!

export async function getProviderKey(provider: string): Promise<string> {
  const cacheKey = `vault_key:${provider}` // Örn: vault_key:openai

  // 1. ADIM: Önce Redis'e (Önbelleğe) bak (Süre: ~2-5ms)
  const cachedKey = await redis.get<string>(cacheKey)
  
  if (cachedKey) {
    // Anahtar bellekte var, hiç Kasa'ya gitmeden anında döndür!
    return cachedKey
  }

  // 2. ADIM: Redis'te yoksa (veya süresi dolduysa) Kasa'ya (Vault) istek at (Süre: ~50-100ms)
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

  // 3. ADIM: Kasa'dan alınan taze anahtarı Redis'e 5 dakikalığına (300 saniye) kaydet
  // ex: "expire" anlamına gelir, saniye cinsinden TTL (Time to Live) belirler.
  await redis.set(cacheKey, realApiKey, { ex: 300 })

  return realApiKey
}
import { Redis } from '@upstash/redis'
import { randomUUID } from 'crypto'
import { getProviderKey } from './vault.js'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const SESSION_TTL = 900 // 15 dakika (saniye cinsinden)

export interface SessionInfo {
  sessionId: string
  startedAt: string
  messageCount: number
  summaryEnabled: boolean
}

export interface SessionMessage {
  role: 'user' | 'assistant'
  content: string
  model: string
  provider: string
  timestamp: string
}

/**
 * Müşterinin mevcut oturumunu getirir veya yeni bir oturum oluşturur.
 * Her çağrıda TTL 15 dakikaya sıfırlanır — müşteri istekte bulunduğu sürece
 * oturum canlı kalır.
 */
export async function getOrCreateSession(
  clientId: string,
  summaryEnabled: boolean
): Promise<SessionInfo> {
  const sessionKey = `session:${clientId}`
  const existing = await redis.get<SessionInfo>(sessionKey)

  if (existing) {
    // Oturum hâlâ aktif — TTL'i sıfırla (15 dk daha uzat)
    await redis.expire(sessionKey, SESSION_TTL)
    await redis.expire(`session_messages:${existing.sessionId}`, SESSION_TTL)
    return existing
  }

  // Yeni oturum başlat
  const session: SessionInfo = {
    sessionId: randomUUID(),
    startedAt: new Date().toISOString(),
    messageCount: 0,
    summaryEnabled,
  }

  await redis.set(sessionKey, session, { ex: SESSION_TTL })
  return session
}

/**
 * Oturuma bir soru-cevap çifti (prompt + yanıt) ekler.
 * Her ekleme hem mesaj listesini hem de ana oturum kaydındaki sayacı günceller.
 */
export async function addMessageToSession(
  clientId: string,
  sessionId: string,
  prompt: string,
  response: string,
  model: string,
  provider: string
): Promise<void> {
  const messagesKey = `session_messages:${sessionId}`
  const sessionKey = `session:${clientId}`

  const userMsg: SessionMessage = {
    role: 'user',
    content: prompt,
    model,
    provider,
    timestamp: new Date().toISOString(),
  }

  const assistantMsg: SessionMessage = {
    role: 'assistant',
    content: response,
    model,
    provider,
    timestamp: new Date().toISOString(),
  }

  // Redis listesine soru ve cevabı ekle
  await redis.rpush(messagesKey, JSON.stringify(userMsg), JSON.stringify(assistantMsg))
  await redis.expire(messagesKey, SESSION_TTL)

  // Mesaj sayacını güncelle
  const session = await redis.get<SessionInfo>(sessionKey)
  if (session) {
    session.messageCount += 1
    await redis.set(sessionKey, session, { ex: SESSION_TTL })
  }
}

/**
 * Bir oturumun tüm mesajlarını Redis'ten getirir.
 */
export async function getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
  const messagesKey = `session_messages:${sessionId}`
  const rawMessages = await redis.lrange(messagesKey, 0, -1)

  return rawMessages.map((msg) => {
    if (typeof msg === 'string') return JSON.parse(msg)
    return msg as SessionMessage
  })
}

/**
 * Oturumdaki tüm soru-cevap mesajlarını alıp bir AI modeli ile özetler.
 * Varsayılan olarak gpt-4o-mini kullanır (en ucuz ve hızlı seçenek).
 *
 * Döndürdüğü değer: { summary, inputTokens, outputTokens, cost }
 */
export async function generateSessionSummary(
  sessionId: string
): Promise<{ summary: string; inputTokens: number; outputTokens: number }> {
  const messages = await getSessionMessages(sessionId)

  if (messages.length === 0) {
    return { summary: 'Bu oturumda hiç mesaj bulunmuyor.', inputTokens: 0, outputTokens: 0 }
  }

  // Mesajları okunabilir metin formatına çevir
  const conversation = messages
    .map((m) => `[${m.role.toUpperCase()}] (${m.model}): ${m.content}`)
    .join('\n')

  const summaryPrompt = `Aşağıdaki API oturumundaki tüm soru-cevap çiftlerini kısa ve öz bir şekilde özetle. Hangi modeller kullanıldı, kaç mesaj gidip geldi, ana konular nelerdi — bunları belirt. Özet Türkçe olsun.\n\n${conversation}`

  // Özetleme için gpt-4o-mini kullan (en düşük maliyetli)
  const openaiKey = await getProviderKey('openai')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      messages: [{ role: 'user', content: summaryPrompt }],
    }),
  })

  const data = await response.json() as any
  const summary = data.choices?.[0]?.message?.content ?? 'Özet üretilemedi.'
  const inputTokens = data.usage?.prompt_tokens ?? 0
  const outputTokens = data.usage?.completion_tokens ?? 0

  return { summary, inputTokens, outputTokens }
}

/**
 * Müşterinin aktif oturum bilgisini döndürür (yoksa null).
 */
export async function getActiveSession(clientId: string): Promise<SessionInfo | null> {
  const sessionKey = `session:${clientId}`
  return await redis.get<SessionInfo>(sessionKey)
}

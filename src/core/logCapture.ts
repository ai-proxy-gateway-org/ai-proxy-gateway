// B tarafının log servisine açılan katman.
//
// Eskiden logRequestComplete errorMessage almıyordu; sebep metni burada ayrı
// bir güncellemeyle yazılıyordu. İmza genişletildiği için o ek tur kalktı:
// artık tek yazma yetiyor.

import type { ProviderName } from './providerConfig.js';
import * as logger from '../services/logger.js';

export async function logRequestStart(
  clientId: string,
  provider: ProviderName,
  model: string,
  keyId?: string | null
): Promise<string | null> {
  return logger.logRequestStart(clientId, provider, model, keyId);
}

export async function logRequestComplete(
  logId: string,
  provider: ProviderName,
  model: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  isSuccess: boolean = true,
  errorMessage?: string
): Promise<void> {
  await logger.logRequestComplete(
    logId, provider, model, inputTokens, outputTokens, latencyMs, isSuccess, errorMessage
  );
}

// Sağlayıcıya hiç gitmeden reddedilen istekler de kayda geçsin
// (görev tanımı: "All AI requests made through the Proxy should be logged").
export async function logDeniedRequest(
  clientId: string,
  provider: ProviderName,
  model: string,
  reason: string,
  keyId?: string | null
): Promise<void> {
  const logId = await logRequestStart(clientId, provider, model, keyId);
  if (!logId) return;
  await logRequestComplete(logId, provider, model, 0, 0, 0, false, reason);
}

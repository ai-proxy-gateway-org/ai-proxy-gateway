// src/services/logger.ts
import { dbService } from './databaseService.js'; // Sadece ana şalteri çağırıyoruz

export async function logRequestStart(clientId: string, provider: string, model: string) {
  return await dbService.logRequestStart(clientId, provider, model);
}

export async function logRequestComplete(
  logId: string, provider: string, model: string, 
  inputTokens: number | null, outputTokens: number | null, 
  latencyMs: number, isSuccess: boolean = true, error_message?: string
) {
  return await dbService.logRequestComplete(
    logId, provider, model, inputTokens, outputTokens, latencyMs, isSuccess, error_message
  );
}
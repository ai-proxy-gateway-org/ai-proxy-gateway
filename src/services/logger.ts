// src/services/logger.ts
//
// Bu dosya bir merge sırasında çözülmemiş çakışma işaretleriyle (<<<<<<<)
// commit edilmişti, derlemeyi baştan engelliyordu. Yeni mimariye (dbService/
// Drizzle üzerinden) uyan tarafı bırakıyorum — eski Supabase-JS'e doğrudan
// bağlanan sürüm artık dbService'in arkasında.
import { dbService } from './databaseService.js';

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

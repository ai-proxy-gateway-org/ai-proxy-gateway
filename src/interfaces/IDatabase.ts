// src/interfaces/IDatabase.ts

export interface IDatabase {
  // Müşteri oluşturma
  createNewClient(name: string, environment: string): Promise<any>;
  
  // (Diğer satırlar aynı kalacak...)
  
  // API Key doğrulama
  verifyClient(token: string): Promise<{ success: boolean; client?: any; error?: string; status?: number }>;
  
  // Log başlatma
  logRequestStart(clientId: string, provider: string, model: string): Promise<string | null>;
  
  // Log bitirme
  logRequestComplete(
    logId: string, 
    provider: string, 
    model: string, 
    inputTokens: number | null, 
    outputTokens: number | null, 
    latencyMs: number,
    isSuccess: boolean,
    error_message?: string
  ): Promise<void>;
}
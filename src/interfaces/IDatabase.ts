// src/interfaces/IDatabase.ts

export interface IDatabase {
  // Müşteri oluşturma
  createNewClient(name: string, environment: string): Promise<any>;
  
  // (Diğer satırlar aynı kalacak...)
  
  // API Key doğrulama
  verifyClient(token: string): Promise<{ success: boolean; client?: any; error?: string; status?: number }>;
  
  // Log başlatma. prompt isteğin tam metni — cevaptan önce elimizde olan
  // tek şey bu, o yüzden başlatma anında kaydediliyor.
  logRequestStart(
    clientId: string, provider: string, model: string, prompt?: string | null
  ): Promise<string | null>;

  // Log bitirme. response, sağlayıcıdan dönen cevabın tam metni.
  logRequestComplete(
    logId: string,
    provider: string,
    model: string,
    inputTokens: number | null,
    outputTokens: number | null,
    latencyMs: number,
    isSuccess: boolean,
    error_message?: string,
    response?: string | null
  ): Promise<void>;
}
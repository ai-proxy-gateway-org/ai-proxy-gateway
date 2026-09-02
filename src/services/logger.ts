<<<<<<< HEAD
// src/services/logger.ts
import { dbService } from './databaseService.js'; // Sadece ana şalteri çağırıyoruz

export async function logRequestStart(clientId: string, provider: string, model: string) {
  return await dbService.logRequestStart(clientId, provider, model);
=======
import { supabase } from './db.js';
// Fiyatlar artık model_catalog tablosundan geliyor (A tarafı, modelCatalog.ts).
// Önceden model_pricing.json doğrudan import ediliyordu; dosya dağıtım paketine
// gömülü olduğu için panelden fiyat değiştirmek mümkün değildi. Dosya yedek
// olarak duruyor, veritabanı okunamazsa modelCatalog ona düşüyor.
import { priceFor } from '../core/modelCatalog.js';

/**
 * Creates a 'pending' log entry when an AI request starts.
 */
export async function logRequestStart(
  clientId: string,
  provider: string,
  model: string,
  keyId?: string | null
) {
  try {
    // key_id: isteğin hangi anahtarla geldiği. Bir şirketin harcamasını
    // anahtar bazında kırabilmek için gerekiyor — kayıtta yalnızca client_id
    // olduğunda "kim ne harcadı" sorusunun cevabı yoktu.
    const satir: Record<string, unknown> = {
      client_id: clientId,
      provider: provider,
      model: model,
      status: 'pending'
    };
    if (keyId) satir.key_id = keyId;

    let { data, error } = await supabase.from('logs').insert([satir]).select('id').single();

    // key_id sütunu sonradan eklendi; göç çalıştırılmamış bir ortamda sorgu
    // burada düşerse kaydı sütunsuz açıyoruz — log kaybetmek daha kötü.
    if (error && /key_id|column/i.test(String(error.message))) {
      delete satir.key_id;
      ({ data, error } = await supabase.from('logs').insert([satir]).select('id').single());
    }

    if (error) throw error;
    if (!data) throw new Error('Log satırı oluşturulamadı.');
    return data.id; 
  } catch (error) {
    console.error('Error starting log:', error);
    return null;
  }
>>>>>>> main
}

export async function logRequestComplete(
  logId: string, provider: string, model: string, 
  inputTokens: number | null, outputTokens: number | null, 
  latencyMs: number, isSuccess: boolean = true, error_message?: string
) {
<<<<<<< HEAD
  return await dbService.logRequestComplete(
    logId, provider, model, inputTokens, outputTokens, latencyMs, isSuccess, error_message
  );
=======
  try {
    const modelPricing = await priceFor(provider, model);
    let totalCost = 0;

    // Token'lar null değilse maliyet hesapla
    if (modelPricing && inputTokens !== null && outputTokens !== null) {
      const inputCost = (inputTokens / 1000) * modelPricing.input;
      const outputCost = (outputTokens / 1000) * modelPricing.output;
      totalCost = inputCost + outputCost;
    }

    // Kullanılan birim fiyat da kayda giriyor.
    //
    // Sebep: model fiyatı sonradan değişince eski kayıtların maliyeti
    // doğrulanamaz hale geliyordu. Panel bugünkü fiyatla yeniden hesaplayıp
    // "uyuşmuyor" diyordu, oysa kayıt o günkü fiyata göre doğruydu.
    // Fiyatı da saklayınca geçmiş her istek kesin olarak doğrulanabiliyor.
    const alanlar: Record<string, unknown> = {
      status: isSuccess ? 'success' : 'error',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost: totalCost,
      latency_ms: latencyMs,
      completed_at: new Date().toISOString(),
      error_message: error_message || null,
      input_price_used: modelPricing?.input ?? null,
      output_price_used: modelPricing?.output ?? null
    };

    let { error } = await supabase.from('logs').update(alanlar).eq('id', logId);

    // Fiyat sütunları sonradan eklendi; göç çalıştırılmamış bir ortamda
    // sorgu bu yüzden düşerse kaydı fiyatsız yazıyoruz — log kaybetmek,
    // eksik alandan daha kötü.
    if (error && /input_price_used|output_price_used|column/i.test(String(error.message))) {
      delete alanlar.input_price_used;
      delete alanlar.output_price_used;
      ({ error } = await supabase.from('logs').update(alanlar).eq('id', logId));
    }

    if (error) throw error;
    
  } catch (error) {
    console.error('Error updating log:', error);
  }
>>>>>>> main
}
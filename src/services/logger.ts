import { supabase } from './db.js';
// Fiyatlar artık model_catalog tablosundan geliyor (A tarafı, modelCatalog.ts).
// Önceden model_pricing.json doğrudan import ediliyordu; dosya dağıtım paketine
// gömülü olduğu için panelden fiyat değiştirmek mümkün değildi. Dosya yedek
// olarak duruyor, veritabanı okunamazsa modelCatalog ona düşüyor.
import { priceFor } from '../core/modelCatalog.js';

/**
 * Creates a 'pending' log entry when an AI request starts.
 */
export async function logRequestStart(clientId: string, provider: string, model: string) {
  try {
    const { data, error } = await supabase
      .from('logs')
      .insert([{
        client_id: clientId,
        provider: provider,
        model: model,
        status: 'pending'
      }])
      .select('id')
      .single();

    if (error) throw error;
    return data.id; 
  } catch (error) {
    console.error('Error starting log:', error);
    return null;
  }
}

/**
 * Asynchronously updates the log with token usage and cost when the AI responds.
 */
export async function logRequestComplete(
  logId: string, 
  provider: string, 
  model: string, 
  inputTokens: number | null, 
  outputTokens: number | null, 
  latencyMs: number,
  isSuccess: boolean = true,
  error_message?: string
) {
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
}
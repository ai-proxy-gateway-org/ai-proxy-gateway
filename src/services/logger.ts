import { db } from '../db/index.js';
import { logs } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import pricingData from '../model_pricing.json';

type PricingMap = Record<string, { input: number; output: number }>;
const pricing: PricingMap = pricingData;

/**
 * Creates a 'pending' log entry when an AI request starts.
 */
export async function logRequestStart(clientId: string, provider: string, model: string) {
  try {
    const [newLog] = await db.insert(logs)
      .values({
        client_id: clientId,
        provider: provider,
        model: model,
        status: 'pending'
      })
      .returning({ id: logs.id });

    return newLog.id; 
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
    const modelKey = `${provider}/${model}`;
    const modelPricing = pricing[modelKey];
    let totalCost = 0;

    // Token'lar null değilse maliyet hesapla
    if (modelPricing && inputTokens !== null && outputTokens !== null) {
      const inputCost = (inputTokens / 1000) * modelPricing.input;
      const outputCost = (outputTokens / 1000) * modelPricing.output;
      totalCost = inputCost + outputCost;
    }

    await db.update(logs)
      .set({
        status: isSuccess ? 'success' : 'error',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost: totalCost,
        latency_ms: latencyMs, // Gecikme süresi korunuyor
        completed_at: new Date(), // Bitiş zamanı korunuyor
        error_message: error_message || null
      })
      .where(eq(logs.id, logId));
    
  } catch (error) {
    console.error('Error updating log:', error);
  }
}
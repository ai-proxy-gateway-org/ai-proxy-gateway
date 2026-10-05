import { Redis } from '@upstash/redis';

// Initialize Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!
});

// Calculate Sørensen–Dice coefficient between two strings (0.0 to 1.0)
function getSimilarity(str1: string, str2: string): number {
  const getBigrams = (str: string) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.substring(i, i + 2).toLowerCase());
    }
    return bigrams;
  };

  const set1 = getBigrams(str1);
  const set2 = getBigrams(str2);
  
  if (set1.size === 0 || set2.size === 0) return 0;
  
  let intersectionSize = 0;
  for (const bg of set1) {
    if (set2.has(bg)) intersectionSize++;
  }
  
  return (2.0 * intersectionSize) / (set1.size + set2.size);
}

export async function checkSemanticCache(model: string, promptText: string): Promise<string | null> {
  if (!promptText || promptText.length < 10) return null; // Too short to cache reliably
  
  const cacheKey = `semantic_cache:${model}`;
  
  // Get last 50 cached prompts for this model from Redis
  try {
    const cachedItems = await redis.lrange(cacheKey, 0, 50);
    if (!cachedItems || cachedItems.length === 0) return null;
    
    let bestMatch = null;
    let highestSim = 0;
    
    for (const item of cachedItems) {
      if (typeof item === 'string') {
        try {
          const parsed = JSON.parse(item);
          const sim = getSimilarity(promptText, parsed.prompt);
          if (sim > highestSim) {
            highestSim = sim;
            bestMatch = parsed;
          }
        } catch (e) {}
      } else {
        // Depending on Upstash SDK version, it might auto-parse objects
        const sim = getSimilarity(promptText, (item as any).prompt);
        if (sim > highestSim) {
          highestSim = sim;
          bestMatch = item;
        }
      }
    }
    
    // Threshold: 85% similarity
    if (highestSim > 0.85 && bestMatch) {
      console.log(`[Semantic Cache HIT] Similarity: ${(highestSim*100).toFixed(1)}%`);
      return bestMatch.response;
    }
  } catch (error) {
    console.error('Semantic Cache Error:', error);
  }
  
  return null;
}

export async function saveToSemanticCache(model: string, promptText: string, responseText: string) {
  if (!promptText || promptText.length < 10 || !responseText) return;
  
  const cacheKey = `semantic_cache:${model}`;
  try {
    const entry = JSON.stringify({ prompt: promptText, response: responseText, timestamp: Date.now() });
    await redis.lpush(cacheKey, entry);
    await redis.ltrim(cacheKey, 0, 99); // Keep only last 100 entries per model to save space
  } catch (error) {
    console.error('Semantic Cache Save Error:', error);
  }
}

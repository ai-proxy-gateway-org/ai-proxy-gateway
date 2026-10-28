import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!_redis) {
    _redis = Redis.fromEnv();
  }
  return _redis;
}

/**
 * Checks the rate limit for a specific client.
 * Degrades gracefully (fail-open) if Redis is not configured or unreachable.
 * @param clientId The ID of the client making the request
 * @param limit Maximum allowed requests
 * @param windowSeconds Time window in seconds
 */
export async function checkRateLimit(clientId: string, limit: number = 60, windowSeconds: number = 60) {
  const redis = getRedis();
  if (!redis) {
    return { success: true, remaining: limit };
  }

  try {
    const currentWindow = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `ratelimit:req:${clientId}:${currentWindow}`;

    const requestCount = await redis.incr(key);

    if (requestCount === 1) {
      await redis.expire(key, windowSeconds);
    }

    if (requestCount > limit) {
      return {
        success: false,
        status: 429,
        error: 'Too Many Requests: Rate limit exceeded. Please try again later.'
      };
    }

    return {
      success: true,
      remaining: limit - requestCount
    };

  } catch (error) {
    console.error('Redis Rate Limit Error:', error);
    return { success: true }; // Fail-open logic
  }
}

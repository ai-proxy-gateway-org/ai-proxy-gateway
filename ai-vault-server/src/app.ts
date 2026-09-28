import { Hono } from 'hono';

const app = new Hono();

// Auth Middleware: Check for VAULT_ACCESS_TOKEN
app.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const expectedToken = process.env.VAULT_ACCESS_TOKEN;

  if (!expectedToken) {
    return c.json({ error: 'Vault is misconfigured: Missing VAULT_ACCESS_TOKEN' }, 500);
  }

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    console.warn(`[Vault] Unauthorized access attempt from ${c.req.header('x-forwarded-for') || 'unknown'}`);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
});

// GET /keys/:provider
app.get('/keys/:provider', async (c) => {
  const provider = c.req.param('provider').toLowerCase();
  
  // Determine which env variable holds the key
  let envKey = '';
  if (provider === 'openai') envKey = 'OPENAI_API_KEY';
  else if (provider === 'anthropic') envKey = 'ANTHROPIC_API_KEY';
  else if (provider === 'gemini') envKey = 'GEMINI_API_KEY';
  // Add other providers if needed
  
  if (!envKey) {
    return c.json({ error: `Unsupported provider: ${provider}` }, 400);
  }

  const apiKey = process.env[envKey];

  if (!apiKey) {
    console.warn(`[Vault] Missing key for ${provider}`);
    return c.json({ error: `Key not found for ${provider}` }, 404);
  }

  console.log(`[Vault] Successfully served key for: ${provider}`);
  return c.json({ apiKey });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'ai-vault-server' });
});

export { app };

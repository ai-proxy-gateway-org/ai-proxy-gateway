import { serve } from '@hono/node-server';
import { app } from './app.js';
import 'dotenv/config';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

console.log(`[Vault] Starting server on port ${port}...`);

serve({
  fetch: app.fetch,
  port
}, (info) => {
  console.log(`[Vault] Secure Vault API is running on http://localhost:${info.port}`);
  if (!process.env.VAULT_ACCESS_TOKEN) {
    console.warn(`[Vault] WARNING: VAULT_ACCESS_TOKEN is not set!`);
  }
});

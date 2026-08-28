import Fastify from 'fastify';
import { openaiRoutes } from './routes/openai.js';
import { geminiRoutes } from './routes/gemini.js';
import { anthropicRoutes } from './routes/anthropic.js';
import { portalRoutes } from './routes/portal.js';
import { adminRoutes } from './routes/admin.js';
import { isLocalOrigin } from './core/localOrigins.js';
import { catalogInfo } from './core/modelCatalog.js';

export function buildApp() {
  const server = Fastify({ logger: true });

  server.get('/health', async (request) => {
    const origin = request.headers.origin;
    return { status: 'ok', isLocalOrigin: isLocalOrigin(origin), modelCatalog: await catalogInfo() };
  });

  server.register(openaiRoutes);
  server.register(geminiRoutes);
  server.register(anthropicRoutes);
  server.register(portalRoutes);
  server.register(adminRoutes);

  return server;
}
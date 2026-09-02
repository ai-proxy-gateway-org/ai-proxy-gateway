import Fastify from 'fastify';
import { openaiRoutes } from './routes/openai.js';
import { geminiRoutes } from './routes/gemini.js';
import { anthropicRoutes } from './routes/anthropic.js';
import { portalRoutes } from './routes/portal.js';
import { adminRoutes } from './routes/admin.js';
import { mockProviderRoutes } from './routes/mockProvider.js';
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

  // Sahte sağlayıcı yalnızca açıkça istendiğinde takılıyor.
  //
  // Gerçek sağlayıcı anahtarlarımız olmadığı için canlıda da bir hedefe
  // ihtiyacımız var; mock ayrı bir süreç olarak çalıştığında Vercel oraya
  // erişemiyordu. Aynı uygulamanın içinde /mock altında durunca dağıtılmış
  // ortamda da uçtan uca akış gösterilebiliyor.
  //
  // Gerçek anahtarlar geldiğinde bayrak kaldırılır, BASE_URL değişkenleri
  // silinir; kod değişmeden gerçek sağlayıcılara çıkılır.
  if (process.env.ENABLE_MOCK_PROVIDERS === 'true') {
    server.register(mockProviderRoutes, { prefix: '/mock' });
  }

  return server;
}
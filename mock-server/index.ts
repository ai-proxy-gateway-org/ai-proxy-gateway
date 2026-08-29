// Sahte sağlayıcıyı tek başına çalıştırır (npm run mock).
//
// Yolların kendisi src/routes/mockProvider.ts içinde: aynı kod hem burada
// hem de ana uygulamanın /mock yolunda kullanılıyor. İki kopya tutmak,
// birinin diğerinden sessizce ayrışması demekti.

import Fastify from 'fastify';
import { mockProviderRoutes } from '../src/routes/mockProvider.js';

// Terminale istek kutularını bu süreçte basıyoruz; sunucusuz ortamda kimse
// görmediği için orada kapalı kalıyor.
process.env.MOCK_STANDALONE = 'true';

const mockServer = Fastify({ logger: false });
mockServer.register(mockProviderRoutes);

mockServer.listen({ port: 4000, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log('\n\x1b[1m  SAHTE SAĞLAYICI  ·  localhost:4000\x1b[0m');
  console.log('\x1b[2m  OpenAI, Anthropic ve Gemini\'nin yerine geçiyor.\x1b[0m');
  console.log('\x1b[2m  Buraya ulaşan her istek aşağıda sarı kutu olarak görünecek.\x1b[0m');
  console.log('\x1b[2m  Şu an boş — henüz istek gelmedi.\x1b[0m\n');
});

import type { FastifyInstance } from 'fastify';
import { forwardToProvider } from '../core/proxyForward.js';
import { authorizeModel } from '../core/modelAuthorization.js';
import { logDeniedRequest } from '../core/logCapture.js';
import { runSecurityChain } from '../core/security.js';

// Sağlayıcı adı bilerek 'anthropic' — wf-rol "Anthropic uç noktaları" diyor ve
// Umur'un model_pricing.json anahtarları da `anthropic/...` ile başlıyor.
// 'claude' göndersek fiyat eşleşmez, maliyet sessizce 0 yazılırdı.
export async function anthropicRoutes(server: FastifyInstance) {
  server.post('/v1/anthropic/messages', async (request, reply) => {
    // Güvenlik zinciri: kimlik -> domain -> hız limiti.
    // Üçü de Umur'un middleware'leri; security.ts şu an taklitlerini çalıştırıyor.
    const security = await runSecurityChain({
      apiKey: (request.headers.authorization ?? '').replace(/^Bearer\s+/i, ''),
      origin: request.headers.origin ?? request.headers.referer ?? null
    });
    if (!security.ok) {
      return reply.status(security.status).send({ error: security.error });
    }
    const clientId = security.clientId;
    const keyId = security.keyId;
    const maxOutputPrice = security.maxOutputPrice;
    const allowedModels = security.allowedModels;

    const body = request.body as { model?: string } | undefined;
    const requestedModel = body?.model;
    if (!requestedModel) {
      return reply.status(400).send({ error: "The 'model' field is required in the request body." });
    }

    const authorization = await authorizeModel('anthropic', requestedModel, allowedModels, maxOutputPrice);
    if (!authorization.ok) {
      void logDeniedRequest(clientId, 'anthropic', requestedModel, authorization.error, keyId);
      return reply.status(authorization.status).send({ error: authorization.error });
    }

    await forwardToProvider({
      body: request.body,
      reply,
      clientId,
      keyId,
      provider: 'anthropic',
      model: requestedModel
    });
  });
}

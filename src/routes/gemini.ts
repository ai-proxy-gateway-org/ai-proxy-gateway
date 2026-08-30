import type { FastifyInstance } from 'fastify';
import { forwardToProvider } from '../core/proxyForward.js';
import { authorizeModel, modeliKisiyeAc } from '../core/modelAuthorization.js';
import { logDeniedRequest } from '../core/logCapture.js';
import { runSecurityChain } from '../core/security.js';

export async function geminiRoutes(server: FastifyInstance) {
  server.post('/v1/gemini/models/:model', async (request, reply) => {
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
    const userId = security.userId;
    const allowedModels = security.allowedModels;

    // Gemini'nin kendi uç noktası `models/{model}:generateContent` biçiminde.
    // Client orijinal formatı taklit ederse eylem ekini ayırıp saf model adını alıyoruz.
    const modelParam = (request.params as { model: string }).model;
    const requestedModel = modelParam.split(':')[0];
    if (!requestedModel) {
      return reply.status(400).send({ error: 'Model name is missing from the URL.' });
    }

    const authorization = await authorizeModel('gemini', requestedModel, allowedModels, maxOutputPrice);
    if (!authorization.ok) {
      void logDeniedRequest(clientId, 'gemini', requestedModel, authorization.error, keyId);
      return reply.status(authorization.status).send({ error: authorization.error });
    }

    // Fiyat tavanı sayesinde geçtiyse model bu kişiye kalıcı olarak açılıyor:
    // izin listesi panelde kimin neye eriştiğini gerçekten göstersin diye.
    if (authorization.yol === 'fiyat' && userId) {
      void modeliKisiyeAc(userId, 'gemini', requestedModel);
    }

    // Hedef URL artık istenen modelle kuruluyor (önceden gemini-pro'ya sabitlenmişti).
    await forwardToProvider({
      body: request.body,
      reply,
      clientId,
      keyId,
      userId,
      provider: 'gemini',
      model: requestedModel
    });
  });
}

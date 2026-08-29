import type { FastifyInstance } from 'fastify';
import { forwardToProvider } from '../core/proxyForward.js';
import { authorizeModel } from '../core/modelAuthorization.js';
import { logDeniedRequest } from '../core/logCapture.js';
import { runSecurityChain } from '../core/security.js';

export async function openaiRoutes(server: FastifyInstance) {
  server.post('/v1/openai/chat/completions', async (request, reply) => {
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
    const allowedModels = security.allowedModels;

    const body = request.body as { model?: string } | undefined;
    const requestedModel = body?.model;
    if (!requestedModel) {
      return reply.status(400).send({ error: "The 'model' field is required in the request body." });
    }

    const authorization = await authorizeModel('openai', requestedModel, allowedModels);
    if (!authorization.ok) {
      void logDeniedRequest(clientId, 'openai', requestedModel, authorization.error);
      return reply.status(authorization.status).send({ error: authorization.error });
    }

    await forwardToProvider({
      body: request.body,
      reply,
      clientId,
      provider: 'openai',
      model: requestedModel
    });
  });
}

import type { FastifyReply } from 'fastify';
import { logRequestStart, logRequestComplete } from './logCapture.js';
import { waitUntil } from '@vercel/functions';
import { buildProviderTarget, prepareBodyForProvider, type ProviderName } from './providerConfig.js';

interface ForwardOptions {
  body: unknown;
  reply: FastifyReply;
  clientId: string;
  provider: ProviderName;
  model: string;
}

// Token alanları sağlayıcıya ve moda göre farklı yerlerde duruyor.
// Anthropic streaming'de input_tokens `message_start` olayında `message.usage` altında,
// output_tokens ise `message_delta` olayında `usage` altında gelir.
// OpenAI streaming'de usage yalnızca istekte `stream_options.include_usage` varsa gelir.
function extractInputTokens(provider: ProviderName, data: any): number | undefined {
  if (provider === 'openai') return data?.usage?.prompt_tokens;
  if (provider === 'gemini') return data?.usageMetadata?.promptTokenCount;
  return data?.usage?.input_tokens ?? data?.message?.usage?.input_tokens;
}

function extractOutputTokens(provider: ProviderName, data: any): number | undefined {
  if (provider === 'openai') return data?.usage?.completion_tokens;
  if (provider === 'gemini') return data?.usageMetadata?.candidatesTokenCount;
  return data?.usage?.output_tokens ?? data?.message?.usage?.output_tokens;
}

export async function forwardToProvider({ body, reply, clientId, provider, model }: ForwardOptions) {
  const startTime = Date.now();
  const isStreaming = (body as { stream?: boolean } | undefined)?.stream === true;

  // wf-ortak §5: istek başlarken `pending` kaydı açılır.
  // Bilerek await ETMİYORUZ — kayıt işlemi isteğin önüne geçmesin (düşük overhead).
  const pendingLog = logRequestStart(clientId, provider, model);

  // Log'u kapatan tek nokta. Yanıtı geciktirmiyor ama kaybolmuyor da.
  //
  // Önceden yalnızca `void` ile arkaya bırakılıyordu. Sürekli çalışan bir
  // sunucuda bu doğru; sunucusuz ortamda değil — Vercel yanıt gönderildiği an
  // fonksiyonu dondurabiliyor ve tamamlama yazımı hiç çalışmıyordu. Canlıda
  // bazı kayıtlar `pending` olarak kalıyordu.
  //
  // waitUntil, yanıtı beklet MEDEN fonksiyonun kapanışını arkadaki iş bitene
  // kadar erteliyor. Vercel dışında (yerelde) çağrı sessizce başarısız olur,
  // orada zaten süreç kapanmadığı için `void` davranışı yeterli.
  const finishLog = (
    isSuccess: boolean,
    inputTokens: number | undefined,
    outputTokens: number | undefined,
    errorMessage?: string
  ) => {
    const latencyMs = Date.now() - startTime;
    const yazma = pendingLog
      .then((logId) => {
        if (!logId) return;
        return logRequestComplete(
          logId,
          provider,
          model,
          inputTokens ?? 0,
          outputTokens ?? 0,
          latencyMs,
          isSuccess,
          errorMessage
        );
      })
      .catch(() => {
        // Loglama hiçbir koşulda asıl isteği etkilememeli.
      });

    try {
      waitUntil(yazma);
    } catch {
      // Vercel dışında çalışıyoruz; süreç kapanmadığı için ek bir şey gerekmiyor.
    }
  };

  let response: Response;
  try {
    const target = buildProviderTarget(provider, model, isStreaming);
    response = await fetch(target.url, {
      method: 'POST',
      headers: target.headers,
      body: JSON.stringify(prepareBodyForProvider(provider, body))
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    finishLog(false, undefined, undefined, `Provider could not be reached: ${detail}`);
    return reply.status(502).send({ error: 'Could not reach the provider.' });
  }

  const contentType = response.headers.get('content-type');

  // Sağlayıcı hata döndüyse: durum kodunu ve gövdeyi olduğu gibi aktarıyoruz.
  // Bu kontrol, SSE başlıkları yazılmadan ÖNCE olmalı — yoksa hata gövdesi
  // akış sanılarak client'a stream olarak geçer.
  if (!response.ok) {
    const rawBody = await response.text();
    finishLog(false, undefined, undefined, `Provider returned ${response.status}.`);
    reply.status(response.status);
    if (contentType) reply.header('content-type', contentType);
    return reply.send(rawBody);
  }

  if (!isStreaming) {
    // Gövdeyi metin olarak okuyup olduğu gibi geçiriyoruz (pass-through).
    // JSON.parse yalnızca token okumak için, ve hata verirse istek bozulmuyor.
    const rawBody = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = undefined;
    }

    finishLog(true, extractInputTokens(provider, parsed), extractOutputTokens(provider, parsed));
    reply.status(response.status);
    if (contentType) reply.header('content-type', contentType);
    return reply.send(rawBody);
  }

  // --- Streaming (SSE) ---
  // hijack(): yanıtı doğrudan biz yöneteceğiz, Fastify bu reply'a bir daha dokunmayacak.
  // Bu olmadan, akış başladıktan sonra oluşan bir hata Fastify'ı başlıkları yeniden
  // yazmaya zorluyor ve ERR_HTTP_HEADERS_SENT ile süreç komple çöküyordu.
  reply.hijack();
  const raw = reply.raw;
  raw.on('error', () => {
    // Kopmuş bir sokete yazma girişimi süreci düşürmesin.
  });

  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const reader = response.body?.getReader();
  if (!reader) {
    finishLog(false, undefined, undefined, 'The provider returned no readable body.');
    raw.end();
    return;
  }

  // Client giderse sağlayıcıdan veri çekmeyi bırak — gerçek anahtarla bu doğrudan maliyet.
  let clientGone = false;
  raw.on('close', () => {
    clientGone = true;
    void reader.cancel().catch(() => {});
  });

  const decoder = new TextDecoder();
  let lineBuffer = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let streamError: string | undefined;

  const readSseLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') return;
    try {
      const parsed = JSON.parse(payload);
      const nextInput = extractInputTokens(provider, parsed);
      const nextOutput = extractOutputTokens(provider, parsed);
      if (nextInput !== undefined) inputTokens = nextInput;
      if (nextOutput !== undefined) outputTokens = nextOutput;
    } catch {
      // Bu satır geçerli bir JSON değil; token okumak açısından atlanabilir.
    }
  };

  const drainCompleteLines = () => {
    let newlineIndex = lineBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      readSseLine(lineBuffer.slice(0, newlineIndex).trimEnd());
      lineBuffer = lineBuffer.slice(newlineIndex + 1);
      newlineIndex = lineBuffer.indexOf('\n');
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (clientGone) break;

      // Client'a HAM byte yazıyoruz. Decode edip string yazmak, çok baytlı bir karakter
      // chunk sınırına denk geldiğinde onu bozuyordu (ş -> ��).
      raw.write(value);

      // Decode yalnızca token okumak için; { stream: true } yarım kalan baytı bir sonraki
      // parçaya taşır. Satır tamponu da bölünmüş `data:` satırlarını kurtarır — usage
      // bilgisi genelde son parçada geldiği için bu doğrudan Aşama 4'ün doğruluğu demek.
      lineBuffer += decoder.decode(value, { stream: true });
      drainCompleteLines();
    }

    lineBuffer += decoder.decode();
    drainCompleteLines();
    if (lineBuffer.trim() !== '') readSseLine(lineBuffer.trim());
  } catch (err) {
    streamError = err instanceof Error ? err.message : 'unknown error';
  }

  if (!clientGone && !raw.writableEnded) raw.end();

  if (clientGone) {
    finishLog(false, inputTokens, outputTokens, 'The client closed the connection.');
  } else if (streamError) {
    // Ham çalışma zamanı metni tek başına anlamsız kalıyor ('terminated' gibi);
    // neyin koptuğunu söyleyen bir bağlam ekliyoruz.
    finishLog(false, inputTokens, outputTokens,
      `The response stream failed: ${streamError}`);
  } else {
    finishLog(true, inputTokens, outputTokens);
  }
}

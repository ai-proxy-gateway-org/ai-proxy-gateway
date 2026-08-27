import Fastify from 'fastify';
import type { FastifyReply } from 'fastify';

const mockServer = Fastify({ logger: false });

// Sunum için: sağlayıcıya TAM olarak neyin ulaştığını göster. Pass-through'un
// tek görünür kanıtı bu — gövdeye dokunulmadığı ancak burada görülebiliyor.
mockServer.addHook('preHandler', async (request) => {
  const h = request.headers as Record<string, string | undefined>;
  const kimlik = h.authorization
    ? `authorization: Bearer ${h.authorization.slice(7, 17)}...`
    : h['x-api-key']
      ? `x-api-key: ${h['x-api-key'].slice(0, 10)}...`
      : h['x-goog-api-key']
        ? `x-goog-api-key: ${h['x-goog-api-key'].slice(0, 10)}...`
        : '(anahtar yok)';
  const surum = h['anthropic-version'] ? `  anthropic-version: ${h['anthropic-version']}` : '';

  console.log('\n\x1b[33m┌─ SAĞLAYICIYA ULAŞAN İSTEK ─────────────────────────\x1b[0m');
  console.log(`\x1b[33m│\x1b[0m ${request.method} ${request.url}`);
  console.log(`\x1b[33m│\x1b[0m ${kimlik}${surum}`);
  console.log(`\x1b[33m│\x1b[0m gövde: ${JSON.stringify(request.body)}`);
  console.log('\x1b[33m└────────────────────────────────────────────────────\x1b[0m');
});

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive'
} as const;

// Mutlu yol dışındaki durumları da deneyebilmek için istek gövdesine `_mock` alanı
// konur. Proxy client header'larını iletmediği için bayrağı gövdeden taşıyoruz.
type MockScenario = 'rate_limit' | 'html_error' | 'stream_abort' | 'utf8_split';

/**
 * Senaryo tanımlıysa yanıtı burada üretip true döner; aksi halde false döner
 * ve çağıran normal (mutlu yol) akışına devam eder.
 */
function handleMockScenario(
  scenario: MockScenario | undefined,
  reply: FastifyReply,
  usageChunk: unknown
): boolean {
  if (!scenario) return false;

  // Sağlayıcı hız limiti — proxy'nin durum kodunu aynen aktarması beklenir.
  if (scenario === 'rate_limit') {
    reply.status(429).send({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } });
    return true;
  }

  // Sağlayıcı/gateway JSON değil HTML döndürüyor — proxy çökmemeli, gövdeyi aynen geçirmeli.
  if (scenario === 'html_error') {
    reply.status(502).header('content-type', 'text/html').send('<html><body>502 Bad Gateway</body></html>');
    return true;
  }

  // Akış başladıktan sonra sağlayıcı bağlantıyı koparıyor — proxy ayakta kalmalı.
  if (scenario === 'stream_abort') {
    reply.hijack();
    reply.raw.writeHead(200, SSE_HEADERS);
    reply.raw.write('data: {"delta":{"text":"yarim kalan"}}\n\n');
    setTimeout(() => reply.raw.destroy(), 100);
    return true;
  }

  // Çok baytlı bir karakter (ş) iki ayrı TCP write'ına bölünüyor.
  // Proxy ham byte aktarmazsa client tarafında bozuluyordu.
  reply.hijack();
  reply.raw.writeHead(200, SSE_HEADERS);
  const line = Buffer.from('data: {"delta":{"text":"şğü Türkçe akış"}}\n\n', 'utf8');
  const splitAt = line.indexOf(Buffer.from('ş', 'utf8')) + 1; // 'ş'in tam ortası
  reply.raw.write(line.subarray(0, splitAt));
  setTimeout(() => {
    reply.raw.write(line.subarray(splitAt));
    reply.raw.write(`data: ${JSON.stringify(usageChunk)}\n\n`);
    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
  }, 100);
  return true;
}

async function streamWords(reply: FastifyReply, words: string[], chunkFor: (word: string) => unknown, usageChunk: unknown) {
  reply.hijack();
  reply.raw.writeHead(200, SSE_HEADERS);

  for (const word of words) {
    reply.raw.write(`data: ${JSON.stringify(chunkFor(word + ' '))}\n\n`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  reply.raw.write(`data: ${JSON.stringify(usageChunk)}\n\n`);
  reply.raw.write('data: [DONE]\n\n');
  reply.raw.end();
}

// ----------------------------- OpenAI -----------------------------

const OPENAI_USAGE = {
  id: 'mock-chatcmpl-123',
  object: 'chat.completion.chunk',
  choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 }
};

mockServer.post('/v1/chat/completions', async (request, reply) => {
  const body = request.body as {
    messages?: { role: string; content: string }[];
    stream?: boolean;
    _mock?: MockScenario;
  };

  if (handleMockScenario(body?._mock, reply, OPENAI_USAGE)) return;

  const lastMessage = body?.messages?.[body.messages.length - 1]?.content ?? 'merhaba';

  if (!body?.stream) {
    return {
      id: 'mock-chatcmpl-123',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: `Bu sahte bir cevaptır. Sen şunu sordun: "${lastMessage}"` },
          finish_reason: 'stop'
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 }
    };
  }

  await streamWords(
    reply,
    `Bu bir streaming cevabıdır. Sen şunu sordun: "${lastMessage}"`.split(' '),
    (text) => ({
      id: 'mock-chatcmpl-123',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4o-mini',
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
    }),
    OPENAI_USAGE
  );
});

// ----------------------------- Gemini -----------------------------

const GEMINI_USAGE = {
  candidates: [{ content: { parts: [], role: 'model' }, finishReason: 'STOP', index: 0 }],
  usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 12, totalTokenCount: 20 }
};

// Gerçek Gemini uç noktası: /v1beta/models/{model}:generateContent
// veya streaming için /v1beta/models/{model}:streamGenerateContent?alt=sse
mockServer.post('/v1beta/models/:target', async (request, reply) => {
  const target = (request.params as { target: string }).target;
  const isStreaming = target.endsWith(':streamGenerateContent');

  const body = request.body as {
    contents?: { role: string; parts: { text: string }[] }[];
    _mock?: MockScenario;
  };

  if (handleMockScenario(body?._mock, reply, GEMINI_USAGE)) return;

  const lastPart = body?.contents?.[body.contents.length - 1]?.parts?.[0]?.text ?? 'merhaba';

  if (!isStreaming) {
    return {
      candidates: [
        {
          content: {
            parts: [{ text: `Bu sahte bir Gemini cevabıdır. Sen şunu sordun: "${lastPart}"` }],
            role: 'model'
          },
          finishReason: 'STOP',
          index: 0
        }
      ],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 12, totalTokenCount: 20 }
    };
  }

  await streamWords(
    reply,
    `Bu bir Gemini streaming cevabıdır. Sen şunu sordun: "${lastPart}"`.split(' '),
    (text) => ({
      candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: null, index: 0 }]
    }),
    GEMINI_USAGE
  );
});

// ---------------------------- Anthropic ----------------------------

// Gerçek Anthropic streaming'inde input_tokens `message_start` olayında
// `message.usage` altında, output_tokens ise `message_delta` olayında gelir.
const ANTHROPIC_MESSAGE_START = {
  type: 'message_start',
  message: { id: 'mock-msg-123', role: 'assistant', usage: { input_tokens: 9, output_tokens: 0 } }
};

const ANTHROPIC_USAGE = {
  type: 'message_delta',
  delta: { stop_reason: 'end_turn' },
  usage: { output_tokens: 14 }
};

mockServer.post('/v1/messages', async (request, reply) => {
  const body = request.body as {
    messages?: { role: string; content: string }[];
    stream?: boolean;
    _mock?: MockScenario;
  };

  if (handleMockScenario(body?._mock, reply, ANTHROPIC_USAGE)) return;

  const lastMessage = body?.messages?.[body.messages.length - 1]?.content ?? 'merhaba';

  if (!body?.stream) {
    return {
      id: 'mock-msg-123',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4',
      content: [{ type: 'text', text: `Bu sahte bir Claude cevabıdır. Sen şunu sordun: "${lastMessage}"` }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 9, output_tokens: 14 }
    };
  }

  reply.hijack();
  reply.raw.writeHead(200, SSE_HEADERS);
  reply.raw.write(`data: ${JSON.stringify(ANTHROPIC_MESSAGE_START)}\n\n`);

  for (const word of `Bu bir Claude streaming cevabıdır. Sen şunu sordun: "${lastMessage}"`.split(' ')) {
    reply.raw.write(
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: word + ' ' } })}\n\n`
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  reply.raw.write(`data: ${JSON.stringify(ANTHROPIC_USAGE)}\n\n`);
  reply.raw.write('data: [DONE]\n\n');
  reply.raw.end();
});

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

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const mockApp = new Hono();

mockApp.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const model = body.model || 'gpt-4o-mini';
  console.log(`[Mock Provider] OpenAI/Gemini compatible call -> model: ${model}`);
  return c.json({
    id: `chatcmpl-mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: `[Mock response from ${model}] Hello! Your request passed through AI Proxy Gateway.`,
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 },
  });
});

mockApp.post('/v1/messages', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const model = body.model || 'claude-sonnet-4-20250514';
  console.log(`[Mock Provider] Anthropic call -> model: ${model}`);
  return c.json({
    id: `msg_mock_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [
      {
        type: 'text',
        text: `[Mock response from ${model}] Hello! Your request passed through AI Proxy Gateway.`,
      },
    ],
    usage: { input_tokens: 14, output_tokens: 20, prompt_tokens: 14, completion_tokens: 20 },
  });
});

mockApp.post('/v1beta/openai/chat/completions', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const model = body.model || 'gemini-2.5-flash';
  console.log(`[Mock Provider] Gemini call -> model: ${model}`);
  return c.json({
    id: `gemini-mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: `[Mock response from ${model}] Hello! Your request passed through AI Proxy Gateway.`,
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 16, total_tokens: 26 },
  });
});

const port = 4000;
serve({ fetch: mockApp.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`\nMock AI Provider running at http://127.0.0.1:${port}`);
  console.log('Simulates OpenAI (/v1/chat/completions), Anthropic (/v1/messages), and Gemini (/v1beta/openai/chat/completions).\n');
});

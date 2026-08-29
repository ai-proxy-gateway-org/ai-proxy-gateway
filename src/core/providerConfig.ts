// Sağlayıcıya özgü her şey (hedef adres + gerçek API anahtarı başlıkları) tek yerde.
// wf-ortak §3: "Kontrolden geçen istekler, Provider Adapter katmanlarında ilgili
// sağlayıcının gerçek API anahtarı eklenerek hedefe iletilir."
//
// Hedef adres varsayılan olarak sağlayıcının gerçek adresidir. Geliştirmede mock
// sunucuya yönlendirmek için ilgili BASE_URL değişkeni açıkça verilir.
//
// Önceden tersi geçerliydi: değişken boşsa mock'a düşülüyordu. Yerelde kolaylık
// sağlıyordu ama üretimde sessiz bir tuzak: Vercel'de localhost:4000 diye bir
// sunucu yok, bütün istekler bağlantı hatasıyla düşerdi. Varsayılanın güvenli
// tarafı, unutulduğunda çalışan taraf olmalı.

export type ProviderName = 'openai' | 'gemini' | 'anthropic';

const GERCEK_ADRESLER: Record<ProviderName, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com'
};

// Anthropic'in zorunlu tuttuğu API sürümü başlığı.
const ANTHROPIC_VERSION = '2023-06-01';

// .env dosyalarında değişkenler sık sık `NAME=` şeklinde boş bırakılır. Boş metin
// `??` için geçerli bir değer olduğundan, tanımsız saymak için ayrıca kontrol ediyoruz.
function envOrUndefined(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

function baseUrlFor(provider: ProviderName): string {
  const degisken = provider === 'openai' ? 'OPENAI_BASE_URL'
    : provider === 'gemini' ? 'GEMINI_BASE_URL'
    : 'ANTHROPIC_BASE_URL';
  return envOrUndefined(degisken) ?? GERCEK_ADRESLER[provider];
}

export interface ProviderTarget {
  url: string;
  headers: Record<string, string>;
}

export function buildProviderTarget(
  provider: ProviderName,
  model: string,
  isStreaming: boolean
): ProviderTarget {
  const baseUrl = baseUrlFor(provider);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (provider === 'openai') {
    const apiKey = envOrUndefined('OPENAI_API_KEY');
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    return { url: `${baseUrl}/v1/chat/completions`, headers };
  }

  if (provider === 'anthropic') {
    const apiKey = envOrUndefined('ANTHROPIC_API_KEY');
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
    return { url: `${baseUrl}/v1/messages`, headers };
  }

  // Gemini streaming'i gövdedeki bir alanla değil, ayrı bir uç nokta ile ifade eder.
  const apiKey = envOrUndefined('GEMINI_API_KEY');
  if (apiKey) headers['x-goog-api-key'] = apiKey;
  const action = isStreaming ? 'streamGenerateContent?alt=sse' : 'generateContent';
  return { url: `${baseUrl}/v1beta/models/${model}:${action}`, headers };
}

// Pass-through yaklaşımı gereği gövdeye dokunmuyoruz. Tek istisna Gemini:
// `stream` alanı gerçek Gemini API'sinde yok, bizim uç nokta seçimimiz için
// kullanılan bir bayrak. Olduğu gibi iletirsek sağlayıcı bilinmeyen alan diye reddeder.
export function prepareBodyForProvider(provider: ProviderName, body: unknown): unknown {
  if (provider !== 'gemini') return body;
  if (typeof body !== 'object' || body === null) return body;

  const { stream: _stream, ...rest } = body as Record<string, unknown>;
  return rest;
}

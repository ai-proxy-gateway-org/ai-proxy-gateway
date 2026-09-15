// Sahte kasa (mock vault) — Umur'un gerçek vault servisi henüz canlıya
// taşınmadığı için, yerelde gerçek bir AI isteğinin uçtan uca (giriş →
// gateway → kasa → sağlayıcı) çalıştığını test edebilmek için geçici bir
// yerine geçen sunucu.
//
// src/utils/vault.ts'in beklediği tek şey: GET /keys/:provider isteğine
// { apiKey: "..." } dönmesi, doğru Authorization başlığıyla. Gerçek bir
// sağlayıcı anahtarı DEĞİL — sahte bir değer dönüyor, o yüzden asıl AI
// çağrısı (OpenAI/Anthropic'e giden kısım) yine başarısız olur ama buraya
// kadarki her adımı (kimlik doğrulama, log yazma, kasadan anahtar çekme)
// doğrulamamızı sağlar.
//
// Kalıcı çözüm değil: Umur'un gerçek vault'unu deploy etmesi gerekiyor.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const app = new Hono();
const beklenenJeton = process.env.VAULT_ACCESS_TOKEN || 'mock_token';

app.get('/keys/:provider', (c) => {
  const baslik = c.req.header('authorization');
  if (baslik !== `Bearer ${beklenenJeton}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const provider = c.req.param('provider');
  console.log(`[sahte kasa] ${provider} için anahtar istendi`);
  return c.json({ apiKey: `sk-mock-${provider}-not-a-real-key` });
});

const port = 4000;
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`\nSahte kasa (mock vault) http://127.0.0.1:${port} adresinde çalışıyor`);
  console.log('Gerçek anahtar değil — sadece kasadan-anahtar-çekme adımını test etmek için.\n');
});

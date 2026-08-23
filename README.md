# AI Proxy Gateway

Şirketin yapay zeka sağlayıcı anahtarlarını istemcilerle paylaşmadan, tek bir kapıdan
güvenli erişim sağlayan proxy servisi. İstemciler (Client) kendi proxy anahtarlarıyla
bu servise istek gönderir; servis güvenlik kontrollerini yapıp isteği ilgili sağlayıcıya
şirketin gerçek anahtarıyla iletir, yanıtı olduğu gibi geri akıtır ve kullanımı kaydeder.

**Bu dosyanın kapsamı:** sistemin mimarisi, veri akışı, alınan tasarım kararları ve
gerekçeleri, güvenlik katmanları, yerel geliştirme talimatları ve **henüz tamamlanmamış
kısımların dürüst listesi**.

---

## 1. Teknoloji seçimleri

| Katman | Seçim | Gerekçe |
|---|---|---|
| Dil / çalışma ortamı | TypeScript + Node.js | Ekip yetkinliği; `fetch` ve `ReadableStream` gibi akış API'leri yerleşik |
| HTTP çatısı | Fastify 5 | Düşük overhead — proxy'de her milisaniye isteğe eklenir. `reply.raw` ile ham akış kontrolü sağlıyor |
| Kalıcı veri | PostgreSQL (Supabase) | `clients`, `client_keys`, `logs` tabloları |
| Geçici bellek | Redis (Upstash) | Rate limit sayaçları — `INCR` + `TTL` |
| Dağıtım | Vercel Serverless Functions | Kullanıcıya yakın uçta çalıştırma, ölçeklenme yönetimi gerektirmiyor |

---

## 2. Mimari

Bir isteğin sistem içindeki yolculuğu. Mor çerçeveli kutular köprü katmanı (A tarafı),
gri olanlar kalkan katmanı (B tarafı). Kesikli oklar yanıtı bekletmeyen kayıt yazımları.

```mermaid
flowchart TD
    C(["İstemci isteği<br/>sk-proxy anahtarı + origin"]) --> K1

    K1["1 · Kimlik doğrulama<br/>anahtar özeti veritabanıyla karşılaştırılır"]
    K1 --> K2
    K1 -.-> R1(["401 · 403"])

    K2["2 · Domain kontrolü<br/>yalnızca tarayıcı tabanlı istemcilere"]
    K2 --> K3
    K2 -.-> R2(["403"])

    K3["3 · Hız limiti<br/>Redis sayaçları"]
    K3 --> M
    K3 -.-> R3(["429"])

    M["4 · Model yetkisi<br/>katalog, sonra istemcinin izinli listesi"]
    M --> F
    M -.-> R4(["400 · 403"])

    F["5 · Sağlayıcıya iletim<br/>gerçek API anahtarı eklenir, gövdeye dokunulmaz"]
    F --> P
    F -.-> R5(["502"])
    F -.-> L1[("logs · pending kaydı")]

    P(["Yapay zeka servisi<br/>OpenAI · Anthropic · Gemini"]) --> Y

    Y["6 · Yanıt aktarımı<br/>ham byte olarak, parça parça"]
    Y --> OUT(["İstemciye yanıt · 200"])
    Y -.-> L2[("logs · token, süre, maliyet")]

    classDef kopru stroke:#5b63d3,stroke-width:2.5px
    classDef red stroke:#c0504a,color:#c0504a
    classDef kayit stroke-dasharray:4 3

    class M,F,Y kopru
    class R1,R2,R3,R4,R5 red
    class L1,L2 kayit
```

Kontrollerin sırası bilinçli: en ucuz ve en kesin olan önce çalışıyor. Kimliği
doğrulanmamış bir isteğin model listesini sorgulamanın anlamı yok. Reddedilen istek
sağlayıcıya hiç ulaşmıyor.

### Dosya sorumlulukları

| Dosya | Görevi |
|---|---|
| `src/app.ts` | Fastify örneğini kurar, route'ları kaydeder, `/health` uç noktası |
| `src/server.ts` | Yerel geliştirme sunucusu (port 3000) |
| `api/index.ts` | Vercel giriş noktası — aynı uygulamayı serverless fonksiyon olarak sarar |
| `src/routes/*.ts` | Provider Adapter'lar: sağlayıcıya özgü yol ve model konumu |
| `src/core/security.ts` | Güvenlik zinciri; B tarafının middleware'lerine açılan seam |
| `src/core/modelAuthorization.ts` | İki katmanlı model erişim kontrolü |
| `src/core/modelCatalog.ts` | Tanınan modelleri `model_pricing.json`'dan okur |
| `src/core/proxyForward.ts` | Sağlayıcıya iletim, SSE akışı, token/süre/başarı ölçümü |
| `src/core/providerConfig.ts` | Hedef adres ve gerçek API anahtarı başlıkları |
| `src/core/logCapture.ts` | Log servisine açılan seam (iki fazlı) |
| `src/core/localOrigins.ts` | `localhost` / `127.0.0.1` tanıma, porttan bağımsız |
| `mock-server/` | Gerçek anahtar olmadan test için sahte sağlayıcı |

---

## 3. Veri akışı

Bir isteğin baştan sona yolculuğu ve her adımda dönebilecek yanıtlar:

```
1. Client isteği gelir
   Authorization: Bearer sk-proxy-...
   Origin: https://app.company.com
        │
2. Kimlik doğrulama (verifyClient)
   Anahtar SHA-256'lanıp client_keys tablosuyla karşılaştırılır
   ✗ 401  anahtar biçimi geçersiz / kayıtlı değil
   ✗ 403  client veya anahtar devre dışı
        │
3. Domain kontrolü (checkDomainWhitelist)
   Yalnızca browser-based client'lara uygulanır; server-based atlanır
   localhost / 127.0.0.1 porttan bağımsız kabul edilir
   ✗ 403  yetkisiz domain
        │
4. Hız limiti (checkRateLimit)
   Redis INCR + TTL, client başına pencere sayacı
   ✗ 429  limit aşıldı
        │
5. Model yetkilendirme (authorizeModel)
   ✗ 400  model belirtilmemiş / katalogda yok
   ✗ 403  bu client bu modeli kullanamaz
        │
6. pending log kaydı açılır (await edilmez)
        │
7. Sağlayıcıya iletim (proxyForward)
   Gerçek API anahtarı başlığı eklenir, gövde olduğu gibi geçirilir
   ✗ 502  sağlayıcıya ulaşılamadı
   ✗ 4xx/5xx  sağlayıcının kodu ve gövdesi aynen aktarılır
        │
8. Yanıt Client'a döner
   Normal: gövde ham metin olarak geçirilir
   Stream: SSE parçaları ham byte olarak akıtılır
        │
9. Log tamamlanır (await edilmez)
   input/output token · latency · success/error → cost hesaplanır
```

Kritik nokta: **6 ve 9 asla ana yanıtı bekletmez.** Log yazımı `void` ile başlatılır,
hata verse bile isteği etkilemez. wf-ortak §5'in "non-blocking" şartı bu şekilde karşılanır.

---

## 4. Uç nokta yapısı ve neden pass-through

İstekler ortak bir formata **çevrilmez**. Client, sağlayıcının kendi gövde formatını
kullanır ve proxy yalnızca güvenlik + kayıt katmanı ekler.

```
POST /v1/openai/chat/completions     →  {base}/v1/chat/completions
POST /v1/anthropic/messages          →  {base}/v1/messages
POST /v1/gemini/models/{model}       →  {base}/v1beta/models/{model}:generateContent
                                        (stream ise :streamGenerateContent?alt=sse)
```

**Neden ortak format değil:** Sağlayıcılar yeni alan ve yetenek eklediğinde (araç
kullanımı, görsel girdi, düşünme blokları) ortak formatın da güncellenmesi gerekir.
Pass-through ile proxy bu değişikliklerden etkilenmez; client sağlayıcının resmi
SDK'sını `baseURL` değiştirerek kullanabilir.

**Neden her sağlayıcı için tek uç, catch-all değil:** wf-rol örneklerinde `/v1/openai/*`
yazıyor, ancak sağlayıcının tüm uç nokta alanını körü körüne açmak ciddi bir açık
oluşturur — client OpenAI'nin dosya yönetimi, fine-tuning veya organizasyon ayarları
uçlarına erişebilirdi. Bu, wf-ortak §4'ün model erişiminde yasakladığı wildcard
mantığının aynısıdır. Bu yüzden **açık uç nokta listesi** tercih edildi; yeni uç
ihtiyaç oldukça bilinçli olarak eklenir.

**Tek istisna — Gemini:** Gövdedeki `stream` alanı ayıklanır. Gerçek Gemini API'sinde
böyle bir alan yok; akış ayrı bir uç nokta (`:streamGenerateContent`) ile ifade edilir.
Alan olduğu gibi iletilse sağlayıcı bilinmeyen alan diye reddederdi.

---

## 5. Güvenlik önlemleri

**Sağlayıcı anahtarları asla client'a ulaşmaz.** Anahtarlar yalnızca sunucu tarafında,
ortam değişkenlerinden okunur ve isteğe `providerConfig.ts` içinde eklenir:

| Sağlayıcı | Başlık |
|---|---|
| OpenAI | `Authorization: Bearer <key>` |
| Anthropic | `x-api-key: <key>` + `anthropic-version` |
| Gemini | `x-goog-api-key: <key>` |

**Client anahtarları düz metin saklanmaz.** `sk-proxy-<random>` biçiminde üretilir,
veritabanında SHA-256 özeti tutulur.

**Client başına bağımsız kontroller:** hangi sağlayıcılar, hangi modeller, hangi
domainler, hangi hız limitleri — ve gerektiğinde tüm erişimin kapatılması (`is_active`).

**Hata gövdeleri sızdırılmaz.** Sağlayıcıya ulaşılamadığında client'a genel bir mesaj
döner; ayrıntı yalnızca log tarafına yazılır.

**İstemci bağlantısı kesilirse sağlayıcıdan veri çekme durur** (`reader.cancel()`).
Bu bir güvenlik değil maliyet önlemi: kopmuş bir istek için sağlayıcıya ödeme yapılmaz.

---

## 6. Streaming (SSE)

Uzun yanıtlar bekletilmez; sağlayıcının akışı parça parça client'a geçirilir. Bu
katmanda alınmış dört karar ve gerekçeleri:

**`reply.hijack()` kullanılıyor.** Akış `reply.raw` üzerinden doğrudan yazıldığı için
Fastify'ın yanıtı yönetmesi devre dışı bırakılır. Bu olmadan, akış başladıktan sonra
oluşan bir hata Fastify'ı başlıkları yeniden yazmaya zorluyor ve `ERR_HTTP_HEADERS_SENT`
yakalanmamış istisnasıyla **tüm Node süreci çöküyordu** — yani tek bir kopan bağlantı
o an bağlı bütün client'ları düşürüyordu.

**Client'a ham byte yazılıyor** (`reply.raw.write(value)`), decode edilmiş metin değil.
Çok baytlı bir karakter chunk sınırına denk geldiğinde parça parça decode etmek onu
bozuyordu (`ş` → `��`). Ayrıca gereksiz bir decode/encode turu da kalkmış oluyor.

**Token okumak için ayrı bir decode var** ve `{ stream: true }` ile yapılıyor; yarım
kalan bayt bir sonraki parçaya taşınır.

**SSE satır tamponu tutuluyor.** `data:` satırları chunk sınırında bölünebiliyor.
Kullanım (`usage`) bilgisi genelde son parçada geldiği için, tampon olmadan token
sayıları kaybolabiliyordu.

**Sağlayıcı hatası akışa karıştırılmaz.** SSE başlıkları yazılmadan önce
`response.ok` kontrol edilir; hata varsa normal JSON yanıtı ve doğru durum kodu döner.

---

## 7. Loglama ve maliyet

Kayıt iki fazlı çalışır (wf-ortak §5):

```
İstek başlar   →  logRequestStart(clientId, provider, model)     →  status: 'pending'
Yanıt biter    →  logRequestComplete(logId, ..., isSuccess)      →  status: 'success' | 'error'
                                                                     + cost hesaplanır
```

**İş bölümü:** Token sayılarını, gecikmeyi ve başarı durumunu yakalamak A tarafının
işi; `pending` kaydını açmak, `model_pricing.json` üzerinden maliyeti hesaplamak ve
kaydı güncellemek B tarafının işi.

Token alanları sağlayıcıya ve moda göre farklı yerlerde bulunur:

| Sağlayıcı | Girdi | Çıktı |
|---|---|---|
| OpenAI | `usage.prompt_tokens` | `usage.completion_tokens` |
| Gemini | `usageMetadata.promptTokenCount` | `usageMetadata.candidatesTokenCount` |
| Anthropic (normal) | `usage.input_tokens` | `usage.output_tokens` |
| Anthropic (stream) | `message_start` → `message.usage.input_tokens` | `message_delta` → `usage.output_tokens` |

Not: OpenAI akışında `usage` yalnızca istekte `stream_options: { include_usage: true }`
gönderildiyse gelir.

**Maliyet formülü** (`provider/model` anahtarıyla):
```
cost = (inputTokens / 1000) × fiyat.input + (outputTokens / 1000) × fiyat.output
```

Gerçek ölçüm — Supabase `logs` tablosundan:

```
provider   model                in  out  cost        latency  status
openai     gpt-4o               10   15  $0.000275   12ms     success
anthropic  claude-3-5-sonnet     9   14  $0.000237   1096ms   success
```

**Sağlayıcı adı bilerek `anthropic`,** `claude` değil. Maliyet anahtarı
`${provider}/${model}` biçiminde kurulduğu ve fiyat dosyası `anthropic/...` ile
başladığı için, `claude` gönderildiğinde eşleşme olmuyor ve maliyet **sessizce $0**
hesaplanıyordu.

---

## 8. Model yetkilendirme — neden iki katman

```
1. KATALOG   Bu model sistemde tanımlı mı?     kaynak: model_pricing.json
2. YETKİ     Bu client bu modeli kullanabilir mi?   kaynak: client kaydı
```

İkisinin ayrı olması bir tercih değil, zorunluluk: katalogdaki her modeli herkese
açmak fiilen wildcard erişim olurdu ve wf-ortak §4 bunu açıkça yasaklıyor
("wildcard (`*`) erişimi kullanılmaz; böylece yeni ve pahalı modellere kontrolsüz
erişim engellenir"). Fiyat dosyasına yeni bir model eklendiğinde tüm client'lar ona
erişemez; erişim ayrıca tanımlanmalıdır.

Katalog katmanının yan faydası: fiyatı olmayan bir model sisteme hiç giremez, dolayısıyla
maliyeti $0 olarak kaydedilen "görünmez" kullanım oluşmaz.

---

## 9. Yerel geliştirme

```bash
npm install

# 1. terminal — sahte sağlayıcı (gerçek API anahtarı gerekmez)
npm run mock          # http://localhost:4000

# 2. terminal — proxy
npm run dev           # http://localhost:3000
```

Ortam değişkenleri `.env` dosyasına yazılır (`.gitignore` ile korunur):

```
SUPABASE_URL=            SUPABASE_SERVICE_KEY=
UPSTASH_REDIS_REST_URL=  UPSTASH_REDIS_REST_TOKEN=
OPENAI_API_KEY=          ANTHROPIC_API_KEY=        GEMINI_API_KEY=
OPENAI_BASE_URL=         ANTHROPIC_BASE_URL=       GEMINI_BASE_URL=
```

`*_BASE_URL` boş bırakılırsa istekler mock sunucuya gider. Böylece gerçek anahtar
olmadan tüm akış test edilebilir.

### Test client'ı ve anahtarı oluşturma

Kimlik doğrulama gerçek veritabanına karşı çalıştığı için, isteklerde `client_keys`
tablosunda karşılığı bulunan bir anahtar gerekir. Yeni bir client ve anahtar üretmek için
`createNewClient(name, environment)` çağrılır; ürettiği `sk-proxy-...` anahtarı yalnızca
o an gösterilir (veritabanında SHA-256 özeti saklanır).

Client'ın hangi modelleri kullanabileceği `clients.allowed_models` kolonunda tanımlanır:

```sql
update clients
set allowed_models = array['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
    client_type    = 'browser-based',
    allowed_domains = array['company.com']
where name = 'Test - Ayselin';
```

Anahtarı `.env` dosyasına yazıp örneklerde kullanabilirsiniz:

```
TEST_PROXY_KEY=sk-proxy-...
```

### Örnek istekler

```bash
# Normal istek
curl -X POST http://localhost:3000/v1/openai/chat/completions \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TEST_PROXY_KEY" \
  -H 'origin: http://localhost:5173' \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"selam"}]}'

# Streaming
curl -N -X POST http://localhost:3000/v1/anthropic/messages \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TEST_PROXY_KEY" \
  -H 'origin: http://localhost:5173' \
  -d '{"model":"claude-3-5-sonnet","stream":true,"messages":[{"role":"user","content":"selam"}]}'

# Gemini
curl -X POST http://localhost:3000/v1/gemini/models/gemini-1.5-pro \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TEST_PROXY_KEY" \
  -H 'origin: http://localhost:5173' \
  -d '{"contents":[{"role":"user","parts":[{"text":"selam"}]}]}'
```

### Hata senaryolarını test etmek

Mock sunucu, mutlu yol dışındaki durumları da üretebilir. Gövdeye `_mock` alanı eklenir:

| Değer | Simüle ettiği durum | Beklenen davranış |
|---|---|---|
| `rate_limit` | Sağlayıcı 429 döndürür | Proxy 429 ve gövdeyi aynen aktarır |
| `html_error` | Sağlayıcı JSON değil HTML döndürür | Proxy 502 ve gövdeyi aynen aktarır, çökmez |
| `stream_abort` | Akış ortasında bağlantı kopar | Sunucu ayakta kalır, kısmi veri teslim edilir |
| `utf8_split` | Türkçe karakter chunk sınırında bölünür | Metin bozulmadan geçer |

```bash
curl -N -X POST http://localhost:3000/v1/anthropic/messages \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TEST_PROXY_KEY" \
  -H 'origin: http://localhost:5173' \
  -d '{"model":"claude-3-5-sonnet","stream":true,"_mock":"utf8_split","messages":[]}'
```

---

## 10. Bileşenlerin gerçeklik durumu

Sistemin tamamı gerçek servislere bağlıdır; aşağıdaki tablo hangi verinin nereden
geldiğini gösterir.

| Bileşen | Kaynak |
|---|---|
| Kimlik doğrulama | `client_keys` tablosu — anahtar SHA-256'lanıp karşılaştırılır |
| Domain kontrolü | `clients.client_type` + `clients.allowed_domains` |
| Hız limiti | Upstash Redis — `INCR` + `TTL` |
| Model yetkilendirme | `clients.allowed_models` (biçim: `provider/model`) |
| Model kataloğu | `model_pricing.json` |
| Loglama + maliyet | `logs` tablosu — `cost` ve `error_message` dahil |

**Geçici çözümler** — B tarafındaki düzeltmeler beklendiği için fazladan iş yapılıyor,
davranış doğru ancak sadeleştirilebilir:

| Konu | Şu anki çözüm | Beklenen düzeltme |
|---|---|---|
| `verifyClient` yalnızca `(id, name, is_active)` seçiyor | `client_type`, `allowed_domains`, `allowed_models` için ek bir sorgu yapılıyor | Select genişletilirse istek başına bir veritabanı turu azalır |
| `logRequestComplete` hata metni almıyor | `logs.error_message` ayrı bir `update` ile yazılıyor | İmzaya `errorMessage` parametresi eklenmesi |
| Client bazlı hız limiti yok | Tüm client'lar için sabit 60 istek/dakika | `clients` tablosuna dakika/saat/gün limit kolonları |
| Token limiti yok | Yalnızca istek sayısı sınırlanıyor | Harcanan token'ları biriktiren ikinci bir sayaç |

**Henüz yapılmamış:** prompt kaydı (kolon yok, karar verilmedi) ve gerçek sağlayıcıya
bağlantı (API anahtarı sağlanmadı; tüm testler sahte sağlayıcı üzerinden yapıldı).

## 11. Seam yaklaşımı

Proje iki geliştirici tarafından paralel yazıldığı için, karşı tarafın kodunu bekleyen
noktalar **seam** olarak kuruldu: dışa verdikleri arayüz nihai haliyle aynı, içleri
geçici. Birleşmede yalnızca ilgili dosyanın **içi** değişir; çağıran taraf hiç değişmez.

Seam'ler: `logCapture.ts` (log servisi), `security.ts` (üç middleware),
`modelAuthorization.ts` (yetki listesi kaynağı). Üçü de gerçek servislere bağlandı;
bağlama işlemi çağıran tarafta (route'lar, `proxyForward.ts`) hiçbir değişiklik
gerektirmedi — seam yaklaşımının amacı buydu.

Uyumluluk merge beklenmeden doğrulandı: karşı tarafın imzaları `origin/main`'den
çıkarılıp yerel bir vekil modüle yazıldı, çağrı noktaları ona bağlanıp derleme
yapıldı — sıfır hata. Log servisi ayrıca gerçek veritabanına karşı uçtan uca test
edildi (bkz. bölüm 7 ölçümleri).

---

## 12. Rol dağılımı

| Taraf | Sorumluluk | Dosyalar |
|---|---|---|
| **A** — Yönlendirme ve Akış | İsteklerin karşılanması, sağlayıcıya iletim, adaptörler, streaming, ölçüm | `app.ts`, `server.ts`, `api/`, `routes/`, `core/`, `mock-server/` |
| **B** — Güvenlik, Veri, DevOps | Kimlik doğrulama, şemalar, maliyet hesabı, rate limiting, CI/CD | `middleware/`, `services/`, `utils/`, `model_pricing.json` |

---

## 13. Canlı ortam doğrulaması

Sistem gerçek Vercel altyapısında yayına alınıp test edildi. Gerçek sağlayıcı anahtarı
bulunmadığı için, sahte sağlayıcı da ayrı bir Vercel projesi olarak yayınlandı; böylece
zincirin tamamı canlı ortamda ölçüldü:

```
Client → proxy (Vercel) → sahte sağlayıcı (Vercel)
```

**Ölçüm sonuçları:**

| Test | Sonuç |
|---|---|
| `/health` | 200 |
| Normal istek (3 sağlayıcı) | 200 — 0.50s / 0.67s / 1.42s |
| Kimlik doğrulama (anahtar yok) | 401 |
| Domain kontrolü (origin yok / yetkisiz domain) | 403 / 403 |
| Model kontrolü (yetkisiz / eksik) | 400 / 400 |
| **Anthropic streaming** | 10 parça, 1.04 s'ye yayılmış, ortalama 115 ms aralık |
| **OpenAI streaming** | 9 parça, 1.04 s'ye yayılmış, ortalama 130 ms aralık |
| **Gemini streaming** | 9 parça, 1.04 s'ye yayılmış, ortalama 130 ms aralık |
| UTF-8 bütünlüğü (canlı zincir) | `şğü Türkçe` bozulmadan geçti |

**Kritik bulgu:** Vercel serverless fonksiyonları SSE yanıtlarını **tamponlamıyor.**
Parçaların 115-130 ms aralıklarla gelmesi, sahte sağlayıcının parçalar arasına koyduğu
150 ms gecikmeyi yansıtıyor — yani akış uçtan uca gerçek zamanlı aktarılıyor. Bu, zincirde
iki ayrı serverless fonksiyon bulunmasına rağmen geçerli.

Bu doğrulama önemliydi çünkü `api/index.ts` içindeki desen (`app.server.emit('request', ...)`)
handler'ın promise'ini yanıt tamamlanmadan çözüyor; Vercel'in fonksiyonu erken sonlandırıp
akışı kesme riski vardı. Kesmiyor.

---

## 14. Bilinen sınırlar

- **Gerçek sağlayıcıya hiç bağlanılmadı.** Tüm testler mock sunucu üzerinden yapıldı.
  Mock, sağlayıcıların gerçek yanıt şemalarına (usage alanlarının konumu dahil) uygun
  yazıldı, ancak gerçek API'lerde farklılık çıkabilir.
- **Birim test yok** (aşağıda ayrıca belirtilmiştir).
- **Birim test yok.** Doğrulama, mock sunucu üzerinden uçtan uca HTTP testleriyle
  yapıldı. CI ve birim testleri B tarafının kapsamında.
- **Token sayıları `0` ile "bilinmiyor" ayrışmıyor.** Log servisinin imzası zorunlu
  `number` beklediği için, sağlayıcı `usage` göndermediğinde `0` yazılıyor. Bu,
  gerçekte harcanmış ama kaydedilmemiş kullanım anlamına gelebilir.

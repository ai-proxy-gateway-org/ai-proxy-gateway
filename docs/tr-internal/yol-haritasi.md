# Yol haritası — açık kalan işler

Görev tanımı ile bugünkü durumu karşılaştırınca ortaya çıkan işler. Sıralama bağımlılığa
göre: üstteki maddeler alttakilerin önkoşulu.

Her madde için: **ne**, **neden**, **kim**, **ne bekliyor**.

---

## Faz 0 — Önce karar verilmesi gerekenler

Bu üç soru cevaplanmadan aşağıdaki fazların kapsamı netleşmiyor.

### K1 · Yönetim arayüzü yapılacak mı?

Görev tanımı **Client Management** başlığı altında üç şey istiyor: client oluşturma,
anahtar üretme, client'ı kapatma. Buna model ve domain yetkilerini tanımlamak da ekleniyor.

Şu an hepsi Supabase panelinden elle yapılıyor. Kodda tek bir yönetim fonksiyonu var
(`createNewClient`) ve onu çağıracak bir uç nokta yok.

Bu iş rol dağılımının hiçbir yerinde geçmiyor — ikimiz de üstlenmedik. Üç seçenek var:

| Seçenek | Kapsam |
|---|---|
| **A) Hiç yapma** | Yönetim Supabase panelinden elle sürer. Görev tanımının bir maddesi karşılanmamış olur |
| **B) Sadece API** | `/admin/*` uçları. Ekran yok, ama `curl` veya Postman ile yönetilebilir |
| **C) API + basit ekran** | Tam karşılık, ama en uzun iş |

**Önerimiz:** B. Görev tanımının maddesini karşılar, ekran işi kapsamı iki katına çıkarır.

⚠️ **Kritik tasarım notu:** Yönetim uçları client anahtarlarıyla korunamaz. Bir client
kendi yetkilerini genişletebilmemeli. Ayrı bir yönetici kimlik doğrulaması gerekiyor
(ayrı bir anahtar türü veya farklı bir mekanizma). Bu, işin en çok düşünülmesi gereken
kısmı.

### K2 · Prompt kaydedilecek mi?

Görev tanımı loglanacaklar arasında **Prompt** diyor. wf-ortak §5 ayrıca şunu istiyor:
prompt içerikleri yalnızca yetkili yöneticilere açık olmalı ve belirli bir süre sonra
temizlenebilmeli.

Yapılacaksa üç parça gerekiyor: kolon (B), gövdeden yakalayıp iletme (A), erişim ve
saklama politikası (B).

Yapılmayacaksa gerekçesi yazılmalı — muhtemel gerekçe: kullanıcı içeriği saklamak
gizlilik yükü getiriyor ve maliyet takibi için gerekli değil.

### K3 · `localOrigins` mi `domainWhitelister` mı kalacak?

İkisi de localhost kontrolü yapıyor, biri A'da biri B'de. Şu an akışta yalnızca B'ninki
çalışıyor; A'daki sadece `/health` çıktısında görünüyor. Biri kaldırılmalı.

---

## Faz 1 — Güvenlik borcu

Kod yazmadan yapılabilir, en acil grup.

### G1 · Anahtarların yenilenmesi · **B** · bağımlılık yok

Supabase service-role anahtarı ve Upstash token'ı geliştirme sırasında sohbet üzerinden
paylaşıldı ve hâlâ geçerli. İkisi de yenilenmeli; yenileri paylaşım kanalı yerine Vercel
ortam değişkenleri üzerinden aktarılmalı.

### G2 · Secret yönetim planı · **B** · bağımlılık yok

wf-rol Aşama 1'de B'ye verilmiş ama yazılmadı. Kapsaması gerekenler: anahtarlar nerede
durur, kim erişir, nasıl yenilenir, yeni bir geliştirici geldiğinde nasıl paylaşılır.

Bir sayfalık bir doküman yeterli.

### G3 · `.env.example` güncellenmesi · **B** · bağımlılık yok

Şablon hâlâ koddan farklı. Kodun okuduğu değişkenler:

```
SUPABASE_URL, SUPABASE_SERVICE_KEY
UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY
OPENAI_BASE_URL, ANTHROPIC_BASE_URL, GEMINI_BASE_URL
```

---

## Faz 2 — Görev tanımının karşılanmamış maddeleri

### Y1 · Sağlayıcı bazlı yetkilendirme · **B → A** · bağımlılık yok

> *"Which AI providers the Client is allowed to use. Multiple providers can be selected."*

Şu an yalnızca model listesi var (`allowed_models`). Sağlayıcı seviyesinde alan yok;
"bu client Gemini'yi hiç kullanmasın" demek için tek tek her Gemini modelini listeden
çıkarmak gerekiyor.

**B:** `clients` tablosuna `allowed_providers` (metin dizisi) ekler, `verifyClient`
sorgusuna dahil eder.
**A:** Güvenlik zincirinde model kontrolünden **önce** sağlayıcı kontrolü ekler.

`allowed_models` ile aynı akış; iki taraf da ne yapacağını biliyor.

### Y2 · Hız limitinin tamamlanması · **B** · bağımlılık: şema

> *"istemci bazında (dakika/saat/gün seviyelerinde) request ve token limitlerini kontrol
> eden Rate Limiting servisi"*

Üç eksik var:

**Client bazlı limit.** Şu an herkese sabit 60/dk. `clients` tablosuna limit kolonları
gerekiyor (`rpm`, `rph`, `rpd` gibi) ve `verifyClient` bunları döndürmeli.

**Üç ayrı pencere.** Fonksiyon tek bir pencere alıyor. Dakika/saat/gün için üç ayrı sayaç
ve üç ayrı kontrol gerekiyor.

⚠️ Performans notu: bu, istek başına üç Redis çağrısı demek. Pipeline veya tek Lua
betiğiyle tek turda yapılması düşünülmeli — proxy'de her tur gecikmeye ekleniyor.

**Token limiti.** Şu an yalnızca istek sayılıyor. Harcanan token'ları biriktiren ayrı bir
sayaç gerekiyor.
**A'ya düşen:** token verisi zaten ölçülüyor; hangi noktada ve hangi biçimde iletileceği
kararlaştırılmalı. Yanıt tamamlandıktan sonra sayaca eklenmesi en doğal yol.

### Y3 · Client başına birden fazla ortam anahtarı · **B** · bağımlılık yok

> wf-ortak §1: *"production, staging ve local için birbirinden bağımsız birden fazla API
> anahtarı tanımlama esnekliği"*

`client_keys` tablosunda `environment` kolonu var, yani şema hazır. Eksik olan: mevcut bir
client'a yeni anahtar ekleyen bir fonksiyon. Şu an `createNewClient` her çağrıldığında
**yeni bir client** oluşturuyor.

Gereken: `addKeyToClient(clientId, environment)`.

### Y4 · Prompt kaydı · **B → A** · bağımlılık: K2 kararı

K2'de "evet" denirse: kolon (B) → yakalama ve iletme (A) → erişim ve saklama politikası (B).

---

## Faz 2b — Dinamik model kataloğu

> Umur'un sorusundan çıktı: *"yeni model geldiğinde sistem güncelliyor kendini dedik de,
> tam öyle değil galiba."* Haklı. Bu madde ikimizin de görev listesinde yoktu.

### Şu an ne oluyor

İki ayrı liste var ve sadece biri canlı:

| Liste | Nerede | Ne zaman okunuyor | Yeni model eklemek |
|---|---|---|---|
| Müşterinin izinli modelleri | `clients.allowed_models` | **Her istekte** | Anında geçerli |
| Sistemin tanıdığı katalog | `src/model_pricing.json` | **Açılışta bir kez** | Kod değişikliği + dağıtım |

`modelCatalog.ts` dosyayı açılışta `readFileSync` ile okuyup bellekte tutuyor.
`logger.ts` ise `import ... with { type: 'json' }` ile dosyayı derleme anında koda
gömüyor. İkisi de dağıtım paketinin parçası; dosya değişmeden içerik değişmiyor.

### Bir müşteri yeni bir modele geçmek istediğinde — bugün

1. `model_pricing.json` dosyasına satır ekle
2. Commit, PR, inceleme, merge
3. Vercel'in yeniden dağıtmasını bekle
4. Supabase'de `clients.allowed_models` alanına ekle

Dört adım, iki kişi, bir dağıtım. Yaklaşık 10–15 dakika.

### Hedef

1. `model_catalog` tablosuna satır ekle
2. `clients.allowed_models` alanına ekle

İki adım, tek kişi, dağıtım yok. En geç 10 dakikada canlıda.

---

### M1 · Katalog tablosu · **B** · bağımlılık yok

`model_pricing.json` içeriği Supabase'e taşınır:

```sql
create table model_catalog (
  id            uuid primary key default gen_random_uuid(),
  provider      text        not null,
  model         text        not null,
  input_price   numeric(12,6) not null,   -- 1000 token başına dolar
  output_price  numeric(12,6) not null,   -- 1000 token başına dolar
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  unique (provider, model)
);
```

Mevcut üç kayıt aynı değerlerle taşınır. Birim değişmiyor: `logger.ts` zaten
`(token / 1000) * fiyat` hesabı yapıyor.

`is_active` kolonu bilerek var: bir model kullanımdan kaldırılacağında satır silinmiyor,
kapatılıyor. Silinseydi o modelle yazılmış eski kayıtların fiyat karşılığı kaybolurdu.

### M2 · İki tarafın da tablodan okuması · **B + A** · bağımlılık: M1

**B tarafı** — `logger.ts` maliyet hesabında dosya yerine tablodan okur.

**A tarafı** — `modelCatalog.ts` dosya yerine tablodan okur.

İkisi de aynı kuralla çalışır:

- **Bellekte 10 dakika tutulur.** Her istekte veritabanına gitmek her isteğe gecikme
  ekler; katalog ise günde bir değişen bir şey. Karşılaştırma için: LiteLLM aynı işi 6
  saatlik aralıkla yapıyor. Sunucusuz ortamda örnekler kısa ömürlü olduğu için pratikte
  çok daha sık tazelenecek — her soğuk başlangıç zaten yeniden okuyor.
- **Yenileme uç noktası yapılmayacak.** LiteLLM'de var ama Vercel'de işe yaramaz: kaç
  örnek çalıştığı bilinmediği için tetiklenen uç sadece birine denk gelir.
- **Veritabanına ulaşılamazsa eldeki liste kullanılmaya devam eder.** Katalog okunamadı
  diye istekler reddedilmez.
- **Hiç okunamamışsa** `model_pricing.json` yedek olarak kalır. Dosya silinmiyor, ilk
  açılış tohumu ve acil durum yedeği olarak duruyor.

`authorizeModel` şu an eşzamanlı bir fonksiyon; tablodan okumaya geçince `async` olacak.
Çağrıldığı tek yer `proxyForward.ts`, küçük bir değişiklik.

### M3 · Model ekleme yolu · **B** · bağımlılık: M2

Başlangıçta Supabase arayüzünden elle satır eklemek yeterli. Yönetim arayüzü kararı
(K1) olumlu çıkarsa buraya bir uç nokta eklenir: model ekle, fiyat güncelle, kapat.

---

### M4 · Model keşfi · **A** · bağımlılık: M2 + R1

Vercel'in zamanlanmış görev özelliğiyle günde bir kez çalışan bir iş:

```
→ OpenAI, Anthropic, Gemini'nin model listesi uçlarına git
→ gelen listeyi model_catalog ile karşılaştır
→ yeni model: tabloya ekle, is_active = false, fiyat boş
→ listeden düşen model: silme, "sağlayıcıda artık yok" işaretle
→ değişiklik varsa günlük özete yaz
```

Üç sağlayıcının da model listesi veren bir ucu var ve anahtar başlıkları
`providerConfig.ts` içinde zaten kurulu; yeni bir istemci yazmak gerekmiyor.

**Asıl faydası ters yönde.** Sağlayıcılar zaman zaman eski modelleri kapatıyor. Bugün
bu bir müşterinin istekleri patladığında öğreniliyor. Bu iş, model listeden düştüğü gün
haber verir.

**Fiyat otomatik çekilmeyecek.** Hiçbir sağlayıcı fiyatı API'den vermiyor. Dışarıdan
tahmin etmek para hesabını doğrulamadan kabul etmek olur. Elle kalan bu adım aynı
zamanda onay kapısı: otomatik aktif etseydik "yeni ve pahalı modellere kontrolsüz
erişim engellenmeli" kuralı çiğnenirdi. Otomatikleştirilen şey onay değil, **fark etme**.

**Neden en sonda:** model listesi uçlarına anahtarla gidiliyor, yani R1'siz çalışmaz.
Ayrıca katalogda üç model varken günlük iş yazmak fazla — model sayısı arttığında
anlamlı olur.

---

### Bilinçli olarak yapılmayacak olan

**Katalogdaki model otomatik olarak müşterilere açılmayacak.** İki katmanlı yapı
korunuyor: katalog "bu model sistemde tanımlı mı", `allowed_models` "bu müşteri
kullanabilir mi". Tek katmana indirilirse fiyat listesindeki her model herkese açılır —
proje kuralları bunu yasaklıyor.

Yani M1–M3 bittiğinde bile bir müşterinin yeni modele geçmesi için iki kayıt gerekiyor:
biri katalogda, biri müşteride. Fark şu ki ikisi de veritabanı işlemi, kod değişikliği
değil.

**Fiyat geçmişi tutulmayacak.** Fiyat değişirse eski kayıtların maliyeti yeniden
hesaplanmıyor — zaten `logs.cost` kolonunda o anki fiyatla yazılmış durumda. Denetim
gerekirse `valid_from` kolonu sonradan eklenebilir, şimdilik gereksiz karmaşıklık.

---

## Faz 2c — Veritabanı bağımsızlığı

> Mentörün sorusundan çıktı: *"ben MongoDB kullanmak istedim, bağlayıcı bir şey var mı,
> direkt veritabanını değiştirebilir miyim?"* Toplantıda cevaplanmadı.

### Şu anki durum

Sistem Supabase'e sanıldığından **az** bağımlı ama kod **dağınık**.

Toplam yedi veritabanı çağrısı var, beş dosyaya yayılmış:

| # | Dosya | İşlem | Zorluk |
|---|---|---|---|
| 1 | `middleware/authMiddleware.ts` | `client_keys` → `clients` ilişkisel birleştirme | Tek zor olan |
| 2 | `core/security.ts` | `clients` tek kayıt okuma | Zaten silinecek (Q3) |
| 3 | `core/logCapture.ts` | `logs` güncelleme | Zaten taşınacak (Q3) |
| 4 | `services/db.ts` | `clients` ekleme | Basit |
| 5 | `services/db.ts` | `client_keys` ekleme | Basit |
| 6 | `services/logger.ts` | `logs` ekleme | Basit |
| 7 | `services/logger.ts` | `logs` güncelleme | Basit |

Karmaşık sorgu, transaction, saklı yordam ya da tetikleyici yok.

Redis tarafı daha da temiz: `@upstash/redis` yalnızca `middleware/rateLimiter.ts` içinde,
tek satırda. Ayrıca hız limiti hata durumunda isteği geçiriyor, yani zorunlu bir
bağımlılık bile değil.

---

### D0 · Boş migration dosyası · **B** · bağımlılık yok · **öncelikli**

`supabase/migrations/20260816063350_remote_schema.sql` depoda kayıtlı ama **sıfır bayt**.

Yani `clients`, `client_keys` ve `logs` tablolarının tanımı hiçbir yerde yazılı değil,
sadece Supabase panelinde duruyor. Depoyu klonlayan biri sistemi ayağa kaldıramaz.

Açık kaynak iddiası açısından bu, MongoDB desteğinden daha büyük bir engel — ve bir
saatlik iş. Supabase CLI ile şema düzgün dışarı çıkarılıp depoya alınmalı.

**Bu madde M1'den önce gelmeli.** Yoksa yeni `model_catalog` tablosu da sadece panelde
var olur, aynı sorun tekrarlanır.

### D1 · Veri erişimini tek dosyada toplamak · **A + B** · bağımlılık: yok

Soyutlama katmanı değil, **toplama**. Yedi çağrı tek bir veri erişim modülüne taşınır;
geri kalan kod `supabase` kelimesini hiç görmez, sadece fonksiyon çağırır:

```
findClientByKeyHash(hash)
createLogEntry(...)
completeLogEntry(logId, ...)
setLogError(logId, mesaj)
createClient(ad)
createClientKey(clientId, hash, ortam)
getModelCatalog()            ← M2 ile gelecek
```

**A tarafı:** `security.ts` ve `logCapture.ts` içindeki iki çağrı zaten geçici çözüm,
siliniyor (Q3). Bu yapıldığında A tarafında doğrudan veritabanı çağrısı kalmıyor.

**B tarafı:** kalan beş çağrının tek dosyada toplanması.

**Bu madde M2'den önce gelmeli.** Yoksa katalog okuması sekizinci dağınık çağrı olur.

### D2 · Arayüz ve adaptör · **ertelendi**

D1'in üstüne bir arayüz tanımlanıp `SupabaseStore` / `MongoStore` şeklinde iki uygulama
tutulabilir, ortam değişkeniyle seçilir.

**Şimdilik yapılmayacak.** Gerçek bir talep gelmeden yazılan soyutlama bakım yükünden
başka bir şey değil. D1 yapıldıktan sonra bu bir günlük iş — talep geldiğinde yapılır.

### D3 · ORM değerlendirmesi · **ayrı konu**

ORM, MongoDB sorununu **çözmez**. Veritabanı bağımsızlığı vaadi SQL ailesi içinde
geçerli (Postgres ↔ MySQL ↔ SQLite); SQL ile doküman veritabanı arasında geçiş şemanın
yeniden tanımlanmasını gerektiriyor.

ORM'in gerçek faydası başka: şemadan **tip üretimi**. Şu an kodda
`data?.allowed_models as string[]` gibi derleyicinin doğrulamadığı dönüşümler var; kolon
adı ya da tipi değişse kod derlenir, çalışma anında patlar.

Bu yüzden ORM MongoDB gerekçesiyle değil, tip güvenliği gerekçesiyle ayrıca
değerlendirilmeli.

---

### Geçiş gerçekten olursa — iki tuzak

**İlişkisel birleştirme.** `authMiddleware` şu an `client_keys` ile `clients`'ı tek
sorguda birleştiriyor. Doküman veritabanında ya iki sorgu olur ya da müşteri bilgisi
anahtar belgesine gömülür. Gömülürse müşteri izinleri değişince o müşterinin bütün
anahtarları güncellenmek zorunda.

**Para alanı.** `logs.cost` şu an `numeric`. MongoDB'de para için `Decimal128`
kullanılmalı; normal ondalık sayı kullanılırsa yuvarlama hataları doğrudan faturaya
yansır.

---

## Faz 3 — Yönetim arayüzü

**Bağımlılık: K1 kararı.** B seçilirse aşağıdaki sıra izlenir.

### Y5 · Yönetici kimlik doğrulaması · **B** · önce bu

Client anahtarları yönetim uçlarını açamamalı. Ayrı bir mekanizma gerekiyor — örneğin
`sk-admin-` önekli ayrı bir anahtar türü ve ayrı bir tablo, ya da tek bir yönetici
anahtarının ortam değişkeninde tutulması.

Bu karar verilmeden uçlar yazılmamalı.

### Y6 · Veri katmanı fonksiyonları · **B**

```
listClients()
setClientActive(clientId, isActive)      → client'ı kapat/aç
updateClientPermissions(clientId, ...)   → modeller, sağlayıcılar, domainler, limitler
addKeyToClient(clientId, environment)    → Y3 ile aynı iş
revokeKey(keyId)
```

### Y7 · HTTP uçları · **A**

Yukarıdaki fonksiyonları `/admin/*` altında dışa açar. Yönetici doğrulaması (Y5) her uçta
uygulanır. Yanıt biçimleri ve hata kodları mevcut uçlarla tutarlı olur.

### Y8 · Ekran · **karar verilirse** · ikisinden biri

K1'de C seçilirse. Basit bir liste + form yeterli; ayrı bir proje olarak da yapılabilir.

---

## Faz 4 — Kalite ve süreç

### Q1 · CI kurulumu · **B** · bağımlılık yok

wf-rol Aşama 5: her PR'da otomatik ESLint, Prettier ve birim testleri. Hiçbiri kurulmadı.

Not: `tsc --noEmit` şu an sıfır hata veriyor, yani tip kontrolü CI'a bugün eklenebilir.

### Q2 · Birim testleri · **B** · bağımlılık: Q1

Doğrulama şu an uçtan uca HTTP testleriyle yapılıyor. Test edilmeye en değer yerler:
model yetkilendirme mantığı, akış katmanındaki satır tamponu, maliyet hesabı.

### Q3 · Geçici çözümlerin temizlenmesi · **A** · bağımlılık yok

B tarafı `verifyClient`'ı genişletip `logRequestComplete`'e hata parametresi eklediği için
iki fazladan işlem gereksiz kaldı: `security.ts`'teki ikinci veritabanı sorgusu ve
`logCapture.ts`'teki ayrı güncelleme.

### Q4 · Küçük iyileştirmeler · **A** · bağımlılık yok

- `npm run dev` ortam değişkenlerini kendiliğinden yüklesin
- Kök adres (`/`) hangi uçların bulunduğunu söyleyen bir cevap dönsün
- Sahte sağlayıcının kaynak kodu depoya taşınsın (şu an geçici klasörde)

---

## Faz 5 — Gerçek sağlayıcıya geçiş

**Bağımlılık: şirketten API anahtarlarının gelmesi.**

### R1 · Anahtarların tanımlanması · **A** · 5 dakika

Vercel ortam değişkenlerine `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` ve
üç `*_BASE_URL` eklenir. Kod tarafında değişiklik gerekmiyor.

### R2 · Gerçek davranışların doğrulanması · **A**

Bugüne kadarki tüm testler sahte sağlayıcı üzerinden yapıldı. Gerçek API'lerde
farklılık çıkabilecek yerler:

- Token alanlarının konumu (özellikle akış hâlinde)
- Hata gövdelerinin biçimi
- Gerçek gecikme değerleri
- OpenAI akışında `usage` yalnızca `stream_options.include_usage` gönderilirse geliyor —
  bunun istemciye mi bırakılacağı yoksa proxy'nin mi ekleyeceği kararlaştırılmalı

### R3 · Önizleme korumasının geri açılması · **A** · R1 ile birlikte

Şu an kapalı; arkada sahte sağlayıcı olduğu için güvenli. Gerçek anahtarlar eklendiği anda
açılmalı — yoksa önizleme adresini bilen biri şirketin parasıyla AI kullanabilir.

### R4 · Maliyet listesinin genişletilmesi · **B** · bağımlılık: M1

Katalog şu an üç model içeriyor ve listede olmayan hiçbir model kullanılamıyor. Gerçekte
kullanılacak modeller eklenmeli.

Faz 2b yapılırsa bu iş dosya düzenlemek yerine tabloya satır eklemeye dönüşür; R1'i de
beklemez, istenildiği zaman yapılabilir.

---

## Özet tablo

| Faz | İş | Kim | Bekliyor |
|---|---|---|---|
| 0 | K1 · Yönetim arayüzü kararı | ortak | — |
| 0 | K2 · Prompt kaydı kararı | ortak | — |
| 0 | K3 · localhost kontrolü çakışması | ortak | — |
| 1 | G1 · Anahtarların yenilenmesi | B | — |
| 1 | G2 · Secret yönetim planı | B | — |
| 1 | G3 · `.env.example` güncellemesi | B | — |
| 2 | Y1 · Sağlayıcı bazlı yetkilendirme | B → A | — |
| 2 | Y2 · Hız limitinin tamamlanması | B (+A) | şema |
| 2 | Y3 · Çoklu ortam anahtarı | B | — |
| 2 | Y4 · Prompt kaydı | B → A | K2 |
| 2b | M1 · Katalog tablosu | B | — |
| 2b | M2 · İki tarafın tablodan okuması | B + A | M1 |
| 2b | M3 · Model ekleme yolu | B | M2 |
| 2b | M4 · Model keşfi | A | M2 + R1 |
| 2c | D0 · Boş migration dosyası | B | — |
| 2c | D1 · Veri erişimini toplamak | A + B | — |
| 2c | D2 · Arayüz ve adaptör | ertelendi | D1 |
| 2c | D3 · ORM değerlendirmesi | ortak | — |
| 3 | Y5 · Yönetici kimlik doğrulaması | B | K1 |
| 3 | Y6 · Veri katmanı fonksiyonları | B | Y5 |
| 3 | Y7 · Yönetim uçları | A | Y6 |
| 3 | Y8 · Ekran | ortak | K1 = C |
| 4 | Q1 · CI kurulumu | B | — |
| 4 | Q2 · Birim testleri | B | Q1 |
| 4 | Q3 · Geçici çözümlerin temizliği | A | — |
| 4 | Q4 · Küçük iyileştirmeler | A | — |
| 5 | R1 · Gerçek anahtarların tanımlanması | A | şirket |
| 5 | R2 · Gerçek davranış doğrulaması | A | R1 |
| 5 | R3 · Önizleme koruması | A | R1 |
| 5 | R4 · Maliyet listesi genişletmesi | B | R1 |

---

## Önerilen sıra

**Bu hafta:** Faz 0 kararları (bir toplantı yeterli) + Faz 1'in tamamı + Q3, Q4.
Hiçbiri diğerini beklemiyor, paralel ilerler.

**Sonra:** Faz 2 — görev tanımının karşılanmamış maddeleri. Y1 ve Y3 kısa, Y2 en uzun iş.

**Faz 2b ve 2c iç içe geçiyor.** D0 M1'den önce, D1 M2'den önce yapılmalı — yoksa yeni
tablo da sadece panelde kalır ve katalog okuması sekizinci dağınık çağrı olur. Önerilen
sıra: D0 → D1 → M1 → M2 → M3 → D2/M4.

**Faz 2b öncelikli sayılabilir:** M1 ve M2 birlikte yarım günlük iş ve her yeni model
talebinde tekrarlanan dört adımlık dağıtım döngüsünü ortadan kaldırıyor. Y1 ile de
birlikte gider — sağlayıcı bazlı yetkilendirme aynı okuma yolunu kullanacak.

**Karara göre:** Faz 3, K1'de B veya C seçilirse.

**Şirketten anahtar gelince:** Faz 5.

**Fırsat buldukça:** Faz 4'ün CI kısmı — erken kurulursa sonraki işlerde hata yakalar.

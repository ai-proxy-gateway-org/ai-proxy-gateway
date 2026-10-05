# Model kataloğu — durum ve öneri

Umur'un sorusu üzerine hazırlandı: *"yeni model geldiğinde sistem güncelliyor kendini
dedik de, tam öyle değil galiba. Bir bakabilir misin nasıl geliştiririz ya da nasıl
çalışıyor şu an."*

Kısa cevap: haklısın, öyle çalışmıyor. Aşağıda önce şu anki durum, sonra önerim var.

---

## 1 · Şu an nasıl çalışıyor

İki ayrı liste var ve sadece biri canlı.

| Liste | Nerede | Ne zaman okunuyor | Yeni model eklemek |
|---|---|---|---|
| Müşterinin izinli modelleri | `clients.allowed_models` | **Her istekte** | Anında geçerli |
| Sistemin tanıdığı katalog | `src/model_pricing.json` | **Açılışta bir kez** | Kod değişikliği + dağıtım |

### Neden katalog güncellenmiyor

Dosya iki yerde de dağıtım paketinin parçası:

- `src/services/logger.ts` → `import pricingData from '../model_pricing.json'`
  Derleme anında koda gömülüyor.
- `src/core/modelCatalog.ts` → açılışta bir kez `readFileSync` ile okunup bellekte
  tutuluyor.

İkisi de dosya değişmeden içerik değiştiremiyor. Yani "sistem kendini günceller" sadece
`allowed_models` için doğru, katalog için değil.

### Bugün yeni model eklemek

```
1. model_pricing.json dosyasına satır ekle
2. Commit, PR, inceleme, merge
3. Vercel'in yeniden dağıtmasını bekle
4. clients.allowed_models alanına ekle
```

Dört adım, iki kişi, bir dağıtım.

---

## 2 · Öneri: fiyat listesini Supabase'e taşıyalım

### Tablo

```sql
create table model_catalog (
  id            uuid primary key default gen_random_uuid(),
  provider      text          not null,
  model         text          not null,
  input_price   numeric(12,6) not null,   -- 1000 token başına dolar
  output_price  numeric(12,6) not null,   -- 1000 token başına dolar
  is_active     boolean       not null default true,
  created_at    timestamptz   not null default now(),
  unique (provider, model)
);
```

Mevcut üç kayıt aynı değerlerle taşınır. **Birim değişmiyor** — `logger.ts` zaten
`(token / 1000) × fiyat` hesabı yapıyor.

`is_active` kolonu bilerek var: kullanımdan kalkan model silinmiyor, kapatılıyor.
Silinseydi o modelle yazılmış eski `logs` kayıtlarının fiyat karşılığı kaybolurdu.

### İki taraf da tablodan okur

| Kim | Nerede | Ne için |
|---|---|---|
| B | `logger.ts` | Maliyet hesabı |
| A | `modelCatalog.ts` | Katalog kontrolü (model sistemde tanımlı mı) |

İkisi de aynı kuralla çalışır:

**Bellekte 10 dakika tutulur.** Her istekte veritabanına gitmek her isteğe gecikme
ekler; katalog ise günde bir değişen bir şey. Karşılaştırma için: LiteLLM aynı işi 6
saatlik aralıkla yapıyor. Vercel'de örnekler kısa ömürlü olduğu için pratikte çok daha
sık tazelenecek — her soğuk başlangıç zaten yeniden okuyor.

**Veritabanına ulaşılamazsa eldeki liste kullanılmaya devam eder.** Katalog okunamadı
diye istekler reddedilmez.

**`model_pricing.json` silinmez.** İlk açılış tohumu ve acil durum yedeği olarak kalır.

**Yenileme uç noktası yapılmayacak.** LiteLLM'de var ama Vercel'de işe yaramaz: kaç
örnek çalıştığı bilinmediği için tetiklenen uç sadece birine denk gelir.

### Sonuç

```
1. model_catalog tablosuna satır ekle
2. clients.allowed_models alanına ekle
```

İki adım, tek kişi, dağıtım yok.

---

## 3 · Bilerek yapmayacağımız şey

**Kataloğa eklenen model otomatik olarak müşterilere açılmayacak.**

İki katmanlı yapı korunuyor:

- Katalog → "bu model sistemde tanımlı mı, fiyatı biliniyor mu"
- `allowed_models` → "bu müşteri kullanabilir mi"

Tek katmana indirilirse fiyat listesindeki her model her müşteriye açılır. `wf-ortak`
bunu açıkça yasaklıyor: *yeni ve pahalı modellere kontrolsüz erişim engellenmeli.*

Yani bu iş bittiğinde bile yeni modele geçmek iki kayıt gerektirecek. Fark şu ki ikisi
de veritabanı işlemi olacak, kod değişikliği değil.

**Fiyat geçmişi tutulmayacak.** Fiyat değişirse eski kayıtlar yeniden hesaplanmıyor —
`logs.cost` kolonunda o anki fiyatla zaten yazılmış durumda. Denetim gerekirse
`valid_from` kolonu sonradan eklenebilir.

---

## 4 · İş bölümü

| İş | Kim | Bağımlılık |
|---|---|---|
| M1 · `model_catalog` tablosu, mevcut üç kaydın taşınması | B | — |
| M2a · `logger.ts` maliyet hesabının tablodan okuması | B | M1 |
| M2b · `modelCatalog.ts` katalog kontrolünün tablodan okuması | A | M1 |
| M3 · Model ekleme yolu (başta Supabase arayüzü yeterli) | B | M2 |

`authorizeModel` şu an eşzamanlı bir fonksiyon; tablodan okumaya geçince `async`
olacak. Çağrıldığı tek yer `proxyForward.ts`, küçük bir değişiklik.

---

## 5 · İleride: model keşfi

Yukarıdaki tablo işi sadece dağıtımdan kurtarıyor. Asıl yorucu kısım hâlâ elde kalıyor:
yeni model çıktığını **fark etmek** ve kimliğini doğru bulmak.

Onu da otomatikleştirebiliriz. Üç sağlayıcının da model listesi veren bir ucu var ve
anahtar başlıkları `providerConfig.ts` içinde zaten kurulu:

```
OpenAI      GET /v1/models          Authorization: Bearer
Anthropic   GET /v1/models          x-api-key + anthropic-version
Gemini      GET /v1beta/models      x-goog-api-key
```

Vercel'in zamanlanmış görev özelliğiyle günde bir kez çalışan bir iş:

```
→ üç sağlayıcının model listesini çek
→ model_catalog ile karşılaştır
→ yeni model: tabloya ekle, is_active = false, fiyat boş
→ listeden düşen model: silme, "sağlayıcıda artık yok" işaretle
→ değişiklik varsa günlük özete yaz
```

### Asıl faydası ters yönde

Sağlayıcılar zaman zaman eski modelleri kapatıyor. Bugün bunu bir müşterinin istekleri
patladığında öğreniyoruz. Bu iş olsa, model listeden düştüğü gün haber verir.

### Fiyat otomatik çekilmeyecek

Hiçbir sağlayıcı fiyatı API'den vermiyor; fiyat sadece web sitelerindeki tablolarda.
Dışarıdan tahmin etmek, para hesabını doğrulamadan kabul etmek olur.

Elle kalan bu adım aynı zamanda onay kapısı: otomatik aktif etseydik yukarıdaki kuralı
çiğnerdik. **Otomatikleştirilmesi gereken şey onay değil, fark etme.**

### Neden en sonda

- Model listesi uçlarına anahtarla gidiliyor → gerçek API anahtarları gelmeden çalışmaz
- Katalogda şu an üç model var → üç satır için günlük iş yazmak fazla
- M1 ve M2 olmadan keşfettiği modeli yazacağı tablo yok

---

## 6 · Önerilen sıra

| Sıra | İş | Neden |
|---|---|---|
| 1 | M1 + M2 — tabloya taşı | Dağıtım döngüsünü ortadan kaldırır, asıl darboğaz bu |
| 2 | M3 — ekleme yolu | SQL yazmadan eklenebilsin |
| 3 | M4 — keşif işi | Model sayısı artınca, gerçek anahtarlardan sonra |

---

## 7 · Karar bekleyenler

- Tablo adı ve kolon isimleri böyle mi olsun?
- 10 dakikalık tazeleme süresi uygun mu?
- `is_active` yeterli mi, yoksa "sağlayıcıda yok" için ayrı bir durum kolonu mu gerekir?
- M3'te Supabase arayüzü yeterli mi, yoksa baştan bir uç nokta mı yazalım?

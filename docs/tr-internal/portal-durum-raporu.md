# Müşteri Portalı — durum raporu

27 Ağustos · Geliştirici A

---

## Ne yapıldı

Müşterinin kendi anahtarıyla girip **yalnızca kendi kullanımını** gördüğü bir portal.
Sol menülü, beş bölümlü, gerçek veriyle çalışıyor.

| Bölüm | İçinde ne var |
|---|---|
| **Genel Bakış** | Dört metrik (istek, başarısız, token, maliyet) · önceki dönemle kıyas · eksenli günlük harcama grafiği · dört ikincil ölçü |
| **Kullanım** | Model bazında dağılım, pay çubuklarıyla |
| **İstekler** | Tüm / başarısız sekmeleri · sayfalama · satıra tıklayınca detay paneli |
| **Anahtarım** | Anahtar bilgisi ve erişim izinleri, salt-okunur |
| **Ayarlar** | Kullanım kayıtlarını CSV olarak indirme |

Dönem seçimi (7 gün / 30 gün / tümü) üst çubukta, bütün bölümleri etkiliyor.
Açık ve koyu tema desteği var, sistem tercihini izliyor.

---

## Nasıl çalışıyor

### Yeni hiçbir şey eklenmedi

- **Yeni tablo yok** — mevcut `clients`, `client_keys`, `logs` kullanılıyor
- **Yeni kimlik sistemi yok** — `verifyClient` yeniden kullanılıyor
- **Dış kütüphane yok** — grafik dahil her şey elle yazıldı
- **Ayrı dağıtım yok** — sayfa Fastify'ın kendisinden dönüyor, `vercel.json` değişmedi

### Üç uç nokta

```
GET  /portal              → sayfanın tamamı (HTML + CSS + JS tek metin)
POST /portal/api/login    → anahtar doğrula, hesap bilgisi dön
GET  /portal/api/usage    → dönem verisi
GET  /portal/api/export   → CSV
```

Menüye tıklamak sunucuya gitmiyor; sayfa tek parça, sadece bölüm değişiyor.

### Veri akışı

```
Anahtar girildi
   ↓
verifyClient()  →  SHA-256 özeti  →  client_keys  →  bağlı clients satırı
   ↓
clientId elde edildi
   ↓
logs tablosu, WHERE client_id = <doğrulanmış kimlik>
```

Müşteri kimliği **istekten değil doğrulanmış anahtardan** alınıyor. "Bana şu müşterinin
kayıtlarını ver" denemesi mümkün değil.

### Verilen kararlar

**İki ayrı sorgu.** Özet ve grafik dönemin tamamından, tablo sayfa sayfa. Tek sorgu
olsaydı "daha fazla yükle" bastıkça toplam maliyet değişirdi.

**Toplamlar sunucuda hesaplanıyor.** Yüzlerce satırı tarayıcıya gönderip orada toplamak
yerine hazır rakam gidiyor.

**Anahtar tarayıcıda 12 saat, süre sınırlı.** Sayfa yenilendiğinde oturum korunuyor,
12 saat sonra kendiliğinden düşüyor.

**Sağlayıcı renkleri bilgi taşıyor.** OpenAI yeşil, Anthropic turuncu, Gemini mavi —
grafik, tablo ve dağılımda aynı renk. Süs değil, kodlama.

---

## Bitmiş olan iki güvenlik işi

**Giriş ucuna hız limiti.** `/portal/api/login` sınırsız denemeye açıktı. Umur'un
`checkRateLimit` fonksiyonu bağlandı: dakikada 10 **başarısız** deneme.

Sayaç yalnızca başarısızları sayıyor — doğrulamadan önce saysaydı, aynı IP'den yanlış
anahtar deneyen biri doğru anahtarı olan kişiyi de kilitlerdi. Sıra `security.ts` ile
aynı: önce kimlik, sonra hız limiti.

**Maliyet hesabı doğrulanabiliyor.** İstek satırına tıklayınca:

```
girdi 10 ÷ 1000 × $0.005     $0.000050
çıktı 15 ÷ 1000 × $0.015     $0.000225
─────────────────────────────────────
yeniden hesaplanan           $0.000275
kayıtlı değer                $0.000275
✓ uyuşuyor
```

Umur'un *"token ücret hesabının doğruluğunun kontrolü"* maddesine ilk cevap.
Yakalayabildiği hatalar: birim karışıklığı (1K ↔ 1M), fiyatı olmayan modelin sıfır
maliyet yazması, kayıt sonrası fiyat değişimi.

Aynı ekran admin panelinde filtresiz olarak yeniden kullanılabilir.

---

## Umur'la konuşulacaklar

### 1 · Portal girişi API anahtarıyla — geçici çözüm

Müşteri `sk-proxy-...` anahtarını portala yazarak giriyor.

**Sorun:** portal parolası ile API anahtarı aynı sır oluyor. Normal bir üründe portal
girişini çalan biri sadece panoyu görür; bizde doğrudan API'yi kullanmaya başlar.

**Olması gereken:** e-posta + şifreyle giriş, API anahtarı hiç tarayıcıya girilmez.

**Teknik iş yarım gün** — Supabase Auth zaten elimizde. Asıl gereken kararlar:

- Hesabı kim açıyor? Müşteri kendi mi kaydoluyor, biz mi davet ediyoruz?
- Bir müşteriden birden fazla kişi giriş yapabilecek mi?
- Kaydolan kişinin hangi müşteriye ait olduğu nasıl belirleniyor?
- Kişi şirketten ayrılırsa erişimi nasıl kesiliyor?

### 2 · `key_prefix` kolonu gerekiyor

Portal şu an `sk-proxy-39••••••••faf2` gösterebiliyor, ama **yalnızca kullanıcı anahtarı
az önce yazdığı için.** Veritabanında sadece SHA-256 özeti var.

E-posta/şifreyle girişe geçince gösterecek hiçbir şey kalmaz.

**Gereken:** `client_keys` tablosuna `key_prefix` kolonu — oluşturma sırasında baştan
~11, sondan 4 karakter yazılır. Güvenlik açığı değil; o kadarıyla anahtar tahmin
edilemez ama kullanıcı hangisi olduğunu tanır. Helicone da aynısını yapıyor.

### 3 · Bir müşteriye birden fazla anahtar

Şema destekliyor (`environment` kolonu var) ama şu an her müşteride tek anahtar var ve
ikincisini eklemenin yolu yok.

Neden gerekecek:

- **Ortam ayrımı** — geliştirme ve üretim anahtarları ayrı olmalı
- **Kesintisiz yenileme** — anahtar sızarsa yeni oluştur, uygulamaya koy, eskiyi kapat.
  Tek anahtarla yenileme kesinti demek.
- **Uygulama ayrımı** — biri sızınca sadece o kapansın

Eksikler:

| Ne | Durum |
|---|---|
| Var olan müşteriye yeni anahtar ekleme | `createNewClient` sadece yeni müşteriyle birlikte oluşturuyor |
| Anahtar iptali | `is_active` kolonu var ama onu `false` yapan kod yok |
| Anahtar bazında kullanım | `logs` tablosunda `key_id` yok |

### 4 · Fiyat değişimini takip edebilmek için `updated_at`

Doğrulama ekranı "uyuşmuyor" dediğinde iki ihtimal var: hesapta hata var ya da kayıt
yazıldıktan sonra fiyat değişmiş. İkisini ayırmak için fiyatın ne zaman güncellendiğini
bilmek gerekiyor.

Bu, model kataloğu tablosu konusuna bağlanıyor.

---

## Senden gereken — özet

| # | Konu | İş |
|---|---|---|
| 1 | E-posta/şifre girişi | Önce karar, sonra Supabase Auth + kullanıcı↔müşteri bağı |
| 2 | `key_prefix` kolonu | Küçük şema değişikliği |
| 3 | Çoklu anahtar | Ekleme ucu + iptal + `logs.key_id` |
| 4 | Fiyat `updated_at` | Model kataloğu tablosuyla birlikte |

2 ve 4 birer kolon, birlikte yapılabilir. 1 ve 3 önce karar istiyor.

---

## Sırada ne var

Admin paneli. Senin sorduğun diğer iki madde orada yaşıyor:

- **Models** — yeni model ekle, fiyat gir, aktif et
- **Pricing** — test hesaplayıcı, hesabın doğruluğunu tek ekrandan sına

İkisi de model kataloğunun veritabanına taşınmasına bağlı.

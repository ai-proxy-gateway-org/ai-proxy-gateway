# Model ve fiyat yönetimi — yol haritası

## Çözülecek iki somut sorun

**1 · Müşteri başka bir modele geçmek istiyor**
`gpt-5` kullanıyor, `gpt-5.5`'e geçmek istiyor. Bugün hata alıyor ve iki ayrı insan
müdahalesi gerekiyor: biri modeli sisteme tanıtmalı (kod değişikliği + dağıtım), biri
müşteriye açmalı.

**2 · Fiyatların doğru olması gerekiyor**
Fiyat listesi 16 Ağustos'tan beri sabit ve güncelleyecek bir mekanizma yok. Sağlayıcı
fiyat değiştirirse sistem sessizce yanlış hesaplar; kimse fark etmez.

## Tasarım kısıtları

- **Barındırma platformuna bağımlı olmayacak** — Vercel'e özgü zamanlanmış iş yok
- **Veritabanı seçimine bağımlı olmayacak** — yeni tablo açılmayacak
- **Ücretsiz çalışacak** — ek servis, ek plan gerektirmeyecek

---

## Tasarımın dayandığı üç karar

### Karar 1 · Katalog veri değil, belgedir

Model listesi ve fiyatlar bir **JSON belgesi** olarak bir adreste yayınlanır. Proxy onu
çalışma anında indirir.

```
MODEL_CATALOG_URL=https://.../model-catalog.json
```

Ayar verilmezse projenin yayınladığı varsayılan belge kullanılır. Kuran kişi kendi
belgesini gösterebilir — sözleşmeli fiyatı olan bir kurum için zaten gerekli, çünkü liste
fiyatları onlar için baştan yanlış.

Belge nerede durursa dursun fark etmiyor: depodaki ham dosya, statik sunucu, herhangi bir
adres. Proxy sadece HTTP ile okuyor.

**Sonuç:** fiyat güncellemek ne dağıtım ne veritabanı işlemi. Belgeyi düzenleyip
yayınlıyorsun.

### Karar 2 · Zamanlayıcı yok, tembel yenileme var

Katalog belleğe alınır ve süresi dolduğunda **bir sonraki istek** yenilemeyi tetikler.

Trafik yoksa yenilenmez — ama trafik yoksa yenilenmesine gerek de yok. Kendi kendini
dengeler.

Bu her ortamda aynı çalışır: sunucusuz platformda, sanal makinede, Docker'da. Çünkü
zamanlayıcı değil, sadece kod.

### Karar 3 · Katalog bir kapı değil, fiyat defteridir

Bugün fiyatı bilinmeyen model reddediliyor. Gerekçesi şuydu: *"maliyet sessizce sıfır
görünmesin."*

Ama sistemde bunu çözen bir şey zaten var: `logs` tablosunda token'lar ayrı ayrı
tutuluyor. Fiyat sonradan öğrenilse bile o kayıtlar yeniden hesaplanabilir.

O zaman katalogun kapı olmasına gerek yok. **Kapı zaten `allowed_models`** — politika
kararı orada veriliyor. Katalog sadece "bu modelin fiyatı ne" sorusunu cevaplıyor.

Bu, bir katmanı tamamen ortadan kaldırıyor.

---

## Aşamalar

### F1 · Katalog uzak belgeye taşınsın

Belge biçimi:

```json
{
  "openai/gpt-4o":  { "input": 0.005, "output": 0.015 },
  "openai/gpt-5.5": { "input": null,  "output": null  }
}
```

Fiyat **null olabilir** — "model tanınıyor ama fiyatı henüz bilinmiyor" geçerli bir durum.

Kurallar:
- Bellekte tutulur, süresi dolunca ilk istekte yenilenir
- Adres okunamazsa **eldeki liste kullanılmaya devam eder**
- Hiç okunamamışsa pakete gömülü `model_pricing.json` yedek olarak çalışır
- Maliyet hesabı ve katalog kontrolü aynı kaynaktan okur

**Sonuç:** Yeni model eklemek dağıtım gerektirmiyor.

### F2 · Fiyatı bilinmeyen model engellenmesin

```
Fiyatı bilinmeyen model isteği gelir
  → allowed_models kontrolünden geçiyorsa KABUL EDİLİR
  → log'a token'lar yazılır, maliyet "bekliyor" olarak işaretlenir
  → bütçe kapısı için o sağlayıcının en pahalı bilinen fiyatı varsayılır
```

Tahmin daima **yukarı** yuvarlanır. Bütçe asla eksik hesaplamaz.

**Sonuç:** Müşteri, kataloğa yeni giren bir modeli beklemeden kullanabilir.

### F3 · Gerçek maliyet — zamanlayıcı değil, uç nokta

```
POST /admin/sync        ← yönetici anahtarıyla korunur
```

Yaptığı iş:

```
1. OpenAI ve Anthropic'in fatura ucundan dünkü gerçek maliyeti çek
2. o modele ait logs kayıtlarının token toplamını hesapla
3. gerçek maliyeti token payına göre müşterilere dağıt
4. logs.cost alanlarını gerçek rakamla güncelle, kaynağını işaretle
5. gerçek maliyet ÷ token = gerçek birim fiyat → katalogdakiyle karşılaştır
6. sapma varsa rapor et
```

Dağıtım yaklaşık değil kesin: o sağlayıcıya giden bütün trafik proxy'den geçiyor.

**Tetikleyici operatörün seçimi.** Vercel cron, GitHub Actions, sanal makinede cron, bir
izleme servisi ya da elle. Proje hiçbirine bağlı değil. Hiç tetiklenmezse sistem çalışmaya
devam eder, sadece mutabakat yapılmaz.

| Sağlayıcı | Gerçek maliyet | Yöntem |
|---|---|---|
| OpenAI | ✓ | `/organization/costs` |
| Anthropic | ✓ | `/v1/organizations/usage_report/messages` |
| Gemini | ✗ | Google Cloud Billing üzerinden, ayrı entegrasyon — sonraya |

Kaynağı olmayan sağlayıcı tahminle devam eder ve kayıtta böyle işaretlenir.

### F4 · Model keşfi — aynı uçta

`/admin/sync` aynı çalışmada üç sağlayıcının model listesi ucuna da gider:

```
→ katalogda olmayan yeni model varsa rapor et
→ katalogda olup sağlayıcıda olmayan model varsa rapor et
```

Model listesi uçları token harcamaz, bedava.

**Yazmıyor, rapor ediyor.** Belgeyi insan güncelliyor. Fiyat onayının insanda kalmasına
zaten karar verilmişti; bu onunla tutarlı.

**Sonuç:** Yeni model çıktığını ve kapatılan modeli, müşteriden önce öğreniyorsunuz.

### F5 · Bütçe tavanı

`clients` tablosuna dönemsel limit alanı. İstek öncesi kontrol, tahmin üzerinden, yukarı
yuvarlanmış. Gerçek maliyet geldiğinde sayaç düzeltilir.

Yeni tablo değil, var olan tabloya alan — müşteri verisi olduğu için başka yerde
duramaz.

### F6 · Durum `/health` üzerinden görünür olsun

Zamanlayıcı olmadığı için "iş çalışıyor mu" sorusunun cevabı da zamanlayıcıda olamaz.
Bunun yerine durum dışarı açılır:

```json
{
  "catalog":  { "source": "remote", "models": 42, "age_minutes": 7 },
  "last_sync": { "at": "2026-08-25T03:11:00Z", "age_hours": 26, "stale": true }
}
```

Operatörün izleme aracı buna bakar. Platformdan bağımsız, ek servis gerektirmiyor.

**Bu atlanamaz.** Yoksa mutabakat aylarca çalışmaz ve kimse fark etmez — çözmeye
çalıştığınız sessiz hatanın bir kat yukarıdaki hali.

---

## Sıra

| Aşama | İş | Bağımlılık | Gerçek anahtar gerekir mi |
|---|---|---|---|
| F1 | Katalog uzak belgeye | — | Hayır |
| F2 | Bilinmeyen fiyat engellemesin | F1 | Hayır |
| F6 | Durum `/health`'te | — | Hayır |
| F3 | Gerçek maliyet ucu | F1 | **Evet** |
| F4 | Model keşfi (aynı uç) | F3 | **Evet** |
| F5 | Bütçe tavanı | F2 | Hayır |

F1, F2, F6 ve F5 şimdi yapılabilir. F3 ve F4 gerçek API anahtarlarını bekliyor.

---

## İki sorun bu yol haritasından sonra

**Müşteri `gpt-5.5`'e geçmek istiyor:**

```
F1 sonrası → model belgeye eklenir, dağıtım yok
F2 sonrası → fiyatı bilinmese de çalışır
F4 sonrası → model çıktığı gün zaten haberiniz olmuştur
F5 + karar → bütçe birincil kontrol olursa müşteri kendi geçer
```

**Fiyatlar doğru olsun:**

```
F1 sonrası → düzeltmek belge düzenlemek, dağıtım yok
F3 sonrası → gerçek fatura ile karşılaştırılır, sapma raporlanır
F3 sonrası → fatura rakamı logs'a yazılır — fatura artık tahminden gelmiyor
F6 sonrası → mutabakat durursa fark edilir
```

Fiyat tablosunun eskimesi **zararsız** hale geliyor, çünkü fatura ondan gelmiyor. Tahmin
sadece bütçe kapısında kullanılıyor ve yukarı yuvarlandığı için yanılması güvenli tarafta.

---

## Karara bağlanması gereken tek şey

**Model izin listesi mi, bütçe tavanı mı birincil kontrol olacak?**

İkisi aynı endişeye karşı önlem: *"yeni ve pahalı modellere kontrolsüz erişim
engellenmeli."* Bu bir maliyet endişesi ve bütçe tavanı onu doğrudan çözüyor.

| Seçenek | Müşteri yeni modele geçmek istediğinde |
|---|---|
| İzin listesi birincil kalır | Birini bekler |
| Bütçe birincil, izin listesi istisna için | Kendi geçer |

Teknik değil politika kararı. Sistemin gerçekten otomatik olup olmayacağını belirleyen
tek soru bu.

---

## Bilerek çözülmeyenler

- **Gemini için gerçek maliyet** — Cloud Billing entegrasyonu ayrı ve ağır, sonraya
- **Anlık kesin maliyet** — gerçek rakam mutabakat sonrası. Anlık karar tahminle verilir
- **Sistemin fiyatı kendi yayınlaması** — veritabanı bağımsızlığı tercih edildiği için
  sistem yazamaz, rapor eder; belgeyi insan günceller
- **Model yetenek farkları** — pass-through gereği doğrulanmaz, sağlayıcının hatası
  müşteriye aynen geçer

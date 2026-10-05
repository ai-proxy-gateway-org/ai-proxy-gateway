# Admin Panel ve Müşteri Portalı — tasarım notu

Umur'un isteği: *"Şu an bunu, token ücret hesabının doğruluğunun kontrolünü, yeni model
çıktığında nasıl aktive edeceğimizi ve taslak bir frontend'e ihtiyacımız var."*

Bu dört madde ayrı ayrı işler gibi görünüyor ama üçü aynı yerde buluşuyor: **bir arayüz.**
Bu not, o arayüzü nasıl kurguladığımı anlatıyor.

---

## 1 · Hangi boşlukları kapatıyor

Projede şu ana kadar hiç kimsenin görevine yazılmamış üç boşluk vardı:

| Boşluk | Bugün nasıl yapılıyor | Panel sonrası |
|---|---|---|
| Müşteri ve anahtar yönetimi | Supabase panelinden elle satır ekleyerek | Admin ekranından |
| Model ve fiyat yönetimi | `model_pricing.json` dosyasını düzenleyip dağıtarak | Admin ekranından *(katalog taşınınca)* |
| Müşterinin kendi kullanımını görmesi | **Hiçbir yolu yok** | Portal |

Bir de Umur'un ayrıca sorduğu iki şey var:

| Soru | Cevabı nerede |
|---|---|
| Token ücret hesabı doğru mu | Admin → Kullanım ekranı, hesabı açık gösteriyor |
| Yeni model çıkınca nasıl aktive edilir | Admin → Modeller ekranı, fiyat gir + aktif et |

---

## 2 · Dört tasarım kararı

### Ayrı uygulama değil, aynı sunucudan sayfa

Panel ayrı bir React/Next projesi olarak değil, mevcut Fastify sunucusunun döndürdüğü
sayfalar olarak yazıldı.

**Neden:** `vercel.json` şu an bütün yolları `/api/index`'e yönlendiriyor. Ayrı bir statik
arayüz eklemek o kuralla çakışırdı. Ayrıca bu yolla derleme adımı, ikinci bir dağıtım ve
ikinci bir proje yönetimi gerekmiyor — aynı dağıtımla canlıya çıkıyor.

**Bedeli:** Arayüz büyürse tek dosyada HTML tutmak zorlaşır. O noktaya gelirsek ayırırız;
taslak için doğru tercih bu.

### Yeni kimlik sistemi kurulmadı

Portal girişi için Supabase Auth, e-posta/şifre ya da oturum yönetimi eklenmedi. Müşteri
**zaten sahip olduğu proxy anahtarıyla** giriş yapıyor.

**Neden:** Anahtarı doğrulayan kod (`verifyClient`) sistemde zaten var ve her istekte
çalışıyor. İkinci bir kimlik mekanizması kurmak, aynı işi iki yerde yapmak olurdu.

**Sonucu:** "Anahtarın neyse portalın o." Yeni tablo yok, yeni akış yok.

**Bedeli:** Gerçek üründe oturum tabanlı giriş olmalı — anahtar her sayfa açılışında
yeniden girilmek zorunda. Taslak için kabul edilebilir.

### Tarayıcı veritabanına doğrudan bağlanmıyor

Panel, Supabase'e doğrudan gitmiyor; kendi API uçlarımıza gidiyor, veriyi sunucu okuyor.

**Neden:** Doğrudan bağlanmak için tarayıcıya bir veritabanı anahtarı vermek ve satır
bazlı erişim kuralları yazmak gerekirdi. Sunucu üzerinden gidince ikisi de gereksiz.

### Müşteri kimliği istekten değil, anahtardan alınıyor

```
İstek:  authorization: Bearer sk-proxy-...
        ↓
        verifyClient → clientId
        ↓
Sorgu:  where client_id = <doğrulanmış kimlik>
```

Müşteri "bana şu müşterinin kayıtlarını ver" diyemiyor, çünkü hangi kimliğin
sorgulanacağını o belirlemiyor.

---

## 3 · Müşteri Portalı — ekranlar

### Giriş
Anahtar kutusu. Doğrulanmazsa hata, doğrulanırsa panele geçiş. Anahtar tarayıcı deposuna
yazılmıyor, yalnızca sayfa açık kaldığı sürece bellekte tutuluyor.

### Kendi kullanımı
```
İzinli modeller     openai/gpt-4o   anthropic/claude-3-5-sonnet   gemini/gemini-1.5-pro

100          732            1160           $0.020316
istek        girdi token    çıktı token    toplam maliyet

Tarih   Model                        Girdi  Çıktı  Süre     Maliyet      Durum
23.08   anthropic/claude-3-5-sonnet  9      14     1095 ms  $0.000237    başarılı
23.08   gemini/gemini-1.5-pro        0      0      0 ms     $0.000000    yetkiniz yok
```

Reddedilen istekler de listede — `logs` iki aşamalı yazıldığı için yarıda kalan ve
reddedilen istekler iz bırakıyor. Müşteri neden reddedildiğini kendi görebiliyor;
şu an bunun için bize yazması gerekiyor.

**Durum: yapıldı.**

---

## 4 · Admin Panel — ekranlar

### Ekran 1 · Kullanım *(Umur'un "hesap doğru mu" maddesi)*

Portaldaki tablonun filtresiz hali — bütün müşteriler. Ama bir farkla: **hesap açık
gösteriliyor.**

```
Tarih   Müşteri   Model    Girdi         Çıktı          Maliyet
14:02   Test-A    gpt-4o   10 × 0.005    15 × 0.015  =  0.000275 $
```

Dört sayı da ekranda olduğu için hesabın doğruluğu gözle doğrulanabiliyor. Ayrı bir
denetim aracı yazmaya gerek kalmıyor.

> Uzun vadede sağlayıcının fatura API'siyle karşılaştırma yapılabilir; o ayrı bir iş ve
> gerçek API anahtarları gelmeden çalışmaz.

### Ekran 2 · Müşteriler

```
Ad          Anahtar     İzinli modeller                 Domainler      Durum
Test-A      ●●●●1a2b    openai/gpt-4o, anthropic/...    company.com    aktif   [düzenle]

[+ Yeni müşteri]
```

- Yeni müşteri oluşturma ve anahtar üretme — `createNewClient` zaten var, arayüze bağlanacak
- Anahtar bir kez gösterilir, sonra bir daha gösterilmez (özeti saklanıyor, kendisi değil)
- İzinli model listesi düzenleme — bugün Supabase panelinden elle yapılıyor

### Ekran 3 · Modeller *(Umur'un "yeni model aktivasyonu" maddesi)*

```
Sağlayıcı   Model              Girdi    Çıktı    Durum
openai      gpt-4o             0.005    0.015    ● aktif      [düzenle]
openai      gpt-5.5            —        —        ○ pasif      [fiyat gir]
```

**Aktivasyon akışı:** model listeye pasif ve fiyatsız girer → fiyatı girilir → aktif
edilir → müşterinin izinli listesine eklenir.

İki katman bilinçli olarak korunuyor: kataloğa eklenen model **otomatik olarak müşterilere
açılmıyor.** Kurallarda "yeni ve pahalı modellere kontrolsüz erişim engellenmeli" yazıyor.

**Ön koşulu var:** Model kataloğu şu an `model_pricing.json` dosyasında ve yazılamıyor.
Panelden fiyat düzenlemek için katalogun veritabanına taşınması gerekiyor. Taşınmazsa bu
ekran **salt-okunur** kalır — modeller listelenir, düzenlenemez.

---

## 5 · Neyi bilerek yapmadım

| Yapılmayan | Neden |
|---|---|
| Supabase Auth ile oturum | Anahtar zaten doğrulanabiliyor; taslak için ikinci kimlik sistemi fazlalık |
| Grafik ve istatistik ekranları | Tablo yeterli bilgi veriyor, süre grafiklere gitmiyor |
| Keşfedilen modeller onay kuyruğu | Model keşfi işi henüz yok, onaylanacak model de yok |
| Bütçe tanımlama ekranı | Bütçe tavanı özelliği henüz yok |
| Ayrı frontend projesi | Derleme, ikinci dağıtım ve yönlendirme çakışması getirirdi |

Bunların hepsi sonraki adımlar — kapsam dışı bırakıldıkları için değil, sıraları
gelmediği için.

---

## 6 · Panelin görünür kıldığı eksikler

Arayüz kurulduğunda bazı boşluklar **daha da görünür** olacak. Bunları şimdiden yazıyorum:

**Harcama görünüyor ama durdurulamıyor.** Panelde bir müşterinin toplam maliyeti
görünecek, ama sınıra geldiğinde durduran bir mekanizma yok. Hız limiti istek sayısını
sınırlıyor, parayı değil.

**Fiyat listesi eskiyebilir.** Panelden fiyat girilebilecek ama fiyatın güncel olup
olmadığını söyleyen bir şey yok.

**Kimin ne zaman ne değiştirdiği tutulmuyor.** Admin panelinden model açılıp kapatılacak,
müşteri izinleri değişecek — ama bu değişikliklerin kaydı yok.

İlk ikisi zaten yol haritasında. Üçüncüsü panelle birlikte doğan yeni bir ihtiyaç.

---

## 7 · Sıra

| Sıra | İş | Durum |
|---|---|---|
| 1 | Portal — giriş | **bitti** |
| 2 | Portal — kullanım listesi ve özet | **bitti** |
| 3 | Admin — kullanım ekranı (hesap kırılımlı) | sırada |
| 4 | Admin — müşteriler ekranı | |
| 5 | Admin — modeller ekranı *(salt-okunur ya da düzenlenebilir)* | |
| 6 | Canlıya alma ve prova | |

Portal önce yapıldı çünkü kullanım tablosu iki panelde de aynı — portalda yazılan tablo
admin ekranında filtresiz olarak yeniden kullanılıyor.

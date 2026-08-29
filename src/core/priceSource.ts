// Dış fiyat kaynağı.
//
// Sorun: model fiyatlarını elle giriyoruz ve hiçbir şey doğruluğunu kontrol
// etmiyor. OpenAI gpt-4o'nun fiyatını yarıya düşürdüğünde tablomuz eski kaldı
// ve kimse fark etmedi — müşteriye gerçek maliyetin iki katı raporlandı.
//
// Çözüm: karşılaştırma. Fiyatları körlemesine üzerine yazmıyoruz; kaynakla
// aramızdaki farkı görünür kılıyoruz ve kararı yöneticiye bırakıyoruz.
// Tek istisna fiyat düşüşü — orada beklemenin bir faydası yok, müşteriye
// fazla fatura çıkarmaya devam etmiş oluruz.
//
// Kaynak: OpenRouter'ın herkese açık model listesi. Anahtar istemiyor,
// ücretsiz, yüzlerce modeli tek çağrıda döndürüyor. Bağımlılık değil:
// çekme başarısız olursa fiyatlarımız olduğu gibi kalır, hiçbir şey bozulmaz.

const KAYNAK = 'https://openrouter.ai/api/v1/models';

// Fiyat listesi günde bir kez değişiyor; saatte bir çekmek fazlasıyla yeterli.
const TAZELEME_MS = 60 * 60 * 1000;

export interface KaynakFiyat {
  id: string;
  ad: string;
  // 1000 token başına — kendi kayıt birimimizle aynı, karşılaştırma
  // sırasında dönüştürme hatası olmasın diye burada çeviriyoruz.
  girdi: number;
  cikti: number;
}

interface Onbellek {
  fiyatlar: Map<string, KaynakFiyat>;
  yuklenme: number;
}

let onbellek: Onbellek | null = null;
let surmekte: Promise<Onbellek> | null = null;

async function cek(): Promise<Onbellek> {
  const yanit = await fetch(KAYNAK, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  if (!yanit.ok) throw new Error(`Fiyat kaynağı ${yanit.status} döndü`);

  const govde = (await yanit.json()) as {
    data?: Array<{
      id?: string;
      name?: string;
      pricing?: { prompt?: string; completion?: string };
    }>;
  };

  const fiyatlar = new Map<string, KaynakFiyat>();
  for (const m of govde.data ?? []) {
    if (!m.id || !m.pricing) continue;
    const g = Number(m.pricing.prompt);
    const c = Number(m.pricing.completion);
    // Ücretsiz ya da fiyatı olmayan modeller karşılaştırmaya girmiyor:
    // sıfır fiyat gerçek bir değer değil, "bilinmiyor" demek.
    if (!Number.isFinite(g) || !Number.isFinite(c) || (g <= 0 && c <= 0)) continue;
    // Kaynak token başına veriyor, biz 1000 token başına saklıyoruz.
    fiyatlar.set(m.id, { id: m.id, ad: m.name ?? m.id, girdi: g * 1000, cikti: c * 1000 });
  }

  if (!fiyatlar.size) throw new Error('Fiyat kaynağı boş liste döndü');
  return { fiyatlar, yuklenme: Date.now() };
}

// Katalog önbelleğiyle aynı desen: taze veri varsa onu ver, yoksa çek.
// Çekme başarısız olur ve elde eski bir kopya varsa onu kullanmaya devam et —
// eski fiyat, hiç fiyat olmamasından iyi.
export async function kaynakFiyatlari(): Promise<Onbellek | null> {
  if (onbellek && Date.now() - onbellek.yuklenme < TAZELEME_MS) return onbellek;
  if (surmekte) return surmekte;

  surmekte = cek()
    .then((y) => { onbellek = y; return y; })
    .finally(() => { surmekte = null; });

  try {
    return await surmekte;
  } catch {
    return onbellek;
  }
}

export function kaynakBilgisi(): { yuklendiMi: boolean; modelSayisi: number; yasSaniye: number | null } {
  return {
    yuklendiMi: onbellek !== null,
    modelSayisi: onbellek?.fiyatlar.size ?? 0,
    yasSaniye: onbellek ? Math.round((Date.now() - onbellek.yuklenme) / 1000) : null
  };
}

// Eşleştirme yardımı: bizim modelimiz için kaynakta olası karşılıkları tahmin
// eder. Kesin sonuç vermez — yönetici seçer, seçim source_id'ye yazılır.
// Amaç ilk eşleştirmeyi elle aramaktan kurtarmak.
export function olasiKarsiliklar(
  provider: string,
  model: string,
  fiyatlar: Map<string, KaynakFiyat>
): string[] {
  // 'claude-3-5-sonnet' ile 'claude-3.5-sonnet' aynı model; ayraçları
  // atıp karşılaştırıyoruz.
  const sadelestir = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hedef = sadelestir(model);

  // Sağlayıcı adları da tutmuyor: bizde 'gemini', kaynakta 'google'.
  const saglayiciEs: Record<string, string[]> = {
    openai: ['openai'],
    anthropic: ['anthropic'],
    gemini: ['google']
  };
  const kabul = saglayiciEs[provider] ?? [provider];

  // Kelime sırası da tutmayabiliyor: bizde 'claude-4-opus', kaynakta
  // 'claude-opus-4'. Parçalara ayırıp sıralayınca ikisi aynı kümeye düşüyor.
  const parcala = (t: string) =>
    t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).sort().join('-');
  const hedefParca = parcala(model);

  const tam: string[] = [];
  const parcaEs: string[] = [];
  const kismi: string[] = [];
  for (const id of fiyatlar.keys()) {
    const [sag, ...kalan] = id.split('/');
    if (!kabul.includes(sag ?? '')) continue;
    const kuyruk = kalan.join('/');
    const ad = sadelestir(kuyruk);
    if (ad === hedef) tam.push(id);
    else if (parcala(kuyruk) === hedefParca) parcaEs.push(id);
    else if (ad.includes(hedef) || hedef.includes(ad)) kismi.push(id);
  }
  // Tam eşleşme, sonra kelime kümesi eşleşmesi, sonra kısmiler.
  // Her grupta kısa ad üste: tarihli kopyalar değil kanonik ad öne gelsin.
  const kisaOnce = (a: string, b: string) => a.length - b.length;
  return [...tam, ...parcaEs.sort(kisaOnce), ...kismi.sort(kisaOnce)].slice(0, 8);
}


// ---------------------------------------------------------------------------
// İkinci kaynak: LiteLLM'in fiyat listesi (GitHub'da ham JSON dosyası).
//
// Tek kaynağa bağlı kalmak iki riski taşıyor: kaynak modeli listeden düşerse
// fiyatı doğrulayamayız, kaynak yanılırsa yanlışı sessizce uygularız.
// İkinci bir liste ikisini de karşılıyor — biri düşse öbürü tutuyor, ikisi
// aynı fiyatı söylüyorsa güven yüksek, ayrılıyorlarsa hiçbiri uygulanmıyor.
// ---------------------------------------------------------------------------

const LITE_KAYNAK =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

let liteOnbellek: Onbellek | null = null;
let liteSurmekte: Promise<Onbellek> | null = null;

async function liteCek(): Promise<Onbellek> {
  const yanit = await fetch(LITE_KAYNAK, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20000)
  });
  if (!yanit.ok) throw new Error(`LiteLLM listesi ${yanit.status} döndü`);

  const govde = (await yanit.json()) as Record<string, {
    input_cost_per_token?: number;
    output_cost_per_token?: number;
    litellm_provider?: string;
  }>;

  const fiyatlar = new Map<string, KaynakFiyat>();
  for (const [anahtar, m] of Object.entries(govde)) {
    // Dosyanın başında 'sample_spec' gibi şablon kayıtlar var; fiyatı
    // olmayan her şeyi atlıyoruz.
    const g = m?.input_cost_per_token;
    const c = m?.output_cost_per_token;
    if (typeof g !== 'number' || typeof c !== 'number') continue;
    if (g <= 0 && c <= 0) continue;
    fiyatlar.set(anahtar, { id: anahtar, ad: anahtar, girdi: g * 1000, cikti: c * 1000 });
  }

  if (!fiyatlar.size) throw new Error('LiteLLM listesi boş döndü');
  return { fiyatlar, yuklenme: Date.now() };
}

export async function liteFiyatlari(): Promise<Onbellek | null> {
  if (liteOnbellek && Date.now() - liteOnbellek.yuklenme < TAZELEME_MS) return liteOnbellek;
  if (liteSurmekte) return liteSurmekte;

  liteSurmekte = liteCek()
    .then((y) => { liteOnbellek = y; return y; })
    .finally(() => { liteSurmekte = null; });

  try {
    return await liteSurmekte;
  } catch {
    return liteOnbellek;
  }
}

export interface KaynakDurumu {
  openrouter: { erisilebilir: boolean; modelSayisi: number; yasSaniye: number | null };
  litellm:    { erisilebilir: boolean; modelSayisi: number; yasSaniye: number | null };
}

export function kaynakDurumu(): KaynakDurumu {
  const yas = (o: Onbellek | null) => o ? Math.round((Date.now() - o.yuklenme) / 1000) : null;
  return {
    openrouter: { erisilebilir: onbellek !== null, modelSayisi: onbellek?.fiyatlar.size ?? 0, yasSaniye: yas(onbellek) },
    litellm:    { erisilebilir: liteOnbellek !== null, modelSayisi: liteOnbellek?.fiyatlar.size ?? 0, yasSaniye: yas(liteOnbellek) }
  };
}

// ---------------------------------------------------------------------------
// Birleşik arama.
//
// Bir model için birden çok kimlik saklanıyor: sağlayıcı adı değiştirdiğinde
// eskisi ve yenisi birlikte listede duruyor, hangisi bulunursa o kullanılıyor.
// ---------------------------------------------------------------------------

export interface KaynakOkuma {
  kaynak: 'openrouter' | 'litellm';
  kimlik: string;
  girdi: number;
  cikti: number;
}

export function ilkBulunan(
  kimlikler: string[],
  fiyatlar: Map<string, KaynakFiyat>
): KaynakFiyat | null {
  for (const k of kimlikler) {
    const f = fiyatlar.get(k);
    if (f) return f;
  }
  return null;
}

export interface IkiKaynakSonucu {
  okumalar: KaynakOkuma[];
  // İki kaynak da okundu ve aynı fiyatı veriyorsa doğrulanmış sayılıyor.
  // Bu bayrak otomatik uygulama kararında kullanılıyor.
  dogrulandi: boolean;
  ayrisiyor: boolean;
  girdi: number | null;
  cikti: number | null;
}

export async function ikiKaynaktanOku(
  orKimlikleri: string[],
  liteKimlikleri: string[]
): Promise<IkiKaynakSonucu> {
  const [or, lite] = await Promise.all([kaynakFiyatlari(), liteFiyatlari()]);

  const okumalar: KaynakOkuma[] = [];
  const a = or ? ilkBulunan(orKimlikleri, or.fiyatlar) : null;
  if (a) okumalar.push({ kaynak: 'openrouter', kimlik: a.id, girdi: a.girdi, cikti: a.cikti });
  const b = lite ? ilkBulunan(liteKimlikleri, lite.fiyatlar) : null;
  if (b) okumalar.push({ kaynak: 'litellm', kimlik: b.id, girdi: b.girdi, cikti: b.cikti });

  if (!okumalar.length) {
    return { okumalar, dogrulandi: false, ayrisiyor: false, girdi: null, cikti: null };
  }

  if (okumalar.length === 1) {
    const t = okumalar[0]!;
    return { okumalar, dogrulandi: false, ayrisiyor: false, girdi: t.girdi, cikti: t.cikti };
  }

  const [x, y] = okumalar as [KaynakOkuma, KaynakOkuma];
  const ESIK = 0.000001;
  const ayni = Math.abs(x.girdi - y.girdi) < ESIK && Math.abs(x.cikti - y.cikti) < ESIK;

  // Ayrışıyorlarsa fiyat döndürüyoruz ama "doğrulandı" demiyoruz; karar
  // katmanı bu durumda otomatik uygulama yapmıyor.
  return {
    okumalar,
    dogrulandi: ayni,
    ayrisiyor: !ayni,
    girdi: x.girdi,
    cikti: x.cikti
  };
}

// ---------------------------------------------------------------------------
// Fiyat sürekliliğiyle yeniden eşleştirme.
//
// Ad değişikliğini insan müdahalesi olmadan atlatan tek mekanizma bu.
//
// Dayandığı gözlem: sağlayıcı bir modelin adını değiştirdiğinde fiyatını
// değiştirmez. Bambaşka bir modelin fiyatı ise hep çok farklıdır — gpt-4o ile
// gpt-4o-mini arasında 16 kat, gpt-4 ile 12 kat fark var. Yani fiyatın kendisi
// kimlik kanıtı olarak kullanılabiliyor.
//
// Kural bilerek dar: yalnızca TEK aday kalırsa bağlanıyor. Birden fazla aday
// eşiği geçiyorsa hangisi olduğu belirsizdir ve tahmin etmek, çözmeye
// çalıştığımız sorunun daha kötü halini üretir — yanlış fiyat, sessizce.
// ---------------------------------------------------------------------------

// Gerçek bir ad değişikliğinde sapma sıfırdır. Pay, sağlayıcının aynı dönemde
// küçük bir fiyat ayarı yapmış olma ihtimali için. Farklı bir model her zaman
// kat kat saptığı için eşiğin gevşek olması yanlış eşleşmeye yol açmıyor.
const SAPMA_PAYI = 0.25;

export interface EslesmeOnerisi {
  kimlik: string;
  girdi: number;
  cikti: number;
  sapma: number;
}

export interface YenidenEslesme {
  sonuc: 'baglandi' | 'aday-yok' | 'belirsiz';
  // Neden bağlandı: ad hâlâ listede duruyordu, ya da ad kaybolmuştu ve
  // fiyat sürekliliğinden bulundu. Panelde ayırt edilebilsin diye tutuluyor.
  gerekce: 'ad' | 'fiyat' | null;
  secilen: EslesmeOnerisi | null;
  adaylar: EslesmeOnerisi[];
}

export function fiyatlaYenidenEslestir(
  provider: string,
  model: string,
  sonGirdi: number,
  sonCikti: number,
  fiyatlar: Map<string, KaynakFiyat>
): YenidenEslesme {
  const adayKimlikleri = olasiKarsiliklar(provider, model, fiyatlar);

  // Önce ad. Model listede hâlâ kendi adıyla duruyorsa, o modeldir — fiyat
  // farkı varsa bu gerçek bir fiyat değişikliğidir ve denetimin zaten
  // göstermesi gereken şeydir.
  //
  // Sıralamayı ters kurmak tehlikeli: kayıtlı fiyatımız yanlışsa (elle
  // girilmiş, hiç doğrulanmamış olabilir) fiyat testi ada uyan doğru adayı
  // eler ve fiyatı yakın olan başka bir modele güvenle bağlanır. Denemede
  // tam bunu yaptı: gpt-5.5, fiyatımız yanlış olduğu için gpt-5'e bağlandı.
  const sadeAd = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const parcaAd = (t: string) =>
    t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).sort().join('-');
  const hedefSade = sadeAd(model), hedefParca = parcaAd(model);

  const adEsleseni = adayKimlikleri.filter((k) => {
    const kuyruk = k.split('/').slice(1).join('/');
    return sadeAd(kuyruk) === hedefSade || parcaAd(kuyruk) === hedefParca;
  });

  if (adEsleseni.length) {
    // Birden fazlaysa kanonik olan kısa addır.
    const kimlik = adEsleseni.reduce((a, b) => (b.length < a.length ? b : a));
    const f = fiyatlar.get(kimlik)!;
    const toplamEski = sonGirdi + sonCikti;
    const sapma = toplamEski > 0
      ? Math.abs((f.girdi + f.cikti) - toplamEski) / toplamEski
      : 0;
    return {
      sonuc: 'baglandi',
      gerekce: 'ad',
      secilen: { kimlik, girdi: f.girdi, cikti: f.cikti, sapma },
      adaylar: []
    };
  }

  const toplam = sonGirdi + sonCikti;
  const adaylar: EslesmeOnerisi[] = [];
  for (const k of adayKimlikleri) {
    const f = fiyatlar.get(k);
    if (!f) continue;
    // Sapmayı toplam fiyat üzerinden ölçüyoruz: girdi ve çıktının ayrı ayrı
    // küçük oynamaları tek başına eşleşmeyi bozmasın.
    const sapma = toplam > 0 ? Math.abs((f.girdi + f.cikti) - toplam) / toplam : Infinity;
    adaylar.push({ kimlik: k, girdi: f.girdi, cikti: f.cikti, sapma });
  }

  const gecenler = adaylar.filter((a) => a.sapma <= SAPMA_PAYI);

  if (gecenler.length === 0) {
    return { sonuc: 'aday-yok', gerekce: null, secilen: null, adaylar };
  }
  if (gecenler.length === 1) {
    return { sonuc: 'baglandi', gerekce: 'fiyat', secilen: gecenler[0]!, adaylar };
  }

  // Birden çok aday geçtiyse adın belirsiz olması sorun değil, fiyatın
  // belirsiz olması sorun. Sağlayıcılar aynı modelin tarihli kopyalarını
  // yayınlıyor (gpt-4o, gpt-4o-2024-11-20, gpt-4o-2024-08-06) ve üçü de
  // aynı fiyata sahip; hangisine bağlansak doğru fiyata ulaşıyoruz.
  //
  // Bu yüzden adaylar kendi aralarında da aynı fiyattaysa bağlanıyoruz.
  // Ayrılıyorlarsa hangisinin doğru olduğu gerçekten belirsiz, dokunmuyoruz.
  const toplamlar = gecenler.map((a) => a.girdi + a.cikti);
  const enAz = Math.min(...toplamlar);
  const enCok = Math.max(...toplamlar);
  const aralarindaFarkVar = enAz > 0 ? (enCok - enAz) / enAz > 0.01 : enCok > 0;

  if (aralarindaFarkVar) {
    return { sonuc: 'belirsiz', gerekce: null, secilen: null, adaylar };
  }

  // Hepsi aynı fiyatta. En kısa adı seçiyoruz: tarihli kopyalar zamanla
  // düşer, kanonik ad kalır.
  const secilen = gecenler.reduce((a, b) => (b.kimlik.length < a.kimlik.length ? b : a));
  return { sonuc: 'baglandi', gerekce: 'fiyat', secilen, adaylar };
}

// ---------------------------------------------------------------------------
// LiteLLM tarafında aday arama.
//
// Anahtar biçimi OpenRouter'dan farklı: bazıları düz ('gpt-4o'), bazıları
// yönlendirme öneki taşıyor ('vertex_ai/claude-3-5-sonnet',
// 'openrouter/anthropic/claude-3.5-sonnet'). Önek, modelin hangi platform
// üzerinden çağrıldığını anlatıyor — bizi ilgilendirmiyor, model adı aynı.
//
// Bu yüzden yalnızca son parçaya bakıyor, öneki yok sayıyoruz. Önekisiz
// anahtarlar öne alınıyor: onlar sağlayıcının doğrudan fiyatı.
// ---------------------------------------------------------------------------

export function liteAdaylari(
  model: string,
  fiyatlar: Map<string, KaynakFiyat>
): string[] {
  const sade = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const parca = (t: string) =>
    t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).sort().join('-');

  const hedefSade = sade(model);
  const hedefParca = parca(model);

  const tam: string[] = [];
  const parcaEs: string[] = [];
  for (const anahtar of fiyatlar.keys()) {
    const dilimler = anahtar.split('/');
    const kuyruk = dilimler[dilimler.length - 1] ?? '';
    if (sade(kuyruk) === hedefSade) tam.push(anahtar);
    else if (parca(kuyruk) === hedefParca) parcaEs.push(anahtar);
  }

  // Önce önek sayısı az olan (doğrudan sağlayıcı), sonra kısa ad.
  const sirala = (a: string, b: string) =>
    a.split('/').length - b.split('/').length || a.length - b.length;

  return [...tam.sort(sirala), ...parcaEs.sort(sirala)].slice(0, 8);
}

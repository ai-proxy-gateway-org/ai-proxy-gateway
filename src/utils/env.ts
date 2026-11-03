// .env dosyasını okuyup eksik ya da boş değişkenleri dolduruyor.
//
// Node'un --env-file'ı ortamda ZATEN var olan bir değişkenin üzerine yazmıyor.
// Kabukta bir kez `source .env` çalıştırıldıysa değişkenler orada takılı kalıyor
// ve dosyaya sonradan eklenenler görünmüyor; daha kötüsü, boş bırakılmış bir
// değişken de "tanımlı" sayılıp dosyadaki değeri eziyor.
//
// Bu yükleyici yalnızca yerel geliştirme ve kendi sunucunda (self-hosted)
// çalışma için: Vercel'de .env dosyası yok, değişkenler panelden geliyor ve
// işlev sessizce hiçbir şey yapmıyor.

import fs from 'node:fs';
import path from 'node:path';

export function yukleEnv(dosya = '.env'): void {
  const dosyaYolu = path.resolve(process.cwd(), dosya);
  if (!fs.existsSync(dosyaYolu)) return;

  for (const satir of fs.readFileSync(dosyaYolu, 'utf8').split(/\r?\n/)) {
    const t = satir.trim();
    if (!t || t.startsWith('#')) continue;

    const ayrac = t.indexOf('=');
    if (ayrac <= 0) continue;

    const ad = t.slice(0, ayrac).trim();
    let deger = t.slice(ayrac + 1).trim();

    // Tırnak içine alınmış değerler
    if (
      (deger.startsWith('"') && deger.endsWith('"')) ||
      (deger.startsWith("'") && deger.endsWith("'"))
    ) {
      deger = deger.slice(1, -1);
    }

    // Boş bir ortam değişkeni "tanımlı" sayılmıyor: kabukta kalmış boş bir
    // değer dosyadakini ezmesin.
    const mevcut = process.env[ad];
    if (mevcut === undefined || mevcut.trim() === '') {
      process.env[ad] = deger;
    }
  }
}

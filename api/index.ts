// app.ts artık Hono uygulaması dışa veriyor (Fastify değil). Bu dosya önceden
// Fastify'a özel app.ready()/app.server.emit() çağırıyordu — Hono'da ikisi de
// yok, her istekte çöküyordu. Hono'nun kendi Vercel adaptörü bunu çözüyor.
//
// export default handle(app) çalışıyor gibi görünüyordu ama Vercel'in
// çalışma zamanı bunu eski (req, res) tipi bir fonksiyon sanıyor, dönen
// Response nesnesini sessizce yok sayıyordu — istek hiç cevap almadan zaman
// aşımına uğruyordu. Vercel'in Web-standard fetch API fonksiyonları için
// beklediği isim tam olarak `fetch`; default export değil, adlandırılmış
// export olması gerekiyor.
import { handle } from 'hono/vercel';
import app from '../src/app.js';

export const fetch = handle(app);

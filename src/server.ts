// .env yüklemesi uygulama modüllerinden ÖNCE çalışmalı: db.ts gibi dosyalar
// ortam değişkenlerini içe aktarılırken okuyor, sonradan doldurmak geç kalıyor.
// Bu yüzden app.js dinamik olarak, yükleme bittikten sonra içe aktarılıyor.
import { yukleEnv } from './utils/env.js';

yukleEnv();

const { buildApp } = await import('./app.js');

const server = buildApp();

const start = async () => {
  try {
    await server.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();

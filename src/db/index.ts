// src/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let _db: DrizzleDb | null = null;

function connect(): DrizzleDb {
  if (_db) return _db;

  const connectionString = process.env.DATABASE_URL || '';
  if (!connectionString) {
    throw new Error("⚠️ DATABASE_URL bulunamadı. Lütfen .env dosyanızı kontrol edin.");
  }

  // Transaction pooling kullandığımız için özel bir connection limit belirtmemize gerek kalmadı
  const queryClient = postgres(connectionString);
  _db = drizzle(queryClient, { schema });
  return _db;
}

// Bağlantı modül import edilirken değil, db ilk kullanıldığında kurulur.
// Önceki hâlde DATABASE_URL eksikse import anında throw ediliyordu, bu da
// Vercel'de her soğuk başlangıçta TÜM rotaları (DB'ye hiç dokunmayanlar
// dahil) çökertiyordu. Artık eksik/yanlış env değişkeni yalnızca DB'ye
// dokunan isteği etkiler.
export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    return Reflect.get(connect(), prop, receiver);
  }
});
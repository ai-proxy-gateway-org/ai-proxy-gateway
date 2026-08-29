// src/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL || '';

if (!connectionString) {
  throw new Error("⚠️ DATABASE_URL bulunamadı. Lütfen .env dosyanızı kontrol edin.");
}

// Transaction pooling kullandığımız için özel bir connection limit belirtmemize gerek kalmadı
const queryClient = postgres(connectionString);

export const db = drizzle(queryClient, { schema });
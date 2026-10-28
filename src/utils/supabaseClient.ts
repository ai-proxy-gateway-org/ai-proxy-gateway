// Portal ve admin panelinin kullandığı Supabase istemcisi.
//
// Gateway'in kendi çekirdeği (src/db) artık Drizzle üzerinden doğrudan
// Postgres'e bağlanıyor ve services/db.ts bu yüzden bir supabase nesnesi
// dışa vermiyor. Portal/admin Drizzle'a taşınmadı — yönetim panelinin
// ihtiyacı (esnek sorgular, join'ler) Supabase-JS ile zaten karşılanıyordu,
// Drizzle'ın veritabanından bağımsız çekirdek amacı buraya uymuyor. Bu yüzden
// kendi bağlantısını kuruyor.
//
// Bağlantı ilk kullanımda (lazy) kurulur: SUPABASE_URL tanımlı değilken
// (ör. saf PostgreSQL, Docker veya özel IDatabase adaptörüyle çalışırken)
// sunucunun açılış anında çökmesini önler.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
  const key = process.env.SUPABASE_SERVICE_KEY || 'unconfigured-supabase-key';
  _client = createClient(url, key);
  return _client;
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabase(), prop, receiver);
  },
});

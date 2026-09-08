// Portal ve admin panelinin kullandığı Supabase istemcisi.
//
// Gateway'in kendi çekirdeği (src/db) artık Drizzle üzerinden doğrudan
// Postgres'e bağlanıyor ve services/db.ts bu yüzden bir supabase nesnesi
// dışa vermiyor. Portal/admin Drizzle'a taşınmadı — yönetim panelinin
// ihtiyacı (esnek sorgular, join'ler) Supabase-JS ile zaten karşılanıyordu,
// Drizzle'ın veritabanından bağımsız çekirdek amacı buraya uymuyor. Bu yüzden
// kendi bağlantısını kuruyor.
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

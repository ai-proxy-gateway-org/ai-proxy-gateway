import { createClient } from '@supabase/supabase-js';
import { generateProxyKey, hashApiKey } from '../utils/auth.js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function createNewClient(name: string, environment: string) {
  try {
    const { data: clientData, error: clientError } = await supabase
      .from('clients')
      .insert([{ name: name }])
      .select('id, name, is_active, client_type, allowed_domains, allowed_models')
      .single();

    if (clientError) throw new Error(`Error creating client: ${clientError.message}`);

    const plainApiKey = generateProxyKey();
    const hashedKey = hashApiKey(plainApiKey);

    const { error: keyError } = await supabase
      .from('client_keys')
      .insert([{
        client_id: clientData.id,
        key_hash: hashedKey,
        environment: environment
      }]);

    if (keyError) throw new Error(`Error adding key: ${keyError.message}`);

    return {
      success: true,
      clientId: clientData.id,
      plainApiKey: plainApiKey,
      message: "Client successfully created. Please save the API key now, it will not be shown again!"
    };

  } catch (error) {
    console.error("System Error:", error);
    return { success: false, error };
  }
}

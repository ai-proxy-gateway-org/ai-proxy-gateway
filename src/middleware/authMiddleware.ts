import { supabase } from '../services/db.js';
import { hashApiKey } from '../utils/auth.js';

/**
 * Verifies the provided Proxy API key.
 * Returns client details if successful, otherwise throws an error.
 * @param providedApiKey The "sk-proxy-..." key provided by the client
 */
export async function verifyClient(providedApiKey: string) {
  try {
    if (!providedApiKey || !providedApiKey.startsWith('sk-proxy-')) {
      return { success: false, error: 'Invalid API Key format', status: 401 };
    }

    const hashedKey = hashApiKey(providedApiKey);

    const { data: keyData, error: keyError } = await supabase
      .from('client_keys')
      .select(`
        id,
        is_active,
        environment,
        clients (
          id,
          name,
          is_active,
          client_type,
          allowed_domains,
          allowed_models
        )
      `)
      .eq('key_hash', hashedKey)
      .single();

    if (keyError || !keyData) {
      return { success: false, error: 'Unauthorized: Key not found', status: 401 };
    }

    const client = keyData.clients;
    const clientDetails = Array.isArray(client) ? client[0] : client;

    if (!keyData.is_active || !clientDetails?.is_active) {
      return { success: false, error: 'Forbidden: Client or key is inactive', status: 403 };
    }

    return {
      success: true,
      // Anahtarın kimliği: isteğin hangi anahtarla geldiği kayda yazılıyor,
      // böylece bir şirketin harcaması anahtar bazında kırılabiliyor.
      keyId: keyData.id,
      client: {
        id: clientDetails.id,
        name: clientDetails.name,
        environment: keyData.environment,
        client_type: clientDetails.client_type,
        allowed_domains: clientDetails.allowed_domains,
        allowed_models: clientDetails.allowed_models
      }
    };

  } catch (error) {
    console.error('Unexpected error during authentication:', error);
    return { success: false, error: 'Internal server error', status: 500 };
  }
}
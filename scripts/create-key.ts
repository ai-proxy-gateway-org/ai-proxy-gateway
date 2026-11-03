import { yukleEnv } from '../src/utils/env.js';
import { dbService } from '../src/services/databaseService.js';

yukleEnv();

async function main() {
  const name = process.argv[2] || 'Default Client';
  const environment = process.argv[3] || 'production';

  console.log(`⏳ Creating client "${name}" (${environment})...`);
  const res = await dbService.createNewClient(name, environment);

  if (!res || !res.success) {
    console.error('❌ Failed to create client:', res?.error ?? 'Unknown error');
    process.exit(1);
  }

  console.log('\n✅ Client and API key created successfully!');
  console.log('────────────────────────────────────────────────────────────');
  console.log(`Client ID : ${res.clientId}`);
  console.log(`API Key   : ${res.plainApiKey}`);
  console.log('────────────────────────────────────────────────────────────');
  console.log('⚠️  Save this API key now — only its SHA-256 hash is stored in the database.\n');
  console.log('Test it with curl:');
  console.log(`curl -X POST http://127.0.0.1:3000/v1/chat/completions \\`);
  console.log(`  -H "Authorization: Bearer ${res.plainApiKey}" \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello!"}]}'`);
  process.exit(0);
}

main();

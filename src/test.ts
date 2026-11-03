import { createNewClient } from './services/db.js';
import { verifyClient } from './middleware/authMiddleware.js';
import { checkRateLimit } from './middleware/rateLimiter.js';
import { checkDomainWhitelist } from './middleware/domainWhitelister.js';
import { logRequestStart, logRequestComplete } from './services/logger.js';

async function runTests() {
  console.log('⏳ Starting Database and Security Integration Test...\n');

  // 1. New Client Creation Test
  console.log('1️⃣ Creating a new client...');
  const createRes = await createNewClient('[TEST] Integration Project', 'development');
  
  if (!createRes.success) {
    console.error('❌ Failed to create client. Error:', createRes.error);
    return;
  }

  const apiKey = createRes.plainApiKey as string;
  console.log('✅ Client successfully created!');
  console.log('🔑 Generated API Key (To be given to the user):', apiKey);

  // 2. Valid Key Verification Test
  console.log('\n2️⃣ Testing verification with the valid key just generated...');
  const verifySuccess = await verifyClient(apiKey);
  console.log('🟢 Verification Result:', verifySuccess);

  // 3. Invalid Key Verification Test
  console.log('\n3️⃣ Testing verification with a fake/invalid key...');
  const verifyFail = await verifyClient('sk-proxy-fake-key-123456789');
  console.log('🔴 Verification Result (Should be rejected):', verifyFail);
}

async function runRateLimitTest() {
  console.log('\n🛡️ 4️⃣ Starting Redis Rate Limit Test...');
  
  const testClientId = 'test-client-123';
  const testLimit = 3; 
  
  for (let i = 1; i <= 5; i++) {
    const result = await checkRateLimit(testClientId, testLimit, 60);
    
    if (result.success) {
      console.log(`[Request ${i}] ✅ Success! Remaining limit: ${result.remaining}`);
    } else {
      console.log(`[Request ${i}] 🔴 BLOCKED! Error: ${result.error}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

function runDomainTest() {
  console.log('\n🌍 5️⃣ Starting Domain Whitelisting Test...\n');

  const allowed = ['company.com', 'project.io'];

  console.log('Scenario 1: Server-Based Request');
  console.log(checkDomainWhitelist('server-based', allowed, null));

  console.log('\nScenario 2: Localhost (Browser)');
  console.log(checkDomainWhitelist('browser-based', allowed, 'http://localhost:3000'));

  console.log('\nScenario 3: Allowed Full Domain (company.com)');
  console.log(checkDomainWhitelist('browser-based', allowed, 'https://company.com/api/test'));

  console.log('\nScenario 4: Allowed Subdomain (app.company.com)');
  console.log(checkDomainWhitelist('browser-based', allowed, 'https://app.company.com/dashboard'));

  console.log('\nScenario 5: Malicious Domain (pirate-site.com)');
  console.log(checkDomainWhitelist('browser-based', allowed, 'https://pirate-site.com'));
}

async function runLogTest() {
  console.log('\n📝 6️⃣ Starting Asynchronous Logging and Cost Calculation Test...\n');

  const clientRes = await createNewClient('[TEST] Log Client', 'development');
  if (!clientRes.success) {
    console.log('❌ Failed to create client for log test.');
    return;
  }
  
  const clientId = clientRes.clientId; 
  if (!clientId) return;

  console.log('⏳ Starting AI request (Writing to database as "pending")...');
  const provider = 'openai';
  const model = 'gpt-4o';
  const logId = await logRequestStart(clientId, provider, model);

  if (!logId) {
    console.log('❌ Failed to create log entry!');
    return;
  }
  console.log(`✅ Log successfully created! Record ID: ${logId}`);

  console.log('⏱️ AI response received! Calculating token and cost, updating log...');
  await logRequestComplete(logId, provider, model, 1000, 500, 1200, true);

  console.log('🟢 Process complete! Calculated cost based on 1000 input and 500 output tokens for GPT-4o.');
  console.log('👀 Check the "cost" column in the "logs" table of your database (DATABASE_URL).');
  console.log('🧹 Cleanup: test rows are named "[TEST] ..." — see README → Available NPM Scripts for the cleanup SQL.');
}

// Main function to run all tests sequentially
async function runAllTests() {
  // Bu paket hedef veritabanına gerçek satırlar yazar (2 client, 1 log).
  // Üretim veritabanını yanlışlıkla kirletmemek için NODE_ENV=production'da çalışmaz.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_WRITES !== 'true') {
    console.error('❌ Refusing to run: NODE_ENV=production. This suite writes test rows to DATABASE_URL.');
    console.error('   Point DATABASE_URL to a test database, or set ALLOW_TEST_WRITES=true to override.');
    process.exit(1);
  }
  await runTests();
  await runRateLimitTest();
  runDomainTest(); 
  await runLogTest();
}

runAllTests();
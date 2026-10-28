import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ Error: DATABASE_URL is not set. Configure it in your .env file or environment.');
  process.exit(1);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');

async function runMigrations() {
  const sql = postgres(databaseUrl!, { max: 1 });

  try {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('ℹ️ No SQL migration files found.');
      return;
    }

    for (const file of files) {
      const fullPath = join(migrationsDir, file);
      const content = readFileSync(fullPath, 'utf8').trim();
      if (!content) continue;

      console.log(`⏳ Applying migration: ${file}...`);
      await sql.unsafe(content);
      console.log(`✅ Applied: ${file}`);
    }

    console.log('🎉 All database migrations completed successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

runMigrations();

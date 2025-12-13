import { getPool, closePool } from './connection.js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigrations(): Promise<void> {
  console.log('[Migration] Starting migrations...');

  const pool = await getPool();

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Get applied migrations
  const appliedResult = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(appliedResult.rows.map((r) => r.version));

  // Find and run pending migrations
  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let migrationsRun = 0;

  for (const file of files) {
    if (!applied.has(file)) {
      console.log(`[Migration] Applying: ${file}`);
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');

      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await pool.query('COMMIT');
        console.log(`[Migration] Applied: ${file}`);
        migrationsRun++;
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }
  }

  if (migrationsRun === 0) {
    console.log('[Migration] No pending migrations');
  } else {
    console.log(`[Migration] Completed ${migrationsRun} migration(s)`);
  }
}

// Run if called directly
runMigrations()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[Migration] Failed:', error);
    process.exit(1);
  });

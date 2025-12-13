import pg from 'pg';

const { Pool } = pg;

export type { Pool } from 'pg';

interface PoolConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

/**
 * Get pool configuration from environment variables.
 * Supports both DATABASE_URL connection string and individual vars.
 */
function getPoolConfig(): PoolConfig {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };
  }

  // Fallback to individual env vars
  return {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '26257'),
    database: process.env.DATABASE_NAME || 'minecraft_platform',
    user: process.env.DATABASE_USER || 'minecraft',
    password: process.env.DATABASE_PASSWORD || 'minecraft_dev',
    ssl: process.env.DATABASE_SSLMODE === 'require' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
}

let pool: pg.Pool | null = null;

/**
 * Connect to the database with retry logic.
 */
async function connectWithRetry(
  poolInstance: pg.Pool,
  maxRetries: number,
  delayMs: number
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await poolInstance.connect();
      await client.query('SELECT 1');
      client.release();
      console.log('[Database] Connected to CockroachDB');
      return;
    } catch (error) {
      console.error(`[Database] Connection attempt ${attempt}/${maxRetries} failed:`, error);
      if (attempt === maxRetries) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Get the database connection pool. Creates one if not exists.
 */
export async function getPool(): Promise<pg.Pool> {
  if (!pool) {
    pool = new Pool(getPoolConfig());

    // Test connection with retries
    await connectWithRetry(pool, 5, 2000);
  }
  return pool;
}

/**
 * Close the database connection pool.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[Database] Connection pool closed');
  }
}

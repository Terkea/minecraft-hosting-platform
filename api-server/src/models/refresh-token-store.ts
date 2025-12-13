import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getPool, type Pool } from '../db/connection.js';

/**
 * Refresh token model for JWT authentication.
 * Tokens are stored hashed for security.
 */
export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Input for creating a refresh token
 */
export interface CreateRefreshTokenInput {
  userId: string;
  token: string; // Plain token - will be hashed before storage
  expiresAt: Date;
}

/**
 * Database row type (snake_case columns)
 */
interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
}

/**
 * Hash a token for secure storage
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Database-backed refresh token store using CockroachDB/PostgreSQL.
 */
export class RefreshTokenStore {
  private pool: Pool | null = null;

  /**
   * Initialize the database connection.
   * Must be called before using other methods.
   */
  async initialize(): Promise<void> {
    this.pool = await getPool();

    // Create the refresh_tokens table if it doesn't exist
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Create index for faster lookups
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)
    `);

    // Create index for token lookup
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash)
    `);

    console.log('[RefreshTokenStore] Database connection initialized');
  }

  private getPool(): Pool {
    if (!this.pool) {
      throw new Error('RefreshTokenStore not initialized. Call initialize() first.');
    }
    return this.pool;
  }

  /**
   * Map database row to RefreshToken interface
   */
  private mapRowToToken(row: RefreshTokenRow): RefreshToken {
    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      expiresAt: new Date(row.expires_at),
      createdAt: new Date(row.created_at),
    };
  }

  /**
   * Create a new refresh token
   */
  async createToken(input: CreateRefreshTokenInput): Promise<RefreshToken> {
    const id = uuidv4();
    const tokenHash = hashToken(input.token);

    const result = await this.getPool().query<RefreshTokenRow>(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, input.userId, tokenHash, input.expiresAt]
    );

    return this.mapRowToToken(result.rows[0]);
  }

  /**
   * Get a refresh token by its plain value
   * Returns null if not found
   */
  async getToken(token: string): Promise<RefreshToken | null> {
    const tokenHash = hashToken(token);

    const result = await this.getPool().query<RefreshTokenRow>(
      'SELECT * FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash]
    );

    return result.rows[0] ? this.mapRowToToken(result.rows[0]) : null;
  }

  /**
   * Delete a refresh token (for rotation or logout)
   */
  async deleteToken(token: string): Promise<boolean> {
    const tokenHash = hashToken(token);

    const result = await this.getPool().query('DELETE FROM refresh_tokens WHERE token_hash = $1', [
      tokenHash,
    ]);

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Delete all refresh tokens for a user (logout from all devices)
   */
  async deleteAllUserTokens(userId: string): Promise<number> {
    const result = await this.getPool().query('DELETE FROM refresh_tokens WHERE user_id = $1', [
      userId,
    ]);

    const count = result.rowCount ?? 0;
    if (count > 0) {
      console.log(`[RefreshTokenStore] Deleted ${count} tokens for user ${userId}`);
    }

    return count;
  }

  /**
   * Delete expired tokens (cleanup job)
   */
  async deleteExpiredTokens(): Promise<number> {
    const result = await this.getPool().query(
      'DELETE FROM refresh_tokens WHERE expires_at < NOW()'
    );

    const count = result.rowCount ?? 0;
    if (count > 0) {
      console.log(`[RefreshTokenStore] Cleaned up ${count} expired tokens`);
    }

    return count;
  }

  /**
   * Count active tokens for a user
   */
  async countUserTokens(userId: string): Promise<number> {
    const result = await this.getPool().query<{ count: string }>(
      'SELECT COUNT(*) as count FROM refresh_tokens WHERE user_id = $1 AND expires_at > NOW()',
      [userId]
    );

    return parseInt(result.rows[0].count, 10);
  }
}

// Singleton instance
export const refreshTokenStore = new RefreshTokenStore();

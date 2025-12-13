import { v4 as uuidv4 } from 'uuid';
import { getPool, type Pool } from '../db/connection.js';

/**
 * User model for Google OAuth authenticated users.
 * Users authenticate with Google and their backups are stored in their Google Drive.
 */
export interface User {
  id: string;
  googleId: string;
  email: string;
  name: string;
  pictureUrl?: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  tokenExpiresAt: Date;
  driveFolderId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User creation input (from Google OAuth response)
 */
export interface CreateUserInput {
  googleId: string;
  email: string;
  name: string;
  pictureUrl?: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  tokenExpiresAt: Date;
}

/**
 * User update input
 */
export interface UpdateUserInput {
  name?: string;
  pictureUrl?: string;
  googleAccessToken?: string;
  googleRefreshToken?: string;
  tokenExpiresAt?: Date;
  driveFolderId?: string;
}

/**
 * Database row type (snake_case columns)
 */
interface UserRow {
  id: string;
  google_id: string;
  email: string;
  name: string;
  picture_url: string | null;
  google_access_token: string;
  google_refresh_token: string;
  token_expires_at: Date;
  drive_folder_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Database-backed user store using CockroachDB/PostgreSQL.
 */
export class UserStoreDB {
  private pool: Pool | null = null;

  /**
   * Initialize the database connection.
   * Must be called before using other methods.
   */
  async initialize(): Promise<void> {
    this.pool = await getPool();
    console.log('[UserStore] Database connection initialized');
  }

  private getPool(): Pool {
    if (!this.pool) {
      throw new Error('UserStore not initialized. Call initialize() first.');
    }
    return this.pool;
  }

  /**
   * Map database row (snake_case) to User interface (camelCase)
   */
  private mapRowToUser(row: UserRow): User {
    return {
      id: row.id,
      googleId: row.google_id,
      email: row.email,
      name: row.name,
      pictureUrl: row.picture_url || undefined,
      googleAccessToken: row.google_access_token,
      googleRefreshToken: row.google_refresh_token,
      tokenExpiresAt: new Date(row.token_expires_at),
      driveFolderId: row.drive_folder_id || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Create a new user
   */
  async createUser(input: CreateUserInput): Promise<User> {
    const id = uuidv4();
    const now = new Date();

    const result = await this.getPool().query<UserRow>(
      `INSERT INTO users (
        id, google_id, email, name, picture_url,
        google_access_token, google_refresh_token,
        token_expires_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        id,
        input.googleId,
        input.email,
        input.name,
        input.pictureUrl || null,
        input.googleAccessToken,
        input.googleRefreshToken,
        input.tokenExpiresAt,
        now,
        now,
      ]
    );

    const user = this.mapRowToUser(result.rows[0]);
    console.log(`[UserStore] Created user: ${user.email} (${user.id})`);
    return user;
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string): Promise<User | undefined> {
    const result = await this.getPool().query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);

    return result.rows[0] ? this.mapRowToUser(result.rows[0]) : undefined;
  }

  /**
   * Get user by Google ID
   */
  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const result = await this.getPool().query<UserRow>('SELECT * FROM users WHERE google_id = $1', [
      googleId,
    ]);

    return result.rows[0] ? this.mapRowToUser(result.rows[0]) : undefined;
  }

  /**
   * Get user by email (case-insensitive)
   */
  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await this.getPool().query<UserRow>(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    return result.rows[0] ? this.mapRowToUser(result.rows[0]) : undefined;
  }

  /**
   * Update an existing user
   */
  async updateUser(id: string, updates: UpdateUserInput): Promise<User | undefined> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.pictureUrl !== undefined) {
      setClauses.push(`picture_url = $${paramIndex++}`);
      values.push(updates.pictureUrl);
    }
    if (updates.googleAccessToken !== undefined) {
      setClauses.push(`google_access_token = $${paramIndex++}`);
      values.push(updates.googleAccessToken);
    }
    if (updates.googleRefreshToken !== undefined) {
      setClauses.push(`google_refresh_token = $${paramIndex++}`);
      values.push(updates.googleRefreshToken);
    }
    if (updates.tokenExpiresAt !== undefined) {
      setClauses.push(`token_expires_at = $${paramIndex++}`);
      values.push(updates.tokenExpiresAt);
    }
    if (updates.driveFolderId !== undefined) {
      setClauses.push(`drive_folder_id = $${paramIndex++}`);
      values.push(updates.driveFolderId);
    }

    if (setClauses.length === 0) {
      // No updates, just return current user
      return this.getUserById(id);
    }

    // Always update updated_at
    setClauses.push(`updated_at = $${paramIndex++}`);
    values.push(new Date());

    // Add id as final parameter
    values.push(id);

    const result = await this.getPool().query<UserRow>(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows[0]) {
      const user = this.mapRowToUser(result.rows[0]);
      console.log(`[UserStore] Updated user: ${user.email} (${user.id})`);
      return user;
    }

    return undefined;
  }

  /**
   * Delete a user
   */
  async deleteUser(id: string): Promise<boolean> {
    const result = await this.getPool().query('DELETE FROM users WHERE id = $1 RETURNING email', [
      id,
    ]);

    if ((result.rowCount ?? 0) > 0) {
      console.log(`[UserStore] Deleted user: ${result.rows[0].email} (${id})`);
      return true;
    }

    return false;
  }

  /**
   * List all users (for admin purposes)
   */
  async listUsers(): Promise<User[]> {
    const result = await this.getPool().query<UserRow>(
      'SELECT * FROM users ORDER BY created_at DESC'
    );

    return result.rows.map((row) => this.mapRowToUser(row));
  }

  /**
   * Get total user count
   */
  async getUserCount(): Promise<number> {
    const result = await this.getPool().query<{ count: string }>(
      'SELECT COUNT(*) as count FROM users'
    );

    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Check if user's Google tokens need refresh
   */
  isTokenExpired(user: User): boolean {
    // Consider token expired if it expires within the next 5 minutes
    const bufferMs = 5 * 60 * 1000;
    return new Date().getTime() > user.tokenExpiresAt.getTime() - bufferMs;
  }
}

// Singleton instance
export const userStore = new UserStoreDB();

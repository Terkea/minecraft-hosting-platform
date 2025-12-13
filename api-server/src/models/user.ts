/**
 * User model re-exports from database-backed store.
 * This module provides backward compatibility with existing imports.
 */
export type { User, CreateUserInput, UpdateUserInput } from './user-store-db.js';
export { userStore } from './user-store-db.js';

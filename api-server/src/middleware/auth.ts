import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { userStore, User } from '../models/user.js';
import { refreshTokenStore } from '../models/refresh-token-store.js';

/**
 * Extended Express Request with authenticated user
 */
export interface AuthenticatedRequest extends Request {
  user?: User;
  userId?: string;
}

/**
 * JWT payload structure for access tokens
 */
export interface JwtPayload {
  userId: string;
  email: string;
  type: 'access';
  iat: number;
  exp: number;
}

/**
 * Token pair returned after authentication
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expires
}

// Token expiration times
const ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes
const ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60;
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

/**
 * Generate an access token (short-lived JWT)
 */
export function generateAccessToken(user: User): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  return jwt.sign({ userId: user.id, email: user.email, type: 'access' }, secret, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

/**
 * Generate a refresh token (stored in database)
 */
export async function generateRefreshToken(userId: string): Promise<string> {
  // Generate a cryptographically secure random token
  const token = crypto.randomBytes(64).toString('hex');

  // Store in database with expiry
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await refreshTokenStore.createToken({
    userId,
    token,
    expiresAt,
  });

  return token;
}

/**
 * Generate both access and refresh tokens for a user
 */
export async function generateTokenPair(user: User): Promise<TokenPair> {
  const accessToken = generateAccessToken(user);
  const refreshToken = await generateRefreshToken(user.id);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
  };
}

/**
 * Refresh tokens - validate refresh token and issue new token pair
 * Implements token rotation: old refresh token is invalidated
 */
export async function refreshTokens(refreshToken: string): Promise<TokenPair | null> {
  // Validate the refresh token
  const storedToken = await refreshTokenStore.getToken(refreshToken);

  if (!storedToken) {
    return null; // Token not found or already used
  }

  // Check if expired
  if (new Date() > storedToken.expiresAt) {
    await refreshTokenStore.deleteToken(refreshToken);
    return null;
  }

  // Get the user
  const user = await userStore.getUserById(storedToken.userId);
  if (!user) {
    await refreshTokenStore.deleteToken(refreshToken);
    return null;
  }

  // Delete the old refresh token (rotation)
  await refreshTokenStore.deleteToken(refreshToken);

  // Generate new token pair
  return generateTokenPair(user);
}

/**
 * Revoke all refresh tokens for a user (logout from all devices)
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await refreshTokenStore.deleteAllUserTokens(userId);
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use generateTokenPair instead
 */
export function generateToken(user: User): string {
  return generateAccessToken(user);
}

/**
 * Verify a JWT token and return the payload
 */
export function verifyToken(token: string): JwtPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  return jwt.verify(token, secret) as JwtPayload;
}

/**
 * Middleware to require authentication.
 * Verifies JWT token and attaches user to request.
 * Returns 401 if not authenticated.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Authentication required. Please sign in with Google.',
    });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const payload = verifyToken(token);
    const user = await userStore.getUserById(payload.userId);

    if (!user) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'User not found. Please sign in again.',
      });
      return;
    }

    // Attach user to request
    req.user = user;
    req.userId = user.id;
    next();
  } catch (error: unknown) {
    const err = error as { name?: string };
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({
        error: 'token_expired',
        message: 'Session expired. Please sign in again.',
      });
    } else if (err.name === 'JsonWebTokenError') {
      res.status(401).json({
        error: 'invalid_token',
        message: 'Invalid token. Please sign in again.',
      });
    } else {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication failed.',
      });
    }
  }
}

/**
 * Middleware for optional authentication.
 * Attaches user to request if token is valid, but doesn't require it.
 * Always calls next() regardless of auth status.
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.substring(7);

  try {
    const payload = verifyToken(token);
    const user = await userStore.getUserById(payload.userId);

    if (user) {
      req.user = user;
      req.userId = user.id;
    }
  } catch {
    // Token invalid - continue without user
  }

  next();
}

/**
 * Helper to extract user from request (with type safety)
 */
export function getAuthenticatedUser(req: AuthenticatedRequest): User {
  if (!req.user) {
    throw new Error('User not authenticated');
  }
  return req.user;
}

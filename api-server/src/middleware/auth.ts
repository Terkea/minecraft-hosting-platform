import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { userStore, User } from '../models/user.js';

/**
 * Extended Express Request with authenticated user
 */
export interface AuthenticatedRequest extends Request {
  user?: User;
  userId?: string;
}

/**
 * JWT payload structure
 */
export interface JwtPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

/**
 * Generate a JWT token for an authenticated user
 */
export function generateToken(user: User): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  return jwt.sign({ userId: user.id, email: user.email }, secret, {
    expiresIn: '7d',
  });
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

# JWT Authentication System

This document describes the JWT-based authentication system used in the Minecraft Hosting Platform, including the token refresh mechanism designed to prevent session hijacking.

## Overview

The platform uses a dual-token authentication system:

| Token Type    | Lifetime   | Storage                  | Purpose                  |
| ------------- | ---------- | ------------------------ | ------------------------ |
| Access Token  | 15 minutes | Client localStorage      | API authentication       |
| Refresh Token | 7 days     | Server database (hashed) | Obtain new access tokens |

## Security Benefits

### Short-Lived Access Tokens

- Access tokens expire after 15 minutes
- Even if stolen, the window for misuse is limited
- Reduces risk of long-term session hijacking

### Token Rotation

- Each time a refresh token is used, it's invalidated and a new one is issued
- If an attacker steals and uses a refresh token, the legitimate user's next refresh will fail
- This provides built-in detection of token theft

### Server-Side Revocation

- Refresh tokens are stored hashed in the database
- Logout invalidates ALL refresh tokens for a user (logout from all devices)
- Administrators can revoke access immediately if needed

### Secure Token Storage

- Refresh tokens are hashed using SHA-256 before database storage
- Plain tokens are never stored on the server
- Database compromise doesn't expose usable tokens

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│  API Server │────▶│ CockroachDB │
│             │     │             │     │             │
│ localStorage│     │ JWT Verify  │     │ refresh_    │
│ - access    │     │ Token Issue │     │ tokens      │
│ - refresh   │     │             │     │ (hashed)    │
│ - expiry    │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Token Flow

### Initial Authentication (Google OAuth)

```
1. User clicks "Sign in with Google"
2. Browser redirects to /api/v1/auth/google
3. Server redirects to Google OAuth consent screen
4. User grants permission
5. Google redirects to /api/v1/auth/google/callback with code
6. Server exchanges code for Google tokens
7. Server creates/updates user in database
8. Server generates token pair (access + refresh)
9. Server redirects to frontend with tokens in URL params
10. Frontend stores tokens in localStorage
```

### API Request with Auto-Refresh

```
1. Frontend prepares API request
2. Check if access token is expired (or within 60s of expiry)
3. If expired:
   a. Call /api/v1/auth/refresh with refresh token
   b. Server validates refresh token against database
   c. Server deletes old refresh token (rotation)
   d. Server issues new token pair
   e. Frontend stores new tokens
4. Make API request with (new) access token
5. If 401 response:
   a. Attempt token refresh
   b. Retry request with new token
   c. If refresh fails, redirect to login
```

### Logout

```
1. Frontend calls /api/v1/auth/logout
2. Server deletes ALL refresh tokens for the user
3. Frontend clears localStorage tokens
4. User redirected to login page
```

## API Endpoints

### POST /api/v1/auth/refresh

Refresh an expired access token.

**Request:**

```json
{
  "refreshToken": "abc123..."
}
```

**Response (200 OK):**

```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "def456...",
  "expiresIn": 900
}
```

**Response (401 Unauthorized):**

```json
{
  "error": "invalid_refresh_token",
  "message": "Refresh token is invalid or expired. Please sign in again."
}
```

### POST /api/v1/auth/logout

Logout and revoke all tokens.

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response (200 OK):**

```json
{
  "message": "Logged out successfully"
}
```

### GET /api/v1/auth/me

Get current authenticated user info.

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response (200 OK):**

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "User Name",
  "pictureUrl": "https://...",
  "driveConnected": true,
  "createdAt": "2024-01-01T00:00:00Z"
}
```

## Database Schema

### refresh_tokens table

```sql
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
```

## Frontend Implementation

### Token Storage

Tokens are stored in localStorage:

```typescript
// Keys
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const TOKEN_EXPIRY_KEY = 'token_expiry';

// Store tokens
function storeTokens(data: TokenData): void {
  const expiryTime = Date.now() + data.expiresIn * 1000;
  localStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
  localStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());
}
```

### Auto-Refresh Logic

The frontend automatically refreshes tokens before they expire:

```typescript
// Refresh 60 seconds before expiry
const REFRESH_BUFFER_MS = 60 * 1000;

function isTokenExpired(): boolean {
  const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!expiry) return true;
  return Date.now() >= parseInt(expiry, 10) - REFRESH_BUFFER_MS;
}
```

### Request Retry on 401

All API calls automatically retry after refreshing tokens:

```typescript
async function handleResponse(
  response: Response,
  retryFn: () => Promise<Response>
): Promise<Response> {
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return retryFn(); // Retry with new token
    }
    clearTokens();
    window.location.href = '/login';
  }
  return response;
}
```

## Configuration

### Token Expiration Times

Located in `api-server/src/middleware/auth.ts`:

```typescript
const ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes
const ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60;
const REFRESH_TOKEN_EXPIRY_DAYS = 7; // 7 days
```

### Environment Variables

```env
JWT_SECRET=your-secret-key-here  # Used to sign access tokens
```

## Security Considerations

### Token Theft Mitigation

| Attack Vector        | Mitigation                             |
| -------------------- | -------------------------------------- |
| XSS stealing tokens  | Short expiry limits damage window      |
| Network interception | HTTPS required in production           |
| Database breach      | Tokens stored hashed, unusable         |
| Stolen refresh token | Token rotation detects theft           |
| Session persistence  | 7-day max lifetime, logout revokes all |

### Best Practices

1. **Always use HTTPS** in production to prevent token interception
2. **Set secure cookie flags** if migrating to cookie-based storage
3. **Monitor for anomalies** - multiple refresh failures may indicate theft
4. **Regular token cleanup** - expired tokens are cleaned up periodically

### Future Improvements

- [ ] Add device/session tracking to refresh tokens
- [ ] Implement refresh token family tracking for better theft detection
- [ ] Add rate limiting on refresh endpoint
- [ ] Consider HTTP-only cookies for refresh token storage
- [ ] Add token revocation webhook for real-time invalidation

## Troubleshooting

### "Session expired" errors

1. Check if access token has expired
2. Verify refresh token is present in localStorage
3. Check server logs for refresh failures
4. Ensure JWT_SECRET hasn't changed

### Infinite redirect to login

1. Check if refresh token is valid in database
2. Verify token hasn't been revoked
3. Check for clock skew between client and server

### Token refresh fails

1. Check `refresh_tokens` table for user's tokens
2. Verify token hash matches
3. Check if token has expired (7 day limit)
4. Look for database connection issues in server logs

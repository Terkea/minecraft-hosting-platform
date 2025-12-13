import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { storeTokens, clearTokens, getAccessToken, getRefreshToken } from '../api';

/**
 * User data returned from the API
 */
export interface User {
  id: string;
  email: string;
  name: string;
  pictureUrl?: string;
  driveConnected: boolean;
  createdAt: string;
}

/**
 * Auth context type
 */
interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  token: string | null;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [loading, setLoading] = useState(true);

  /**
   * Fetch user info from the API
   */
  const fetchUser = useCallback(async (authToken: string) => {
    try {
      const response = await fetch('/api/v1/auth/me', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        return true;
      } else {
        // Token invalid - clear all tokens
        console.warn('[Auth] Token invalid, clearing');
        clearTokens();
        setToken(null);
        setUser(null);
        return false;
      }
    } catch (error) {
      console.error('[Auth] Failed to fetch user:', error);
      return false;
    }
  }, []);

  /**
   * Handle OAuth callback - extract tokens from URL
   */
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const accessToken = urlParams.get('accessToken');
    const refreshToken = urlParams.get('refreshToken');
    const expiresIn = urlParams.get('expiresIn');
    const error = urlParams.get('error');

    if (error) {
      console.error('[Auth] OAuth error:', error);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (accessToken && refreshToken && expiresIn) {
      console.log('[Auth] Received token pair from OAuth callback');
      storeTokens({
        accessToken,
        refreshToken,
        expiresIn: parseInt(expiresIn, 10),
      });
      setToken(accessToken);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  /**
   * Fetch user when token changes
   */
  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchUser(token).finally(() => setLoading(false));
  }, [token, fetchUser]);

  /**
   * Redirect to Google OAuth login
   */
  const login = useCallback(() => {
    // Redirect to backend OAuth endpoint
    window.location.href = '/api/v1/auth/google';
  }, []);

  /**
   * Logout - clear tokens and notify backend
   */
  const logout = useCallback(async () => {
    if (token) {
      try {
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch {
        // Ignore errors - logout anyway
      }
    }

    clearTokens();
    setToken(null);
    setUser(null);
  }, [token]);

  /**
   * Refresh user data
   */
  const refreshUser = useCallback(async () => {
    if (token) {
      await fetchUser(token);
    }
  }, [token, fetchUser]);

  const value: AuthContextType = {
    user,
    loading,
    isAuthenticated: !!user,
    login,
    logout,
    token,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to access auth context
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * Get the auth token (for use in API calls)
 * @deprecated Use api.ts functions instead which handle token refresh
 */
export { getAccessToken as getAuthToken } from '../api';

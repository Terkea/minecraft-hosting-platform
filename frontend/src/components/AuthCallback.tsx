import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { storeTokens } from '../api';

/**
 * Handles OAuth callback - extracts tokens from URL and redirects
 */
export function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const accessToken = searchParams.get('accessToken');
    const refreshToken = searchParams.get('refreshToken');
    const expiresIn = searchParams.get('expiresIn');
    const error = searchParams.get('error');

    if (error) {
      console.error('[AuthCallback] OAuth error:', error);
      navigate('/login?error=' + encodeURIComponent(error), { replace: true });
      return;
    }

    if (accessToken && refreshToken && expiresIn) {
      console.log('[AuthCallback] Storing tokens and redirecting to home');
      storeTokens({
        accessToken,
        refreshToken,
        expiresIn: parseInt(expiresIn, 10),
      });
      // Small delay to ensure tokens are stored before redirect
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 100);
    } else {
      console.error('[AuthCallback] Missing tokens in callback URL');
      navigate('/login?error=no_token', { replace: true });
    }
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="flex items-center gap-3 text-white">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span>Completing sign in...</span>
      </div>
    </div>
  );
}

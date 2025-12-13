import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const TOKEN_KEY = 'auth_token';

/**
 * Handles OAuth callback - extracts token from URL and redirects
 */
export function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      console.error('[AuthCallback] OAuth error:', error);
      navigate('/login?error=' + encodeURIComponent(error), { replace: true });
      return;
    }

    if (token) {
      console.log('[AuthCallback] Storing token and redirecting to home');
      localStorage.setItem(TOKEN_KEY, token);
      // Small delay to ensure token is stored before redirect
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 100);
    } else {
      console.error('[AuthCallback] No token in callback URL');
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

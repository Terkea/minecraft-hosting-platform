import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AlertCircle, Server, Cloud, Shield, Loader2 } from 'lucide-react';

export function Login() {
  const { login, loading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  // Redirect to home if already authenticated
  useEffect(() => {
    if (isAuthenticated && !loading) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="flex items-center gap-3 text-white">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Main card */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 mb-4">
              <Server className="w-8 h-8 text-green-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Minecraft Server Hosting</h1>
            <p className="text-gray-400">Sign in to manage your Minecraft servers</p>
          </div>

          {/* Error message */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-400 font-medium">Sign in failed</p>
                <p className="text-red-400/80 text-sm mt-1">
                  {error === 'no_code'
                    ? 'Authorization was cancelled or failed.'
                    : decodeURIComponent(error)}
                </p>
              </div>
            </div>
          )}

          {/* Sign in button */}
          <button
            onClick={login}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-gray-100 text-gray-800 font-medium rounded-lg transition-colors"
          >
            {/* Google logo */}
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </button>

          {/* Info box */}
          <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <div className="flex items-start gap-3">
              <Cloud className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-blue-400 font-medium text-sm">Google Drive Integration</p>
                <p className="text-blue-400/80 text-sm mt-1">
                  Signing in grants access to your Google Drive for storing server backups securely
                  in your personal MinecraftBackups folder.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-center">
            <Server className="w-6 h-6 text-green-400 mx-auto mb-2" />
            <p className="text-gray-400 text-xs">Easy Server Management</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-center">
            <Cloud className="w-6 h-6 text-blue-400 mx-auto mb-2" />
            <p className="text-gray-400 text-xs">Cloud Backups</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-center">
            <Shield className="w-6 h-6 text-purple-400 mx-auto mb-2" />
            <p className="text-gray-400 text-xs">Secure & Private</p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-xs mt-6">
          By signing in, you agree to allow this application to create and manage files in your
          Google Drive.
        </p>
      </div>
    </div>
  );
}

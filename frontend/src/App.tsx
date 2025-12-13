import { Routes, Route, Navigate } from 'react-router-dom';
import { ServerList } from './ServerList';
import { ServerDetail } from './ServerDetail';
import { useWebSocket } from './useWebSocket';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Login } from './components/Login';
import { AuthCallback } from './components/AuthCallback';
import { ProtectedRoute } from './components/ProtectedRoute';

/**
 * Re-authentication modal component
 */
function ReauthModal({
  reason,
  message,
  onClose,
  onReauth,
}: {
  reason: string;
  message: string;
  onClose: () => void;
  onReauth: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-yellow-500/20 rounded-lg">
            <svg
              className="w-6 h-6 text-yellow-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Re-authentication Required</h3>
            <p className="text-sm text-gray-400">{reason}</p>
          </div>
        </div>

        <p className="text-gray-300 mb-6">{message}</p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Later
          </button>
          <button
            onClick={onReauth}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Re-authenticate with Google
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Main app content with authenticated routes
 */
function AuthenticatedApp() {
  const { servers, connected, setServers, reauthRequired, clearReauthRequired } = useWebSocket();
  const { logout } = useAuth();

  const handleReauth = () => {
    // Clear the modal and redirect to login
    clearReauthRequired();
    logout();
    window.location.href = '/login';
  };

  return (
    <>
      {reauthRequired && (
        <ReauthModal
          reason={reauthRequired.reason}
          message={reauthRequired.message}
          onClose={clearReauthRequired}
          onReauth={handleReauth}
        />
      )}
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />

        {/* OAuth callback - extracts token and redirects */}
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Protected routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <ServerList servers={servers} connected={connected} setServers={setServers} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/servers/:serverName"
          element={
            <ProtectedRoute>
              <ServerDetail connected={connected} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/servers/:serverName/:tab"
          element={
            <ProtectedRoute>
              <ServerDetail connected={connected} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/servers/:serverName/players/:playerName"
          element={
            <ProtectedRoute>
              <ServerDetail connected={connected} />
            </ProtectedRoute>
          }
        />

        {/* Redirect any unknown routes to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

/**
 * Root App component with auth provider
 */
function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}

export default App;

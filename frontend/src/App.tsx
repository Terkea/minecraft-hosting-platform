import { Routes, Route, Navigate } from 'react-router-dom';
import { ServerList } from './ServerList';
import { ServerDetail } from './ServerDetail';
import { useWebSocket } from './useWebSocket';
import { AuthProvider } from './contexts/AuthContext';
import { Login } from './components/Login';
import { AuthCallback } from './components/AuthCallback';
import { ProtectedRoute } from './components/ProtectedRoute';

/**
 * Main app content with authenticated routes
 */
function AuthenticatedApp() {
  const { servers, connected, setServers } = useWebSocket();

  return (
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

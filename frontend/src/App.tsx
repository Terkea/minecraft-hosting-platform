import { Routes, Route, Navigate } from 'react-router-dom';
import { ServerList } from './ServerList';
import { ServerDetail } from './ServerDetail';
import { useWebSocket } from './useWebSocket';

function App() {
  const { servers, connected, setServers } = useWebSocket();

  return (
    <Routes>
      <Route
        path="/"
        element={<ServerList servers={servers} connected={connected} setServers={setServers} />}
      />
      <Route path="/servers/:serverName" element={<ServerDetail connected={connected} />} />
      <Route path="/servers/:serverName/:tab" element={<ServerDetail connected={connected} />} />
      <Route
        path="/servers/:serverName/players/:playerName"
        element={<ServerDetail connected={connected} />}
      />
      {/* Redirect any unknown routes to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;

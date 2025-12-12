import { useEffect, useRef, useState, useCallback } from 'react';
import { Server, WebSocketMessage } from './types';

export function useWebSocket() {
  const [servers, setServers] = useState<Server[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);

        switch (message.type) {
          case 'initial':
          case 'status_update':
            if (message.servers) {
              setServers(message.servers);
            }
            break;

          case 'created':
            if (message.server) {
              setServers((prev) => [...prev, message.server!]);
            }
            break;

          case 'deleted':
            if (message.server) {
              setServers((prev) => prev.filter((s) => s.name !== message.server!.name));
            }
            break;

          case 'metrics_update':
            if (message.metrics) {
              setServers((prev) =>
                prev.map((server) => {
                  const serverMetrics = message.metrics![server.name];
                  if (serverMetrics) {
                    return { ...server, metrics: serverMetrics };
                  }
                  return server;
                })
              );
            }
            break;

          // Handle individual server updates (started, stopped, updated, etc.)
          case 'started':
          case 'stopped':
          case 'updated':
          case 'scaled':
          case 'modified':
          case 'added':
          case 'auto_stop_configured':
          case 'auto_start_configured':
            if (message.server) {
              setServers((prev) => {
                // Check if server already exists
                const exists = prev.some((s) => s.name === message.server!.name);
                if (!exists && message.type === 'added') {
                  // Add new server
                  return [...prev, message.server!];
                }
                // Update existing server
                return prev.map((s) =>
                  s.name === message.server!.name ? { ...s, ...message.server! } : s
                );
              });
            }
            break;
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);

      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { servers, connected, setServers };
}

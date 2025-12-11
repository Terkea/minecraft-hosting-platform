import * as net from 'net';
import { EventEmitter } from 'events';

// RCON packet types
const SERVERDATA_AUTH = 3;
const SERVERDATA_AUTH_RESPONSE = 2;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

interface RconConnection {
  socket: net.Socket;
  host: string;
  port: number;
  password: string;
  authenticated: boolean;
  lastUsed: number;
  requestId: number;
  pendingRequests: Map<
    number,
    { resolve: (value: string) => void; reject: (error: Error) => void }
  >;
  buffer: Buffer;
}

interface PooledConnection {
  connection: RconConnection;
  inUse: boolean;
}

export class RconConnectionPool extends EventEmitter {
  private pools: Map<string, PooledConnection[]> = new Map();
  private maxConnectionsPerServer = 2;
  private connectionTimeout = 180000; // 3 minutes idle timeout
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    // Start cleanup timer
    this.cleanupInterval = setInterval(() => this.cleanupIdleConnections(), 60000);
  }

  private getPoolKey(host: string, port: number): string {
    return `${host}:${port}`;
  }

  private createPacket(type: number, id: number, body: string): Buffer {
    const bodyBuffer = Buffer.from(body, 'utf8');
    const packetSize = 4 + 4 + bodyBuffer.length + 2; // id + type + body + null terminators
    const packet = Buffer.alloc(4 + packetSize);

    packet.writeInt32LE(packetSize, 0);
    packet.writeInt32LE(id, 4);
    packet.writeInt32LE(type, 8);
    bodyBuffer.copy(packet, 12);
    packet.writeInt8(0, 12 + bodyBuffer.length);
    packet.writeInt8(0, 13 + bodyBuffer.length);

    return packet;
  }

  private parsePacket(
    buffer: Buffer
  ): { size: number; id: number; type: number; body: string } | null {
    if (buffer.length < 4) return null;

    const size = buffer.readInt32LE(0);
    if (buffer.length < 4 + size) return null;

    const id = buffer.readInt32LE(4);
    const type = buffer.readInt32LE(8);
    const body = buffer.slice(12, 4 + size - 2).toString('utf8');

    return { size, id, type, body };
  }

  private async createConnection(
    host: string,
    port: number,
    password: string
  ): Promise<RconConnection> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const connection: RconConnection = {
        socket,
        host,
        port,
        password,
        authenticated: false,
        lastUsed: Date.now(),
        requestId: 1,
        pendingRequests: new Map(),
        buffer: Buffer.alloc(0),
      };

      const connectTimeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      }, 10000);

      socket.connect(port, host, () => {
        clearTimeout(connectTimeout);
        // Send auth packet
        const authId = connection.requestId++;
        const authPacket = this.createPacket(SERVERDATA_AUTH, authId, password);

        connection.pendingRequests.set(authId, {
          resolve: () => {
            connection.authenticated = true;
            resolve(connection);
          },
          reject: (err) => reject(err),
        });

        socket.write(authPacket);
      });

      socket.on('data', (data) => {
        connection.buffer = Buffer.concat([connection.buffer, data]);

        // Process all complete packets in buffer
        let packet;
        while ((packet = this.parsePacket(connection.buffer)) !== null) {
          const totalPacketSize = 4 + packet.size;
          connection.buffer = connection.buffer.slice(totalPacketSize);

          // Handle auth response
          if (packet.type === SERVERDATA_AUTH_RESPONSE) {
            const pending = connection.pendingRequests.get(packet.id);
            if (pending) {
              connection.pendingRequests.delete(packet.id);
              if (packet.id === -1) {
                pending.reject(new Error('Authentication failed'));
              } else {
                pending.resolve(packet.body);
              }
            }
          }
          // Handle command response
          else if (packet.type === SERVERDATA_RESPONSE_VALUE) {
            const pending = connection.pendingRequests.get(packet.id);
            if (pending) {
              connection.pendingRequests.delete(packet.id);
              pending.resolve(packet.body);
            }
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(connectTimeout);
        // Reject all pending requests
        for (const [, pending] of connection.pendingRequests) {
          pending.reject(err);
        }
        connection.pendingRequests.clear();
        connection.authenticated = false;
      });

      socket.on('close', () => {
        connection.authenticated = false;
        // Reject all pending requests
        for (const [, pending] of connection.pendingRequests) {
          pending.reject(new Error('Connection closed'));
        }
        connection.pendingRequests.clear();
      });
    });
  }

  async getConnection(host: string, port: number, password: string): Promise<RconConnection> {
    const key = this.getPoolKey(host, port);
    let pool = this.pools.get(key);

    if (!pool) {
      pool = [];
      this.pools.set(key, pool);
    }

    // Find an available connection
    for (const pooled of pool) {
      if (!pooled.inUse && pooled.connection.authenticated && pooled.connection.socket.writable) {
        pooled.inUse = true;
        pooled.connection.lastUsed = Date.now();
        return pooled.connection;
      }
    }

    // Create new connection if pool not full
    if (pool.length < this.maxConnectionsPerServer) {
      try {
        const connection = await this.createConnection(host, port, password);
        const pooled: PooledConnection = { connection, inUse: true };
        pool.push(pooled);
        console.log(`[RCON Pool] Created new connection to ${key} (pool size: ${pool.length})`);
        return connection;
      } catch (error) {
        console.error('[RCON Pool] Failed to create connection to %s:', key, error);
        throw error;
      }
    }

    // Wait for an available connection
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        for (const pooled of pool!) {
          if (
            !pooled.inUse &&
            pooled.connection.authenticated &&
            pooled.connection.socket.writable
          ) {
            clearInterval(checkInterval);
            pooled.inUse = true;
            pooled.connection.lastUsed = Date.now();
            resolve(pooled.connection);
            return;
          }
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Timeout waiting for available connection'));
      }, 10000);
    });
  }

  releaseConnection(connection: RconConnection): void {
    const key = this.getPoolKey(connection.host, connection.port);
    const pool = this.pools.get(key);

    if (pool) {
      for (const pooled of pool) {
        if (pooled.connection === connection) {
          pooled.inUse = false;
          connection.lastUsed = Date.now();
          return;
        }
      }
    }
  }

  async executeCommand(
    host: string,
    port: number,
    password: string,
    command: string
  ): Promise<string> {
    const connection = await this.getConnection(host, port, password);

    try {
      const result = await this.sendCommand(connection, command);
      return result;
    } finally {
      this.releaseConnection(connection);
    }
  }

  private sendCommand(connection: RconConnection, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!connection.authenticated || !connection.socket.writable) {
        reject(new Error('Connection not available'));
        return;
      }

      const requestId = connection.requestId++;
      const packet = this.createPacket(SERVERDATA_EXECCOMMAND, requestId, command);

      const timeout = setTimeout(() => {
        connection.pendingRequests.delete(requestId);
        reject(new Error('Command timeout'));
      }, 30000);

      connection.pendingRequests.set(requestId, {
        resolve: (body) => {
          clearTimeout(timeout);
          resolve(body);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      connection.socket.write(packet);
    });
  }

  private cleanupIdleConnections(): void {
    const now = Date.now();

    for (const [key, pool] of this.pools) {
      const toRemove: number[] = [];

      for (let i = 0; i < pool.length; i++) {
        const pooled = pool[i];
        const idleTime = now - pooled.connection.lastUsed;

        // Remove idle connections older than timeout
        if (!pooled.inUse && idleTime > this.connectionTimeout) {
          console.log(
            `[RCON Pool] Closing idle connection to ${key} (idle: ${Math.round(idleTime / 1000)}s)`
          );
          pooled.connection.socket.destroy();
          toRemove.push(i);
        }
        // Also remove dead connections
        else if (!pooled.connection.socket.writable || !pooled.connection.authenticated) {
          if (!pooled.inUse) {
            console.log(`[RCON Pool] Removing dead connection from ${key}`);
            toRemove.push(i);
          }
        }
      }

      // Remove from pool in reverse order to maintain indices
      for (let i = toRemove.length - 1; i >= 0; i--) {
        pool.splice(toRemove[i], 1);
      }

      // Remove empty pools
      if (pool.length === 0) {
        this.pools.delete(key);
      }
    }
  }

  getPoolStats(): { server: string; connections: number; inUse: number }[] {
    const stats: { server: string; connections: number; inUse: number }[] = [];

    for (const [key, pool] of this.pools) {
      stats.push({
        server: key,
        connections: pool.length,
        inUse: pool.filter((p) => p.inUse).length,
      });
    }

    return stats;
  }

  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    for (const [, pool] of this.pools) {
      for (const pooled of pool) {
        pooled.connection.socket.destroy();
      }
    }

    this.pools.clear();
  }
}

// Singleton instance
export const rconPool = new RconConnectionPool();

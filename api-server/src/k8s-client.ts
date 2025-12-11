import * as k8s from '@kubernetes/client-node';
import { Writable } from 'stream';
import { rconPool } from './utils/rcon-pool.js';

// MinecraftServer CRD types
export interface MinecraftServerSpec {
  serverId: string;
  tenantId: string;
  stopped?: boolean;
  image?: string;
  version: string;
  resources: {
    cpuRequest: string;
    cpuLimit: string;
    memoryRequest: string;
    memoryLimit: string;
    memory: string;
    storage: string;
  };
  config: {
    maxPlayers: number;
    gamemode: string;
    difficulty: string;
    levelName: string;
    motd: string;
    whiteList: boolean;
    onlineMode: boolean;
    pvp: boolean;
    enableCommandBlock: boolean;
  };
}

export interface MinecraftServerStatus {
  name: string;
  namespace: string;
  phase: string;
  message?: string;
  externalIP?: string;
  port?: number;
  playerCount?: number;
  maxPlayers?: number;
  version?: string;
}

export interface MinecraftServer {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
  };
  spec: MinecraftServerSpec;
  status?: {
    phase?: string;
    message?: string;
    externalIP?: string;
    port?: number;
    playerCount?: number;
    maxPlayers?: number;
    version?: string;
  };
}

export class K8sClient {
  private kc: k8s.KubeConfig;
  private customApi: k8s.CustomObjectsApi;
  private coreApi: k8s.CoreV1Api;
  private appsApi: k8s.AppsV1Api;
  private namespace: string;

  private readonly group = 'minecraft.platform.com';
  private readonly version = 'v1';
  private readonly plural = 'minecraftservers';

  constructor(namespace: string = 'minecraft-servers') {
    this.kc = new k8s.KubeConfig();
    this.kc.loadFromDefault();

    this.customApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.namespace = namespace;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const versionApi = this.kc.makeApiClient(k8s.VersionApi);
      await versionApi.getCode();
      return true;
    } catch (error) {
      console.error('K8s health check failed:', error);
      return false;
    }
  }

  async createMinecraftServer(
    name: string,
    spec: Partial<MinecraftServerSpec>
  ): Promise<MinecraftServerStatus> {
    const serverSpec: MinecraftServerSpec = {
      serverId: spec.serverId || name,
      tenantId: spec.tenantId || 'default-tenant',
      image: spec.image || 'itzg/minecraft-server:latest',
      version: spec.version || 'LATEST',
      resources: spec.resources || {
        cpuRequest: '500m',
        cpuLimit: '2',
        memoryRequest: '1Gi',
        memoryLimit: '4Gi',
        memory: '4G',
        storage: '10Gi',
      },
      config: spec.config || {
        maxPlayers: 20,
        gamemode: 'survival',
        difficulty: 'normal',
        levelName: 'world',
        motd: 'A Minecraft Server',
        whiteList: false,
        onlineMode: false,
        pvp: true,
        enableCommandBlock: true,
      },
    };

    const body: MinecraftServer = {
      apiVersion: `${this.group}/${this.version}`,
      kind: 'MinecraftServer',
      metadata: {
        name: this.sanitizeName(name),
        namespace: this.namespace,
      },
      spec: serverSpec,
    };

    try {
      const response = await this.customApi.createNamespacedCustomObject({
        group: this.group,
        version: this.version,
        namespace: this.namespace,
        plural: this.plural,
        body,
      });

      const created = response as unknown as MinecraftServer;
      return this.parseServerStatus(created);
    } catch (error: any) {
      if (error.response?.statusCode === 409) {
        throw new Error(`Server '${name}' already exists`);
      }
      throw error;
    }
  }

  async listMinecraftServers(): Promise<MinecraftServerStatus[]> {
    try {
      const response = await this.customApi.listNamespacedCustomObject({
        group: this.group,
        version: this.version,
        namespace: this.namespace,
        plural: this.plural,
      });

      const list = response as unknown as { items: MinecraftServer[] };
      return list.items.map((item) => this.parseServerStatus(item));
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        // CRD might not exist yet, return empty list
        return [];
      }
      throw error;
    }
  }

  async getMinecraftServer(name: string): Promise<MinecraftServerStatus | null> {
    try {
      const response = await this.customApi.getNamespacedCustomObject({
        group: this.group,
        version: this.version,
        namespace: this.namespace,
        plural: this.plural,
        name,
      });

      return this.parseServerStatus(response as unknown as MinecraftServer);
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async deleteMinecraftServer(name: string): Promise<void> {
    try {
      await this.customApi.deleteNamespacedCustomObject({
        group: this.group,
        version: this.version,
        namespace: this.namespace,
        plural: this.plural,
        name,
      });
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        throw new Error(`Server '${name}' not found`);
      }
      throw error;
    }
  }

  async getServerLogs(name: string, lines: number = 100): Promise<string> {
    try {
      // Pod name follows the pattern: {server-name}-0 for StatefulSet
      const podName = `${name}-0`;
      const response = await this.coreApi.readNamespacedPodLog({
        name: podName,
        namespace: this.namespace,
        tailLines: lines,
      });
      return response;
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        return 'Pod not found - server may still be starting';
      }
      throw error;
    }
  }

  // Update server configuration
  async updateMinecraftServer(
    name: string,
    updates: Partial<MinecraftServerSpec>
  ): Promise<MinecraftServerStatus> {
    try {
      // Get existing resource
      const existing = await this.customApi.getNamespacedCustomObject({
        group: this.group,
        version: this.version,
        namespace: this.namespace,
        plural: this.plural,
        name,
      });

      const server = existing as unknown as MinecraftServer;

      // Merge updates
      if (updates.version) server.spec.version = updates.version;
      if (updates.resources)
        server.spec.resources = { ...server.spec.resources, ...updates.resources };
      if (updates.config) server.spec.config = { ...server.spec.config, ...updates.config };

      // Update resource
      const response = await this.customApi.replaceNamespacedCustomObject({
        group: this.group,
        version: this.version,
        namespace: this.namespace,
        plural: this.plural,
        name,
        body: server,
      });

      return this.parseServerStatus(response as unknown as MinecraftServer);
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        throw new Error(`Server '${name}' not found`);
      }
      throw error;
    }
  }

  // Scale server resources
  async scaleMinecraftServer(
    name: string,
    resources: {
      cpuLimit?: string;
      memoryLimit?: string;
      memory?: string;
    }
  ): Promise<MinecraftServerStatus> {
    return this.updateMinecraftServer(name, {
      resources: {
        cpuRequest: resources.cpuLimit ? `${parseInt(resources.cpuLimit) / 2}m` : undefined,
        cpuLimit: resources.cpuLimit,
        memoryRequest: resources.memoryLimit
          ? `${parseInt(resources.memoryLimit) / 2}Gi`
          : undefined,
        memoryLimit: resources.memoryLimit,
        memory: resources.memory,
        storage: undefined,
      } as any,
    });
  }

  // Stop a server by setting the stopped field on the CRD
  async stopServer(name: string): Promise<void> {
    try {
      // Get existing resource
      const existing = await this.customApi.getNamespacedCustomObject({
        group: this.group,
        version: this.version,
        namespace: this.namespace,
        plural: this.plural,
        name,
      });

      const server = existing as unknown as MinecraftServer;

      // Set stopped to true
      server.spec.stopped = true;

      // Update the CRD
      await this.customApi.replaceNamespacedCustomObject({
        group: this.group,
        version: this.version,
        namespace: this.namespace,
        plural: this.plural,
        name,
        body: server,
      });
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        throw new Error(`Server '${name}' not found`);
      }
      throw error;
    }
  }

  // Start a server by setting the stopped field on the CRD
  async startServer(name: string): Promise<void> {
    try {
      // Get existing resource
      const existing = await this.customApi.getNamespacedCustomObject({
        group: this.group,
        version: this.version,
        namespace: this.namespace,
        plural: this.plural,
        name,
      });

      const server = existing as unknown as MinecraftServer;

      // Set stopped to false
      server.spec.stopped = false;

      // Update the CRD
      await this.customApi.replaceNamespacedCustomObject({
        group: this.group,
        version: this.version,
        namespace: this.namespace,
        plural: this.plural,
        name,
        body: server,
      });
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        throw new Error(`Server '${name}' not found`);
      }
      throw error;
    }
  }

  // Watch for server changes
  async watchMinecraftServers(
    callback: (type: string, server: MinecraftServerStatus) => void
  ): Promise<() => void> {
    const watch = new k8s.Watch(this.kc);

    const path = `/apis/${this.group}/${this.version}/namespaces/${this.namespace}/${this.plural}`;

    let aborted = false;

    const startWatch = async () => {
      if (aborted) return;

      try {
        const req = await watch.watch(
          path,
          {},
          (type: string, apiObj: MinecraftServer) => {
            const status = this.parseServerStatus(apiObj);
            callback(type, status);
          },
          (err: Error) => {
            if (!aborted) {
              console.error('Watch error:', err);
              // Restart watch after delay
              setTimeout(startWatch, 5000);
            }
          }
        );

        // Return abort function
        return () => {
          aborted = true;
          req.abort();
        };
      } catch (error) {
        console.error('Failed to start watch:', error);
        if (!aborted) {
          setTimeout(startWatch, 5000);
        }
      }
    };

    await startWatch();

    return () => {
      aborted = true;
    };
  }

  // Get pod details
  async getPodStatus(name: string): Promise<{
    phase: string;
    ready: boolean;
    restartCount: number;
    nodeName?: string;
    conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
  } | null> {
    try {
      const podName = `${name}-0`;
      const pod = await this.coreApi.readNamespacedPod({
        name: podName,
        namespace: this.namespace,
      });

      return {
        phase: pod.status?.phase || 'Unknown',
        ready: pod.status?.containerStatuses?.[0]?.ready || false,
        restartCount: pod.status?.containerStatuses?.[0]?.restartCount || 0,
        nodeName: pod.spec?.nodeName,
        conditions: (pod.status?.conditions || []).map((c: k8s.V1PodCondition) => ({
          type: c.type,
          status: c.status,
          reason: c.reason,
          message: c.message,
        })),
      };
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  // Get RCON endpoint for a server
  // Returns host and port for direct TCP connection to RCON
  async getRconEndpoint(name: string): Promise<{ host: string; port: number } | null> {
    try {
      const serviceName = `${name}-service`;
      const svc = await this.coreApi.readNamespacedService({
        name: serviceName,
        namespace: this.namespace,
      });

      if (this.isRunningInCluster()) {
        // Inside cluster: use service DNS name with internal port
        const host = `${serviceName}.${this.namespace}.svc.cluster.local`;
        return { host, port: 25575 };
      } else {
        // Outside cluster (local dev): use minikube IP with NodePort
        // Find the RCON port NodePort from the service spec
        const rconPort = svc.spec?.ports?.find((p: k8s.V1ServicePort) => p.port === 25575);
        if (rconPort?.nodePort) {
          // Use minikube IP from environment
          const minikubeIp = process.env.MINIKUBE_IP;
          if (!minikubeIp) {
            console.error('MINIKUBE_IP environment variable is required for local development');
            return null;
          }
          return { host: minikubeIp, port: rconPort.nodePort };
        }
        return null;
      }
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  // Check if running inside Kubernetes cluster
  private isRunningInCluster(): boolean {
    return !!process.env.KUBERNETES_SERVICE_HOST;
  }

  // Execute command via RCON (uses connection pool for efficiency)
  // This maintains a persistent TCP connection, eliminating RCON log spam
  async executeCommand(name: string, command: string): Promise<string> {
    // When running outside the cluster (local dev), skip RCON pool and use kubectl exec directly
    // This avoids the 10 second timeout when RCON pool can't reach minikube
    if (!this.isRunningInCluster()) {
      return this.executeCommandViaExec(name, command);
    }

    // Inside cluster: try RCON pool first for efficiency
    try {
      const endpoint = await this.getRconEndpoint(name);
      if (endpoint) {
        const rconPassword = process.env.RCON_PASSWORD;
        if (!rconPassword) {
          throw new Error('RCON_PASSWORD environment variable is required');
        }
        const result = await rconPool.executeCommand(
          endpoint.host,
          endpoint.port,
          rconPassword,
          command
        );
        return result;
      }
    } catch (rconError: any) {
      console.log(
        `[RCON Pool] Connection failed, falling back to kubectl exec: ${rconError.message}`
      );
    }

    // Fall back to kubectl exec if RCON pool fails
    return this.executeCommandViaExec(name, command);
  }

  // Execute command via kubectl exec (fallback method)
  private async executeCommandViaExec(name: string, command: string): Promise<string> {
    const exec = new k8s.Exec(this.kc);
    const podName = `${name}-0`;

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      // Create writable streams to capture output
      const stdoutStream = new Writable({
        write(chunk: Buffer, _encoding: string, callback: () => void) {
          stdout += chunk.toString();
          callback();
        },
      });

      const stderrStream = new Writable({
        write(chunk: Buffer, _encoding: string, callback: () => void) {
          stderr += chunk.toString();
          callback();
        },
      });

      exec
        .exec(
          this.namespace,
          podName,
          'minecraft-server',
          ['rcon-cli', command],
          stdoutStream,
          stderrStream,
          null,
          false,
          (status) => {
            if (status.status === 'Success') {
              resolve(stdout.trim() || 'Command executed successfully');
            } else {
              reject(new Error(stderr || status.message || 'Command execution failed'));
            }
          }
        )
        .catch(reject);
    });
  }

  // Execute multiple commands using the RCON pool
  // The pool maintains persistent TCP connections, so no new RCON sessions are created
  async executeCommands(name: string, commands: string[]): Promise<string[]> {
    if (commands.length === 0) return [];

    // Use RCON pool to execute all commands on the same persistent connection
    const results: string[] = [];
    for (const cmd of commands) {
      try {
        const result = await this.executeCommand(name, cmd);
        results.push(result);
      } catch (error) {
        console.error(`Failed to execute command "${cmd}":`, error);
        results.push('');
      }
    }
    return results;
  }

  private parseServerStatus(server: MinecraftServer): MinecraftServerStatus {
    return {
      name: server.metadata.name,
      namespace: server.metadata.namespace,
      phase: server.status?.phase || 'Pending',
      message: server.status?.message,
      externalIP: server.status?.externalIP,
      port: server.status?.port,
      playerCount: server.status?.playerCount || 0,
      maxPlayers: server.status?.maxPlayers || server.spec.config.maxPlayers,
      version: server.status?.version || server.spec.version,
    };
  }

  private sanitizeName(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/--+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 63) || 'minecraft-server'
    );
  }
}

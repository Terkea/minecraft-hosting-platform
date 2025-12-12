import * as k8s from '@kubernetes/client-node';

export interface PodMetrics {
  name: string;
  cpu: {
    usage: string; // e.g., "250m" (millicores)
    usageNano: number; // nanoseconds
    limit?: string; // e.g., "2" (cores) or "2000m"
    limitNano?: number;
    request?: string;
    requestNano?: number;
  };
  memory: {
    usage: string; // e.g., "512Mi"
    usageBytes: number; // bytes
    limit?: string;
    limitBytes?: number;
    request?: string;
    requestBytes?: number;
  };
  timestamp: Date;
}

export interface ServerMetrics {
  name: string;
  pod?: PodMetrics;
  uptime?: number; // seconds
  startTime?: Date;
  restartCount: number;
  ready: boolean;
}

export class MetricsService {
  private kc: k8s.KubeConfig;
  private metricsApi!: k8s.Metrics;
  private coreApi!: k8s.CoreV1Api;
  private namespace: string;
  private metricsCache: Map<string, ServerMetrics> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private onMetricsUpdate: ((metrics: Map<string, ServerMetrics>) => void) | null = null;
  private k8sAvailable: boolean = false;

  constructor(namespace: string = 'minecraft-servers') {
    this.kc = new k8s.KubeConfig();
    this.namespace = namespace;

    try {
      this.kc.loadFromDefault();
      this.metricsApi = new k8s.Metrics(this.kc);
      this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.k8sAvailable = true;
    } catch (error) {
      console.warn('[MetricsService] Failed to load Kubernetes configuration:', error);
      console.warn('[MetricsService] Running in degraded mode - K8s metrics will not be available');
      this.k8sAvailable = false;
    }
  }

  // Set callback for when metrics are updated
  setMetricsCallback(callback: (metrics: Map<string, ServerMetrics>) => void): void {
    this.onMetricsUpdate = callback;
  }

  // Start polling for metrics
  startPolling(intervalMs: number = 5000): void {
    console.log(`[MetricsService] Starting metrics polling (every ${intervalMs}ms)`);

    // Initial collection
    this.collectAllMetrics().catch((err) => {
      console.error('[MetricsService] Initial metrics collection failed:', err);
    });

    // Schedule periodic collection
    this.pollInterval = setInterval(async () => {
      try {
        await this.collectAllMetrics();
      } catch (error) {
        console.error('[MetricsService] Metrics polling failed:', error);
      }
    }, intervalMs);
  }

  // Stop polling
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('[MetricsService] Polling stopped');
  }

  // Collect metrics for all servers
  async collectAllMetrics(): Promise<Map<string, ServerMetrics>> {
    // If K8s is not available, return cached/empty metrics
    if (!this.k8sAvailable) {
      console.debug('[MetricsService] K8s not available, returning cached metrics');
      if (this.onMetricsUpdate) {
        this.onMetricsUpdate(this.metricsCache);
      }
      return this.metricsCache;
    }

    try {
      // Get all pods in the namespace
      const podsResponse = await this.coreApi.listNamespacedPod({ namespace: this.namespace });
      const pods = podsResponse.items;

      // Get pod metrics (requires metrics-server)
      const podMetricsMap = new Map<string, any>();
      try {
        const metrics = await this.metricsApi.getPodMetrics(this.namespace);
        for (const item of metrics.items) {
          podMetricsMap.set(item.metadata.name, item);
        }
      } catch (err: any) {
        // Metrics server might not be available
        if (err.response?.statusCode !== 404) {
          console.warn('[MetricsService] Could not fetch pod metrics:', err.message);
        }
      }

      // Process each pod
      for (const pod of pods) {
        const podName = pod.metadata?.name || '';

        // Extract server name from pod name (e.g., "test-server-0" -> "test-server")
        const serverName = podName.replace(/-\d+$/, '');

        // Skip if not a minecraft server pod
        if (
          !pod.metadata?.labels?.['app.kubernetes.io/name']?.includes('minecraft') &&
          !pod.metadata?.labels?.['server-id'] &&
          !serverName
        ) {
          continue;
        }

        const containerStatus = pod.status?.containerStatuses?.[0];
        const startTime = pod.status?.startTime ? new Date(pod.status.startTime) : undefined;
        const uptime = startTime
          ? Math.floor((Date.now() - startTime.getTime()) / 1000)
          : undefined;

        // Get resource limits from pod spec
        const containerSpec = pod.spec?.containers?.[0];
        const cpuLimit = containerSpec?.resources?.limits?.cpu;
        const cpuRequest = containerSpec?.resources?.requests?.cpu;
        const memLimit = containerSpec?.resources?.limits?.memory;
        const memRequest = containerSpec?.resources?.requests?.memory;

        const serverMetrics: ServerMetrics = {
          name: serverName,
          restartCount: containerStatus?.restartCount || 0,
          ready: containerStatus?.ready || false,
          startTime,
          uptime,
        };

        // Add resource metrics if available
        const podMetric = podMetricsMap.get(podName);
        if (podMetric && podMetric.containers?.[0]) {
          const container = podMetric.containers[0];
          serverMetrics.pod = {
            name: podName,
            cpu: {
              usage: container.usage?.cpu || '0',
              usageNano: this.parseCpuToNano(container.usage?.cpu || '0'),
              limit: cpuLimit,
              limitNano: cpuLimit ? this.parseCpuToNano(cpuLimit) : undefined,
              request: cpuRequest,
              requestNano: cpuRequest ? this.parseCpuToNano(cpuRequest) : undefined,
            },
            memory: {
              usage: container.usage?.memory || '0',
              usageBytes: this.parseMemoryToBytes(container.usage?.memory || '0'),
              limit: memLimit,
              limitBytes: memLimit ? this.parseMemoryToBytes(memLimit) : undefined,
              request: memRequest,
              requestBytes: memRequest ? this.parseMemoryToBytes(memRequest) : undefined,
            },
            timestamp: new Date(podMetric.timestamp),
          };
        }

        this.metricsCache.set(serverName, serverMetrics);
      }

      // Notify callback
      if (this.onMetricsUpdate) {
        this.onMetricsUpdate(this.metricsCache);
      }

      return this.metricsCache;
    } catch (error) {
      console.error('[MetricsService] Failed to collect metrics:', error);
      throw error;
    }
  }

  // Get cached metrics for a server
  getServerMetrics(serverName: string): ServerMetrics | undefined {
    return this.metricsCache.get(serverName);
  }

  // Get all cached metrics
  getAllMetrics(): Map<string, ServerMetrics> {
    return this.metricsCache;
  }

  // Parse CPU string to nanoseconds (e.g., "250m" -> 250000000)
  private parseCpuToNano(cpu: string): number {
    if (cpu.endsWith('n')) {
      return parseInt(cpu.slice(0, -1), 10);
    }
    if (cpu.endsWith('u')) {
      return parseInt(cpu.slice(0, -1), 10) * 1000;
    }
    if (cpu.endsWith('m')) {
      return parseInt(cpu.slice(0, -1), 10) * 1000000;
    }
    // Plain number means cores
    return parseFloat(cpu) * 1000000000;
  }

  // Parse memory string to bytes (e.g., "512Mi" -> 536870912)
  private parseMemoryToBytes(memory: string): number {
    const units: { [key: string]: number } = {
      Ki: 1024,
      Mi: 1024 * 1024,
      Gi: 1024 * 1024 * 1024,
      Ti: 1024 * 1024 * 1024 * 1024,
      K: 1000,
      M: 1000000,
      G: 1000000000,
      T: 1000000000000,
    };

    for (const [suffix, multiplier] of Object.entries(units)) {
      if (memory.endsWith(suffix)) {
        return parseInt(memory.slice(0, -suffix.length), 10) * multiplier;
      }
    }

    return parseInt(memory, 10);
  }

  // Format bytes to human-readable string
  static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  // Format CPU millicores to human-readable string
  static formatCpu(nanos: number): string {
    const millis = nanos / 1000000;
    if (millis < 1000) {
      return `${Math.round(millis)}m`;
    }
    return `${(millis / 1000).toFixed(2)} cores`;
  }

  // Format uptime to human-readable string
  static formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours < 24) return `${hours}h ${mins}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
}

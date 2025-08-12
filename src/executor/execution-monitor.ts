import { Observable, Subject, BehaviorSubject, interval, merge } from "rxjs";
import { map, takeUntil, filter, switchMap } from "rxjs/operators";
import Docker from "dockerode";
import { ExecutionMetrics, SystemMetrics } from "../types";

export interface MonitoringConfig {
  updateInterval: number; // milliseconds
  resourceThresholds: ResourceThresholds;
  enableWebSocket: boolean;
  webSocketPort?: number;
}

export interface ResourceThresholds {
  maxMemoryUsage: number; // percentage
  maxCpuUsage: number; // percentage
  maxNetworkIO: number; // bytes per second
}

export interface ExecutionProgress {
  testId: string;
  phase:
    | "preparing"
    | "starting"
    | "running"
    | "completing"
    | "completed"
    | "failed"
    | "cancelled";
  progress: number; // 0-100
  estimatedTimeRemaining?: number; // seconds
  currentMetrics: ExecutionMetrics;
  resourceUsage: SystemMetrics;
  warnings: string[];
}

export class ExecutionMonitor {
  private config: MonitoringConfig;
  private docker: Docker;
  private activeExecutions = new Map<string, ExecutionContext>();
  private progressSubject = new Subject<ExecutionProgress>();
  private stopSubject = new Subject<string>();

  constructor(config: MonitoringConfig, docker: Docker) {
    this.config = config;
    this.docker = docker;
  }

  startMonitoring(
    testId: string,
    containerId: string,
    estimatedDuration?: number
  ): Observable<ExecutionProgress> {
    const context: ExecutionContext = {
      testId,
      containerId,
      startTime: Date.now(),
      estimatedDuration: estimatedDuration || 0,
      lastMetrics: this.createInitialMetrics(),
      warnings: [],
    };

    this.activeExecutions.set(testId, context);

    // Start monitoring intervals
    const containerMonitoring$ = this.monitorContainer(context);
    const resourceMonitoring$ = this.monitorResources(context);
    const progressTracking$ = this.trackProgress(context);

    // Combine all monitoring streams
    const monitoring$ = merge(
      containerMonitoring$,
      resourceMonitoring$,
      progressTracking$
    ).pipe(
      takeUntil(
        this.stopSubject.pipe(filter((testId) => testId === context.testId))
      ),
      map((update) => this.createProgressUpdate(context, update))
    );

    return monitoring$;
  }

  stopMonitoring(testId: string): void {
    this.activeExecutions.delete(testId);
    this.stopSubject.next(testId as any);
  }

  async cancelExecution(testId: string): Promise<void> {
    const context = this.activeExecutions.get(testId);
    if (!context) {
      throw new Error(`No active execution found for test ID: ${testId}`);
    }

    try {
      const container = this.docker.getContainer(context.containerId);

      // Graceful shutdown first
      await container.kill("SIGTERM");

      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Force kill if still running
      try {
        const containerInfo = await container.inspect();
        if (containerInfo.State.Running) {
          await container.kill("SIGKILL");
        }
      } catch (error) {
        // Container might already be stopped
      }

      // Clean up
      await this.cleanupExecution(context);

      context.lastMetrics.status = "cancelled";
      this.progressSubject.next(
        this.createProgressUpdate(context, {
          type: "status",
          data: "cancelled",
        })
      );
    } catch (error) {
      context.warnings.push(
        `Cancellation error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    } finally {
      this.stopMonitoring(testId);
    }
  }

  getActiveExecutions(): string[] {
    return Array.from(this.activeExecutions.keys());
  }

  getExecutionStatus(testId: string): ExecutionProgress | null {
    const context = this.activeExecutions.get(testId);
    if (!context) return null;

    return this.createProgressUpdate(context, {
      type: "status",
      data: context.lastMetrics.status,
    });
  }

  private monitorContainer(
    context: ExecutionContext
  ): Observable<MonitoringUpdate> {
    return interval(this.config.updateInterval).pipe(
      switchMap(async () => {
        try {
          const container = this.docker.getContainer(context.containerId);
          const stats = await container.stats({ stream: false });

          return {
            type: "container_stats" as const,
            data: this.parseContainerStats(stats),
          };
        } catch (error) {
          return {
            type: "error" as const,
            data: `Container monitoring error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
      })
    );
  }

  private monitorResources(
    context: ExecutionContext
  ): Observable<MonitoringUpdate> {
    return interval(this.config.updateInterval).pipe(
      switchMap(async () => {
        try {
          const container = this.docker.getContainer(context.containerId);
          const stats = await container.stats({ stream: false });

          const resourceUsage = this.calculateResourceUsage(stats);
          const warnings = this.checkResourceThresholds(resourceUsage);

          if (warnings.length > 0) {
            context.warnings.push(...warnings);
          }

          return {
            type: "resource_usage" as const,
            data: resourceUsage,
          };
        } catch (error) {
          return {
            type: "error" as const,
            data: `Resource monitoring error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
      })
    );
  }

  private trackProgress(
    context: ExecutionContext
  ): Observable<MonitoringUpdate> {
    return interval(1000).pipe(
      // Update progress every second
      map(() => {
        const elapsed = Date.now() - context.startTime;
        const progress =
          context.estimatedDuration > 0
            ? Math.min(95, (elapsed / (context.estimatedDuration * 1000)) * 100)
            : Math.min(95, (elapsed / 60000) * 100); // Fallback: assume 1 minute max

        const estimatedTimeRemaining =
          context.estimatedDuration > 0
            ? Math.max(0, context.estimatedDuration - elapsed / 1000)
            : undefined;

        return {
          type: "progress" as const,
          data: {
            progress,
            estimatedTimeRemaining,
          },
        };
      })
    );
  }

  private parseContainerStats(stats: any): Partial<ExecutionMetrics> {
    // Parse Docker container stats to extract K6-relevant metrics
    // This is a simplified implementation - in practice, you'd parse K6's JSON output

    const cpuUsage = this.calculateCpuUsage(stats);
    const memoryUsage = stats.memory_stats?.usage || 0;

    return {
      // These would typically come from K6's JSON output, not container stats
      currentVUs: 0, // Would be parsed from K6 output
      requestsCompleted: 0, // Would be parsed from K6 output
      requestsPerSecond: 0, // Would be parsed from K6 output
      avgResponseTime: 0, // Would be parsed from K6 output
      errorRate: 0, // Would be parsed from K6 output
      timestamp: new Date(),
    };
  }

  private calculateResourceUsage(stats: any): SystemMetrics {
    const cpuUsage = this.calculateCpuUsage(stats);
    const memoryUsage = stats.memory_stats?.usage || 0;
    const networkRx = stats.networks?.eth0?.rx_bytes || 0;
    const networkTx = stats.networks?.eth0?.tx_bytes || 0;

    return {
      timestamp: new Date(),
      cpuUsage,
      memoryUsage,
      networkIO: {
        bytesIn: networkRx,
        bytesOut: networkTx,
      },
    };
  }

  private calculateCpuUsage(stats: any): number {
    if (!stats.cpu_stats || !stats.precpu_stats) return 0;

    const cpuDelta =
      stats.cpu_stats.cpu_usage.total_usage -
      stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta =
      stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const numberCpus = stats.cpu_stats.online_cpus || 1;

    if (systemDelta > 0 && cpuDelta > 0) {
      return (cpuDelta / systemDelta) * numberCpus * 100;
    }
    return 0;
  }

  private checkResourceThresholds(resourceUsage: SystemMetrics): string[] {
    const warnings: string[] = [];
    const thresholds = this.config.resourceThresholds;

    if (resourceUsage.cpuUsage > thresholds.maxCpuUsage) {
      warnings.push(
        `High CPU usage: ${resourceUsage.cpuUsage.toFixed(1)}% (threshold: ${
          thresholds.maxCpuUsage
        }%)`
      );
    }

    const memoryUsagePercent =
      (resourceUsage.memoryUsage / (1024 * 1024 * 1024)) * 100; // Convert to GB percentage
    if (memoryUsagePercent > thresholds.maxMemoryUsage) {
      warnings.push(
        `High memory usage: ${memoryUsagePercent.toFixed(1)}% (threshold: ${
          thresholds.maxMemoryUsage
        }%)`
      );
    }

    const networkIO =
      resourceUsage.networkIO.bytesIn + resourceUsage.networkIO.bytesOut;
    if (networkIO > thresholds.maxNetworkIO) {
      warnings.push(
        `High network I/O: ${(networkIO / 1024 / 1024).toFixed(
          1
        )} MB/s (threshold: ${(thresholds.maxNetworkIO / 1024 / 1024).toFixed(
          1
        )} MB/s)`
      );
    }

    return warnings;
  }

  private async cleanupExecution(context: ExecutionContext): Promise<void> {
    try {
      const container = this.docker.getContainer(context.containerId);

      // Remove container
      await container.remove({ force: true });

      // Clean up any temporary files if needed
      // This would be implemented based on your specific cleanup requirements
    } catch (error) {
      context.warnings.push(
        `Cleanup error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private createInitialMetrics(): ExecutionMetrics {
    return {
      status: "preparing",
      progress: 0,
      currentVUs: 0,
      requestsCompleted: 0,
      requestsPerSecond: 0,
      avgResponseTime: 0,
      errorRate: 0,
      timestamp: new Date(),
    };
  }

  private createProgressUpdate(
    context: ExecutionContext,
    update: MonitoringUpdate
  ): ExecutionProgress {
    // Update context based on monitoring update
    switch (update.type) {
      case "container_stats":
        Object.assign(context.lastMetrics, update.data);
        break;
      case "resource_usage":
        context.resourceUsage = update.data;
        break;
      case "progress":
        context.lastMetrics.progress = update.data.progress;
        break;
      case "status":
        context.lastMetrics.status = update.data;
        break;
      case "error":
        context.warnings.push(update.data);
        break;
    }

    return {
      testId: context.testId,
      phase: this.mapStatusToPhase(context.lastMetrics.status),
      progress: context.lastMetrics.progress,
      estimatedTimeRemaining:
        update.type === "progress"
          ? update.data.estimatedTimeRemaining
          : undefined,
      currentMetrics: { ...context.lastMetrics },
      resourceUsage: context.resourceUsage || {
        timestamp: new Date(),
        cpuUsage: 0,
        memoryUsage: 0,
        networkIO: { bytesIn: 0, bytesOut: 0 },
      },
      warnings: [...context.warnings],
    };
  }

  private mapStatusToPhase(status: string): ExecutionProgress["phase"] {
    switch (status) {
      case "preparing":
        return "preparing";
      case "starting":
        return "starting";
      case "running":
        return "running";
      case "completed":
        return "completed";
      case "failed":
        return "failed";
      case "cancelled":
        return "cancelled";
      default:
        return "preparing";
    }
  }
}

interface ExecutionContext {
  testId: string;
  containerId: string;
  startTime: number;
  estimatedDuration: number;
  lastMetrics: ExecutionMetrics;
  resourceUsage?: SystemMetrics;
  warnings: string[];
}

interface MonitoringUpdate {
  type: "container_stats" | "resource_usage" | "progress" | "status" | "error";
  data: any;
}

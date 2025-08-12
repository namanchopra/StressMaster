import {
  K6Script,
  ExecutionMetrics,
  RawResults,
  K6Metrics,
  K6ExecutionResult,
} from "../types";
import { Observable, Subject, BehaviorSubject } from "rxjs";
import Docker from "dockerode";
import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  ExecutionMonitor,
  MonitoringConfig,
  ExecutionProgress,
} from "./execution-monitor";
import { WebSocketMonitor, WebSocketMonitorConfig } from "./websocket-monitor";

export interface ScriptExecutor {
  executeScript(script: K6Script): Promise<RawResults>;
  monitorExecution(): Observable<ExecutionMetrics>;
  stopExecution(): Promise<void>;
}

export interface ExecutorConfig {
  k6BinaryPath: string;
  containerImage: string;
  resourceLimits: ResourceLimits;
  outputFormats: string[];
  tempDirectory: string;
  dockerSocketPath?: string;
  monitoring?: MonitoringConfig;
  webSocket?: WebSocketMonitorConfig;
}

export interface ResourceLimits {
  maxMemory: string;
  maxCpu: string;
  maxDuration: string;
  maxVirtualUsers: number;
}

export interface ExecutionEnvironment {
  containerId?: string;
  scriptPath: string;
  outputPath: string;
  logPath: string;
  pid?: number;
}

export class K6ScriptExecutor implements ScriptExecutor {
  private docker: Docker;
  private config: ExecutorConfig;
  private currentExecution: ExecutionEnvironment | null = null;
  private executionMetrics$ = new BehaviorSubject<ExecutionMetrics>({
    status: "idle",
    progress: 0,
    currentVUs: 0,
    requestsCompleted: 0,
    requestsPerSecond: 0,
    avgResponseTime: 0,
    errorRate: 0,
    timestamp: new Date(),
  });
  private executionLogs: string[] = [];
  private executionMonitor?: ExecutionMonitor;
  private webSocketMonitor?: WebSocketMonitor;
  private currentTestId?: string;

  constructor(config: ExecutorConfig) {
    this.config = config;
    this.docker = new Docker({
      socketPath: config.dockerSocketPath || "/var/run/docker.sock",
    });

    // Initialize monitoring if configured
    if (config.monitoring) {
      this.executionMonitor = new ExecutionMonitor(
        config.monitoring,
        this.docker
      );
    }

    // Initialize WebSocket monitoring if configured
    if (config.webSocket) {
      this.webSocketMonitor = new WebSocketMonitor(config.webSocket);
    }
  }

  async executeScript(script: K6Script): Promise<RawResults> {
    this.currentTestId = script.id;

    try {
      // Prepare execution environment
      const environment = await this.prepareExecutionEnvironment(script);
      this.currentExecution = environment;

      // Update status
      this.updateExecutionMetrics({
        status: "preparing",
        progress: 10,
        currentVUs: 0,
        requestsCompleted: 0,
        requestsPerSecond: 0,
        avgResponseTime: 0,
        errorRate: 0,
        timestamp: new Date(),
      });

      // Create and start container
      const container = await this.createK6Container(environment);
      environment.containerId = container.id;

      this.updateExecutionMetrics({
        status: "starting",
        progress: 20,
        currentVUs: 0,
        requestsCompleted: 0,
        requestsPerSecond: 0,
        avgResponseTime: 0,
        errorRate: 0,
        timestamp: new Date(),
      });

      // Start advanced monitoring if available
      let advancedMonitoring$: Observable<ExecutionProgress> | undefined;
      if (this.executionMonitor && environment.containerId) {
        const estimatedDuration = this.estimateExecutionDuration(script);
        advancedMonitoring$ = this.executionMonitor.startMonitoring(
          script.id,
          environment.containerId,
          estimatedDuration
        );

        // Subscribe to advanced monitoring updates
        advancedMonitoring$.subscribe({
          next: (progress) => {
            this.updateExecutionMetrics({
              status: progress.currentMetrics.status,
              progress: progress.progress,
              currentVUs: progress.currentMetrics.currentVUs,
              requestsCompleted: progress.currentMetrics.requestsCompleted,
              requestsPerSecond: progress.currentMetrics.requestsPerSecond,
              avgResponseTime: progress.currentMetrics.avgResponseTime,
              errorRate: progress.currentMetrics.errorRate,
              timestamp: progress.currentMetrics.timestamp,
            });

            // Log warnings
            if (progress.warnings.length > 0) {
              progress.warnings.forEach((warning) => {
                this.executionLogs.push(`Warning: ${warning}`);
              });
            }
          },
          error: (error) => {
            this.executionLogs.push(
              `Monitoring error: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          },
        });

        // Setup WebSocket monitoring if available
        if (this.webSocketMonitor) {
          this.webSocketMonitor.subscribeToExecution(
            script.id,
            advancedMonitoring$
          );
        }
      }

      // Execute script and monitor
      const result = await this.executeInContainer(container, environment);

      // Collect and aggregate results
      const rawResults = await this.collectResults(environment, result);

      this.updateExecutionMetrics({
        status: "completed",
        progress: 100,
        currentVUs: 0,
        requestsCompleted:
          rawResults.k6Output?.metrics?.http_reqs?.values?.count || 0,
        requestsPerSecond:
          rawResults.k6Output?.metrics?.http_reqs?.values?.rate || 0,
        avgResponseTime:
          rawResults.k6Output?.metrics?.http_req_duration?.values?.avg || 0,
        errorRate:
          rawResults.k6Output?.metrics?.http_req_failed?.values?.rate || 0,
        timestamp: new Date(),
      });

      return rawResults;
    } catch (error) {
      this.updateExecutionMetrics({
        status: "failed",
        progress: 0,
        currentVUs: 0,
        requestsCompleted: 0,
        requestsPerSecond: 0,
        avgResponseTime: 0,
        errorRate: 0,
        timestamp: new Date(),
      });

      this.executionLogs.push(
        `Execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    } finally {
      // Stop advanced monitoring
      if (this.executionMonitor && this.currentTestId) {
        this.executionMonitor.stopMonitoring(this.currentTestId);
      }

      // Cleanup
      await this.cleanup();
      this.currentTestId = undefined;
    }
  }

  monitorExecution(): Observable<ExecutionMetrics> {
    return this.executionMetrics$.asObservable();
  }

  async stopExecution(): Promise<void> {
    // Use advanced monitoring cancellation if available
    if (this.executionMonitor && this.currentTestId) {
      try {
        await this.executionMonitor.cancelExecution(this.currentTestId);
        this.executionLogs.push("Execution cancelled via advanced monitoring");
        return;
      } catch (error) {
        this.executionLogs.push(
          `Advanced monitoring cancellation failed, falling back to basic cancellation: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // Fallback to basic cancellation
    if (this.currentExecution?.containerId) {
      try {
        const container = this.docker.getContainer(
          this.currentExecution.containerId
        );
        await container.stop({ t: 5 }); // 5 second timeout
        await container.remove();

        this.updateExecutionMetrics({
          status: "cancelled",
          progress: 0,
          currentVUs: 0,
          requestsCompleted: 0,
          requestsPerSecond: 0,
          avgResponseTime: 0,
          errorRate: 0,
          timestamp: new Date(),
        });

        this.executionLogs.push("Execution cancelled by user");
      } catch (error) {
        this.executionLogs.push(
          `Error stopping execution: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        throw error;
      }
    }
  }

  private async prepareExecutionEnvironment(
    script: K6Script
  ): Promise<ExecutionEnvironment> {
    const executionId = uuidv4();
    const baseDir = path.join(this.config.tempDirectory, executionId);

    // Create directories
    await fs.mkdir(baseDir, { recursive: true });

    const environment: ExecutionEnvironment = {
      scriptPath: path.join(baseDir, "script.js"),
      outputPath: path.join(baseDir, "output.json"),
      logPath: path.join(baseDir, "execution.log"),
    };

    // Write script to file
    await fs.writeFile(environment.scriptPath, script.content, "utf8");

    this.executionLogs.push(`Prepared execution environment: ${baseDir}`);
    return environment;
  }

  private async createK6Container(
    environment: ExecutionEnvironment
  ): Promise<Docker.Container> {
    const containerConfig: Docker.ContainerCreateOptions = {
      Image: this.config.containerImage,
      Cmd: [
        "run",
        "--out",
        "json=/tmp/output.json",
        "--quiet",
        "/tmp/script.js",
      ],
      HostConfig: {
        Memory: this.parseMemoryLimit(this.config.resourceLimits.maxMemory),
        CpuQuota: this.parseCpuLimit(this.config.resourceLimits.maxCpu),
        Binds: [
          `${environment.scriptPath}:/tmp/script.js:ro`,
          `${environment.outputPath}:/tmp/output.json`,
          `${environment.logPath}:/tmp/execution.log`,
        ],
        AutoRemove: false, // We'll remove manually after collecting results
        NetworkMode: "bridge",
      },
      WorkingDir: "/tmp",
      AttachStdout: true,
      AttachStderr: true,
    };

    const container = await this.docker.createContainer(containerConfig);
    this.executionLogs.push(`Created K6 container: ${container.id}`);

    return container;
  }

  private async executeInContainer(
    container: Docker.Container,
    environment: ExecutionEnvironment
  ): Promise<K6ExecutionResult> {
    const startTime = Date.now();

    // Start container
    await container.start();
    this.executionLogs.push("Started K6 container execution");

    this.updateExecutionMetrics({
      status: "running",
      progress: 30,
      currentVUs: 0,
      requestsCompleted: 0,
      requestsPerSecond: 0,
      avgResponseTime: 0,
      errorRate: 0,
      timestamp: new Date(),
    });

    // Monitor container execution
    const monitoringPromise = this.monitorContainerExecution(container);

    // Wait for container to finish
    const waitResult = await container.wait();

    // Stop monitoring
    clearInterval(monitoringPromise);

    // Get logs
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      timestamps: true,
    });

    const duration = Date.now() - startTime;

    return {
      exitCode: waitResult.StatusCode,
      stdout: logs.toString(),
      stderr: "", // stderr is included in logs
      metrics: {} as K6Metrics, // Will be populated from JSON output
      duration,
    };
  }

  private monitorContainerExecution(
    container: Docker.Container
  ): NodeJS.Timeout {
    return setInterval(async () => {
      try {
        const stats = await container.stats({ stream: false });

        // Update metrics based on container stats
        this.updateExecutionMetrics({
          status: "running",
          progress: Math.min(90, this.executionMetrics$.value.progress + 1),
          currentVUs: this.executionMetrics$.value.currentVUs,
          requestsCompleted: this.executionMetrics$.value.requestsCompleted,
          requestsPerSecond: this.executionMetrics$.value.requestsPerSecond,
          avgResponseTime: this.executionMetrics$.value.avgResponseTime,
          errorRate: this.executionMetrics$.value.errorRate,
          timestamp: new Date(),
        });
      } catch (error) {
        // Container might have stopped, ignore errors
      }
    }, 1000);
  }

  private async collectResults(
    environment: ExecutionEnvironment,
    executionResult: K6ExecutionResult
  ): Promise<RawResults> {
    let k6Output: any = {};

    try {
      // Read K6 JSON output
      const outputContent = await fs.readFile(environment.outputPath, "utf8");
      k6Output = JSON.parse(outputContent);
    } catch (error) {
      this.executionLogs.push(
        `Warning: Could not read K6 output: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Collect system metrics (basic implementation)
    const systemMetrics = [
      {
        timestamp: new Date(),
        cpuUsage: 0, // Would be populated from container stats
        memoryUsage: 0, // Would be populated from container stats
        networkIO: {
          bytesIn: 0,
          bytesOut: 0,
        },
      },
    ];

    return {
      k6Output,
      executionLogs: [...this.executionLogs],
      systemMetrics,
    };
  }

  private async cleanup(): Promise<void> {
    if (this.currentExecution?.containerId) {
      try {
        const container = this.docker.getContainer(
          this.currentExecution.containerId
        );

        // Try to stop container if still running
        try {
          await container.stop({ t: 5 });
        } catch (error) {
          // Container might already be stopped
        }

        // Remove container
        await container.remove();
        this.executionLogs.push("Cleaned up K6 container");
      } catch (error) {
        this.executionLogs.push(
          `Warning: Cleanup error: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    this.currentExecution = null;
  }

  private updateExecutionMetrics(metrics: ExecutionMetrics): void {
    this.executionMetrics$.next(metrics);
  }

  private parseMemoryLimit(memoryLimit: string): number {
    // Convert memory limit string (e.g., "512m", "1g") to bytes
    const match = memoryLimit.match(/^(\d+)([kmg]?)$/i);
    if (!match) return 512 * 1024 * 1024; // Default 512MB

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case "k":
        return value * 1024;
      case "m":
        return value * 1024 * 1024;
      case "g":
        return value * 1024 * 1024 * 1024;
      default:
        return value;
    }
  }

  private parseCpuLimit(cpuLimit: string): number {
    // Convert CPU limit string (e.g., "0.5", "1.0") to CPU quota
    const cpuValue = parseFloat(cpuLimit);
    return Math.floor(cpuValue * 100000); // Docker CPU quota is in microseconds
  }

  private estimateExecutionDuration(script: K6Script): number {
    // Estimate execution duration based on K6 script options
    const options = script.options;

    if (options.duration) {
      // Parse duration string (e.g., "30s", "5m", "1h")
      const match = options.duration.match(/^(\d+)([smh])$/);
      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2];

        switch (unit) {
          case "s":
            return value;
          case "m":
            return value * 60;
          case "h":
            return value * 3600;
          default:
            return 60; // Default 1 minute
        }
      }
    }

    if (options.stages && options.stages.length > 0) {
      // Calculate total duration from stages
      return options.stages.reduce((total, stage) => {
        const match = stage.duration.match(/^(\d+)([smh])$/);
        if (match) {
          const value = parseInt(match[1]);
          const unit = match[2];

          switch (unit) {
            case "s":
              return total + value;
            case "m":
              return total + value * 60;
            case "h":
              return total + value * 3600;
            default:
              return total + 60;
          }
        }
        return total + 60; // Default 1 minute per stage
      }, 0);
    }

    // Default estimation: 1 minute
    return 60;
  }

  // Cleanup method for monitoring components
  async dispose(): Promise<void> {
    // Stop any active monitoring
    if (this.executionMonitor && this.currentTestId) {
      this.executionMonitor.stopMonitoring(this.currentTestId);
    }

    // Close WebSocket server
    if (this.webSocketMonitor) {
      this.webSocketMonitor.close();
    }

    // Cleanup current execution
    await this.cleanup();
  }
}

import { K6ScriptExecutor, ExecutorConfig } from "./script-executor";
import { MonitoringConfig } from "./execution-monitor";
import { WebSocketMonitorConfig } from "./websocket-monitor";
import path from "path";
import { promises as fs } from "fs";

export class K6ExecutorFactory {
  private static defaultConfig: ExecutorConfig = {
    k6BinaryPath: "/usr/bin/k6",
    containerImage: "grafana/k6:latest",
    resourceLimits: {
      maxMemory: "512m",
      maxCpu: "1.0",
      maxDuration: "1h",
      maxVirtualUsers: 1000,
    },
    outputFormats: ["json"],
    tempDirectory: "/tmp/k6-executions",
    dockerSocketPath: "/var/run/docker.sock",
    monitoring: {
      updateInterval: 1000, // 1 second
      resourceThresholds: {
        maxMemoryUsage: 80, // 80%
        maxCpuUsage: 90, // 90%
        maxNetworkIO: 100 * 1024 * 1024, // 100 MB/s
      },
      enableWebSocket: true,
      webSocketPort: 8080,
    },
    webSocket: {
      port: 8080,
      path: "/monitor",
      heartbeatInterval: 30000, // 30 seconds
    },
  };

  static async createExecutor(
    config?: Partial<ExecutorConfig>
  ): Promise<K6ScriptExecutor> {
    const finalConfig = { ...this.defaultConfig, ...config };

    // Ensure temp directory exists
    await fs.mkdir(finalConfig.tempDirectory, { recursive: true });

    // Validate Docker connection
    await this.validateDockerConnection(finalConfig);

    // Pull K6 image if not present
    await this.ensureK6Image(finalConfig);

    return new K6ScriptExecutor(finalConfig);
  }

  private static async validateDockerConnection(
    config: ExecutorConfig
  ): Promise<void> {
    try {
      const Docker = (await import("dockerode")).default;
      const docker = new Docker({
        socketPath: config.dockerSocketPath,
      });

      await docker.ping();
    } catch (error) {
      throw new Error(
        `Docker connection failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private static async ensureK6Image(config: ExecutorConfig): Promise<void> {
    try {
      const Docker = (await import("dockerode")).default;
      const docker = new Docker({
        socketPath: config.dockerSocketPath,
      });

      // Check if image exists
      try {
        await docker.getImage(config.containerImage).inspect();
        return; // Image exists
      } catch (error) {
        // Image doesn't exist, pull it
      }

      console.log(`Pulling K6 image: ${config.containerImage}`);

      const stream = await docker.pull(config.containerImage);

      return new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (err, res) => {
          if (err) {
            reject(new Error(`Failed to pull K6 image: ${err.message}`));
          } else {
            console.log(
              `Successfully pulled K6 image: ${config.containerImage}`
            );
            resolve();
          }
        });
      });
    } catch (error) {
      throw new Error(
        `Failed to ensure K6 image: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  static getDefaultConfig(): ExecutorConfig {
    return { ...this.defaultConfig };
  }
}

import axios, { AxiosInstance, AxiosResponse } from "axios";
import { OllamaResponse, ParserConfig } from "./command-parser";
import {
  AIErrorHandler,
  AIServiceError,
  AIErrorType,
  DiagnosticInfo,
} from "./ai-error-handler";

export interface OllamaRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  format?: "json";
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
  };
}

export interface ConnectionPoolConfig {
  maxConnections: number;
  connectionTimeout: number;
  requestTimeout: number;
  retryAttempts: number;
  retryDelay: number;
}

export class OllamaClient {
  private client: AxiosInstance;
  private config: ParserConfig;
  private poolConfig: ConnectionPoolConfig;
  private activeConnections: number = 0;
  private connectionQueue: Array<() => void> = [];
  private errorHandler: AIErrorHandler;
  private isServiceHealthy: boolean = true;
  private lastHealthCheck: Date = new Date(0);
  private healthCheckInterval: number = 30000; // 30 seconds

  constructor(
    config: ParserConfig,
    poolConfig?: Partial<ConnectionPoolConfig>
  ) {
    this.config = config;
    this.poolConfig = {
      maxConnections: 5,
      connectionTimeout: 10000,
      requestTimeout: 30000,
      retryAttempts: 2,
      retryDelay: 500,
      ...poolConfig,
    };

    this.errorHandler = new AIErrorHandler({
      maxAttempts: this.poolConfig.retryAttempts,
      baseDelay: this.poolConfig.retryDelay,
      maxDelay: 30000,
      backoffMultiplier: 2,
      jitterEnabled: true,
    });

    this.client = axios.create({
      baseURL: config.ollamaEndpoint,
      timeout: this.poolConfig.requestTimeout,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor for connection pooling
    this.client.interceptors.request.use(
      async (config) => {
        await this.acquireConnection();
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor for connection release
    this.client.interceptors.response.use(
      (response) => {
        this.releaseConnection();
        return response;
      },
      (error) => {
        this.releaseConnection();
        return Promise.reject(error);
      }
    );
  }

  private async acquireConnection(): Promise<void> {
    return new Promise((resolve) => {
      if (this.activeConnections < this.poolConfig.maxConnections) {
        this.activeConnections++;
        resolve();
      } else {
        this.connectionQueue.push(() => {
          this.activeConnections++;
          resolve();
        });
      }
    });
  }

  private releaseConnection(): void {
    this.activeConnections--;
    if (this.connectionQueue.length > 0) {
      const next = this.connectionQueue.shift();
      if (next) {
        next();
      }
    }
  }

  async generateCompletion(request: OllamaRequest): Promise<OllamaResponse> {
    const requestData = {
      model: request.model,
      prompt: request.prompt,
      stream: false,
      format: request.format,
      options: request.options,
    };

    return this.errorHandler.executeWithRetry(
      async () => {
        // Check service health before making request
        await this.ensureServiceHealth();

        const response: AxiosResponse<OllamaResponse> = await this.client.post(
          "/api/generate",
          requestData
        );

        // Validate response structure
        if (!response.data || typeof response.data.response !== "string") {
          throw new AIServiceError(
            AIErrorType.INVALID_RESPONSE,
            "Invalid response format from Ollama API",
            {
              operation: "generate_completion",
              attempt: 1,
              maxAttempts: 1,
              timestamp: new Date(),
              modelName: request.model,
            }
          );
        }

        this.isServiceHealthy = true;
        return response.data;
      },
      "generate_completion",
      {
        modelName: request.model,
        requestId: `req_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`,
      }
    );
  }

  async checkModelAvailability(modelName: string): Promise<boolean> {
    return this.errorHandler
      .executeWithRetry(
        async () => {
          const response = await this.client.get("/api/tags");
          const models = response.data.models || [];
          return models.some((model: any) => model.name === modelName);
        },
        "check_model_availability",
        { modelName }
      )
      .catch((error) => {
        console.warn(`Failed to check model availability: ${error.message}`);
        return false;
      });
  }

  async pullModel(modelName: string): Promise<void> {
    return this.errorHandler.executeWithRetry(
      async () => {
        const response = await this.client.post("/api/pull", {
          name: modelName,
        });

        // Validate pull response
        if (response.status !== 200) {
          throw new AIServiceError(
            AIErrorType.MODEL_UNAVAILABLE,
            `Failed to pull model ${modelName}`,
            {
              operation: "pull_model",
              attempt: 1,
              maxAttempts: 1,
              timestamp: new Date(),
              modelName,
            }
          );
        }
      },
      "pull_model",
      { modelName }
    );
  }

  async healthCheck(): Promise<boolean> {
    const { healthy } = await this.errorHandler.performHealthCheck(async () => {
      const response = await this.client.get("/api/tags", { timeout: 5000 });
      return response.status === 200;
    }, this.config.ollamaEndpoint);

    this.isServiceHealthy = healthy;
    this.lastHealthCheck = new Date();
    return healthy;
  }

  /**
   * Ensures the service is healthy before making requests
   */
  private async ensureServiceHealth(): Promise<void> {
    const now = new Date();
    const timeSinceLastCheck = now.getTime() - this.lastHealthCheck.getTime();

    // Perform health check if it's been too long or service was unhealthy
    if (
      timeSinceLastCheck > this.healthCheckInterval ||
      !this.isServiceHealthy
    ) {
      const isHealthy = await this.healthCheck();
      if (!isHealthy) {
        throw new AIServiceError(
          AIErrorType.SERVICE_UNAVAILABLE,
          "Ollama service is not healthy",
          {
            operation: "health_check",
            attempt: 1,
            maxAttempts: 1,
            timestamp: now,
          }
        );
      }
    }
  }

  /**
   * Gets comprehensive error statistics and diagnostics
   */
  getErrorStatistics() {
    return this.errorHandler.getErrorStatistics();
  }

  /**
   * Gets graceful degradation strategy for current service state
   */
  getGracefulDegradationStrategy() {
    const stats = this.errorHandler.getErrorStatistics();

    if (stats.totalErrors === 0) {
      return {
        canDegrade: false,
        strategy: "none",
        confidence: 1.0,
        limitations: [],
      };
    }

    // Find the most recent error type
    const recentError = stats.recentErrors[stats.recentErrors.length - 1];
    if (recentError) {
      return this.errorHandler.getGracefulDegradationStrategy(
        recentError.error
      );
    }

    return {
      canDegrade: true,
      strategy: "fallback_parsing",
      confidence: 0.3,
      limitations: ["Service experiencing issues"],
    };
  }

  /**
   * Clears error diagnostics and resets error tracking
   */
  clearDiagnostics(): void {
    this.errorHandler.clearDiagnostics();
  }

  /**
   * Gets current service health status
   */
  getServiceHealth(): {
    healthy: boolean;
    lastCheck: Date;
    connectionStats: { active: number; queued: number };
  } {
    return {
      healthy: this.isServiceHealthy,
      lastCheck: this.lastHealthCheck,
      connectionStats: {
        active: this.activeConnections,
        queued: this.connectionQueue.length,
      },
    };
  }

  getActiveConnections(): number {
    return this.activeConnections;
  }

  getQueueLength(): number {
    return this.connectionQueue.length;
  }
}

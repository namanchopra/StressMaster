import { AxiosError } from "axios";

export enum AIErrorType {
  CONNECTION_FAILED = "CONNECTION_FAILED",
  MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE",
  TIMEOUT = "TIMEOUT",
  RATE_LIMITED = "RATE_LIMITED",
  INVALID_RESPONSE = "INVALID_RESPONSE",
  RESOURCE_EXHAUSTED = "RESOURCE_EXHAUSTED",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED",
  UNKNOWN = "UNKNOWN",
}

export interface AIErrorContext {
  operation: string;
  attempt: number;
  maxAttempts: number;
  timestamp: Date;
  modelName?: string;
  requestId?: string;
  additionalInfo?: Record<string, any>;
}

export class AIServiceError extends Error {
  public readonly type: AIErrorType;
  public readonly context: AIErrorContext;
  public readonly originalError?: Error;
  public readonly retryable: boolean;
  public readonly severity: "low" | "medium" | "high" | "critical";

  constructor(
    type: AIErrorType,
    message: string,
    context: AIErrorContext,
    originalError?: Error,
    retryable: boolean = true,
    severity: "low" | "medium" | "high" | "critical" = "medium"
  ) {
    super(message);
    this.name = "AIServiceError";
    this.type = type;
    this.context = context;
    this.originalError = originalError;
    this.retryable = retryable;
    this.severity = severity;
  }

  toJSON() {
    return {
      name: this.name,
      type: this.type,
      message: this.message,
      context: this.context,
      retryable: this.retryable,
      severity: this.severity,
      stack: this.stack,
      originalError: this.originalError?.message,
    };
  }
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitterEnabled: boolean;
}

export interface DiagnosticInfo {
  timestamp: Date;
  operation: string;
  error: AIServiceError;
  systemInfo: {
    memoryUsage: NodeJS.MemoryUsage;
    uptime: number;
    platform: string;
  };
  networkInfo?: {
    endpoint: string;
    responseTime?: number;
    statusCode?: number;
  };
}

export class AIErrorHandler {
  private static readonly DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitterEnabled: true,
  };

  private diagnosticLog: DiagnosticInfo[] = [];
  private errorCounts: Map<AIErrorType, number> = new Map();
  private lastErrorTime: Map<AIErrorType, Date> = new Map();

  constructor(
    private retryConfig: RetryConfig = AIErrorHandler.DEFAULT_RETRY_CONFIG
  ) {}

  /**
   * Classifies an error and creates an AIServiceError
   */
  classifyError(error: any, context: Partial<AIErrorContext>): AIServiceError {
    const fullContext: AIErrorContext = {
      operation: "unknown",
      attempt: 1,
      maxAttempts: this.retryConfig.maxAttempts,
      timestamp: new Date(),
      ...context,
    };

    if (error instanceof AIServiceError) {
      return error;
    }

    let errorType: AIErrorType;
    let retryable = true;
    let severity: "low" | "medium" | "high" | "critical" = "medium";

    if (this.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      if (!axiosError.response) {
        // Network error
        if (axiosError.code === "ECONNREFUSED") {
          errorType = AIErrorType.CONNECTION_FAILED;
          severity = "high";
        } else if (axiosError.code === "ETIMEDOUT") {
          errorType = AIErrorType.TIMEOUT;
          severity = "medium";
        } else {
          errorType = AIErrorType.SERVICE_UNAVAILABLE;
          severity = "high";
        }
      } else {
        // HTTP error
        const status = axiosError.response.status;
        if (status === 401 || status === 403) {
          errorType = AIErrorType.AUTHENTICATION_FAILED;
          retryable = false;
          severity = "critical";
        } else if (status === 429) {
          errorType = AIErrorType.RATE_LIMITED;
          severity = "medium";
        } else if (status === 404) {
          errorType = AIErrorType.MODEL_UNAVAILABLE;
          severity = "high";
        } else if (status >= 500) {
          errorType = AIErrorType.SERVICE_UNAVAILABLE;
          severity = "high";
        } else {
          errorType = AIErrorType.UNKNOWN;
          retryable = false;
          severity = "low";
        }
      }
    } else if (error.message?.toLowerCase().includes("model")) {
      errorType = AIErrorType.MODEL_UNAVAILABLE;
      severity = "high";
    } else if (error.message?.toLowerCase().includes("timeout")) {
      errorType = AIErrorType.TIMEOUT;
      severity = "medium";
    } else if (
      error.message?.toLowerCase().includes("parse") ||
      error.message?.toLowerCase().includes("json")
    ) {
      errorType = AIErrorType.INVALID_RESPONSE;
      retryable = false;
      severity = "low";
    } else {
      errorType = AIErrorType.UNKNOWN;
      severity = "low";
    }

    const message = this.buildErrorMessage(errorType, error, fullContext);

    return new AIServiceError(
      errorType,
      message,
      fullContext,
      error,
      retryable,
      severity
    );
  }

  /**
   * Executes an operation with retry logic and error handling
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    context: Partial<AIErrorContext> = {}
  ): Promise<T> {
    let lastError: AIServiceError;

    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();

        // Reset error counts on success
        if (attempt > 1) {
          this.logRecovery(operationName, attempt);
        }

        return result;
      } catch (error) {
        const aiError = this.classifyError(error, {
          ...context,
          operation: operationName,
          attempt,
          maxAttempts: this.retryConfig.maxAttempts,
        });

        lastError = aiError;
        this.recordError(aiError);
        this.logDiagnosticInfo(aiError);

        // Don't retry if error is not retryable or we've reached max attempts
        if (!aiError.retryable || attempt === this.retryConfig.maxAttempts) {
          break;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Checks if the AI service is available and healthy
   */
  async performHealthCheck(
    healthCheckFn: () => Promise<boolean>,
    endpoint: string
  ): Promise<{ healthy: boolean; diagnostics: DiagnosticInfo | null }> {
    const startTime = Date.now();
    let diagnostics: DiagnosticInfo | null = null;

    try {
      const healthy = await healthCheckFn();

      if (!healthy) {
        const error = new AIServiceError(
          AIErrorType.SERVICE_UNAVAILABLE,
          "Health check failed",
          {
            operation: "health_check",
            attempt: 1,
            maxAttempts: 1,
            timestamp: new Date(),
          },
          undefined,
          true,
          "high"
        );

        diagnostics = this.createDiagnosticInfo(error, {
          endpoint,
          responseTime: Date.now() - startTime,
        });
      }

      return { healthy, diagnostics };
    } catch (error) {
      const aiError = this.classifyError(error, {
        operation: "health_check",
        attempt: 1,
        maxAttempts: 1,
      });

      diagnostics = this.createDiagnosticInfo(aiError, {
        endpoint,
        responseTime: Date.now() - startTime,
      });

      return { healthy: false, diagnostics };
    }
  }

  /**
   * Provides graceful degradation recommendations
   */
  getGracefulDegradationStrategy(error: AIServiceError): {
    canDegrade: boolean;
    strategy: string;
    confidence: number;
    limitations: string[];
  } {
    switch (error.type) {
      case AIErrorType.MODEL_UNAVAILABLE:
      case AIErrorType.SERVICE_UNAVAILABLE:
      case AIErrorType.CONNECTION_FAILED:
        return {
          canDegrade: true,
          strategy: "fallback_parsing",
          confidence: 0.3,
          limitations: [
            "Limited parsing accuracy",
            "No AI-powered suggestions",
            "Basic pattern matching only",
          ],
        };

      case AIErrorType.TIMEOUT:
      case AIErrorType.RATE_LIMITED:
        return {
          canDegrade: true,
          strategy: "cached_responses",
          confidence: 0.6,
          limitations: [
            "May use outdated parsing patterns",
            "Limited to previously seen commands",
          ],
        };

      case AIErrorType.RESOURCE_EXHAUSTED:
        return {
          canDegrade: true,
          strategy: "simplified_parsing",
          confidence: 0.4,
          limitations: [
            "Reduced parsing complexity",
            "May miss advanced features",
          ],
        };

      default:
        return {
          canDegrade: false,
          strategy: "none",
          confidence: 0,
          limitations: ["No fallback available for this error type"],
        };
    }
  }

  /**
   * Gets error statistics and trends
   */
  getErrorStatistics(): {
    totalErrors: number;
    errorsByType: Record<AIErrorType, number>;
    recentErrors: DiagnosticInfo[];
    errorTrends: {
      type: AIErrorType;
      frequency: number;
      lastOccurrence: Date;
    }[];
  } {
    const totalErrors = Array.from(this.errorCounts.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    const errorsByType = Object.fromEntries(this.errorCounts) as Record<
      AIErrorType,
      number
    >;
    const recentErrors = this.diagnosticLog.slice(-10);

    const errorTrends = Array.from(this.errorCounts.entries()).map(
      ([type, count]) => ({
        type,
        frequency: count,
        lastOccurrence: this.lastErrorTime.get(type) || new Date(0),
      })
    );

    return {
      totalErrors,
      errorsByType,
      recentErrors,
      errorTrends,
    };
  }

  /**
   * Clears diagnostic logs and error counts
   */
  clearDiagnostics(): void {
    this.diagnosticLog = [];
    this.errorCounts.clear();
    this.lastErrorTime.clear();
  }

  private isAxiosError(error: any): boolean {
    return error?.isAxiosError === true;
  }

  private buildErrorMessage(
    type: AIErrorType,
    originalError: any,
    context: AIErrorContext
  ): string {
    const baseMessage = `AI Service Error (${type})`;
    const operation = context.operation;
    const attempt = `${context.attempt}/${context.maxAttempts}`;

    let details = "";
    if (originalError?.message) {
      details = `: ${originalError.message}`;
    }

    return `${baseMessage} during ${operation} (attempt ${attempt})${details}`;
  }

  private calculateDelay(attempt: number): number {
    let delay =
      this.retryConfig.baseDelay *
      Math.pow(this.retryConfig.backoffMultiplier, attempt - 1);
    delay = Math.min(delay, this.retryConfig.maxDelay);

    if (this.retryConfig.jitterEnabled) {
      // Add jitter to prevent thundering herd
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    return Math.floor(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private recordError(error: AIServiceError): void {
    const count = this.errorCounts.get(error.type) || 0;
    this.errorCounts.set(error.type, count + 1);
    this.lastErrorTime.set(error.type, error.context.timestamp);
  }

  private logDiagnosticInfo(error: AIServiceError): void {
    const diagnosticInfo = this.createDiagnosticInfo(error);
    this.diagnosticLog.push(diagnosticInfo);

    // Keep only last 100 entries
    if (this.diagnosticLog.length > 100) {
      this.diagnosticLog = this.diagnosticLog.slice(-100);
    }
  }

  private createDiagnosticInfo(
    error: AIServiceError,
    networkInfo?: {
      endpoint: string;
      responseTime?: number;
      statusCode?: number;
    }
  ): DiagnosticInfo {
    return {
      timestamp: error.context.timestamp,
      operation: error.context.operation,
      error,
      systemInfo: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        platform: process.platform,
      },
      networkInfo,
    };
  }

  private logRecovery(operationName: string, successfulAttempt: number): void {
    console.log(
      `AI service recovered for operation '${operationName}' on attempt ${successfulAttempt}`
    );
  }
}

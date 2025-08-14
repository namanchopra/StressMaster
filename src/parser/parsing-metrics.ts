/**
 * Metrics collection and monitoring for Smart AI Parser
 */

export interface ParsingMetrics {
  totalRequests: number;
  successfulParses: number;
  failedParses: number;
  fallbackUsed: number;
  averageResponseTime: number;
  averageConfidence: number;
  errorsByType: Record<string, number>;
  formatDetectionAccuracy: number;
  retryCount: number;
}

export interface ParseAttempt {
  id: string;
  timestamp: number;
  inputLength: number;
  detectedFormat: string;
  confidence: number;
  responseTimeMs: number;
  success: boolean;
  errorType?: string;
  errorMessage?: string;
  usedFallback: boolean;
  retryCount: number;
  assumptions: number;
  warnings: number;
}

export interface DiagnosticInfo {
  parseAttemptId: string;
  timestamp: number;
  stage:
    | "preprocessing"
    | "format_detection"
    | "context_enhancement"
    | "ai_parsing"
    | "validation"
    | "fallback";
  details: Record<string, any>;
  duration: number;
  success: boolean;
  error?: string;
}

/**
 * Metrics collector for parsing operations
 */
export class ParsingMetricsCollector {
  private metrics: ParsingMetrics;
  private parseAttempts: ParseAttempt[] = [];
  private diagnostics: DiagnosticInfo[] = [];
  private retentionMs: number;

  constructor(retentionMs: number = 24 * 60 * 60 * 1000) {
    this.retentionMs = retentionMs;
    this.metrics = this.initializeMetrics();
  }

  /**
   * Record a parsing attempt
   */
  recordParseAttempt(attempt: ParseAttempt): void {
    this.parseAttempts.push(attempt);
    this.updateMetrics(attempt);
    this.cleanupOldData();
  }

  /**
   * Record diagnostic information
   */
  recordDiagnostic(diagnostic: DiagnosticInfo): void {
    this.diagnostics.push(diagnostic);
    this.cleanupOldData();
  }

  /**
   * Get current metrics
   */
  getMetrics(): ParsingMetrics {
    return { ...this.metrics };
  }

  /**
   * Get parsing attempts within time range
   */
  getParseAttempts(
    fromTimestamp?: number,
    toTimestamp?: number
  ): ParseAttempt[] {
    let attempts = [...this.parseAttempts];

    if (fromTimestamp) {
      attempts = attempts.filter((a) => a.timestamp >= fromTimestamp);
    }

    if (toTimestamp) {
      attempts = attempts.filter((a) => a.timestamp <= toTimestamp);
    }

    return attempts;
  }

  /**
   * Get diagnostic information for a specific parse attempt
   */
  getDiagnostics(parseAttemptId: string): DiagnosticInfo[] {
    return this.diagnostics.filter((d) => d.parseAttemptId === parseAttemptId);
  }

  /**
   * Get aggregated metrics for a time period
   */
  getAggregatedMetrics(
    fromTimestamp: number,
    toTimestamp: number
  ): ParsingMetrics {
    const attempts = this.getParseAttempts(fromTimestamp, toTimestamp);
    return this.calculateMetrics(attempts);
  }

  /**
   * Reset all metrics and data
   */
  reset(): void {
    this.metrics = this.initializeMetrics();
    this.parseAttempts = [];
    this.diagnostics = [];
  }

  /**
   * Export metrics data for analysis
   */
  exportData(): {
    metrics: ParsingMetrics;
    attempts: ParseAttempt[];
    diagnostics: DiagnosticInfo[];
  } {
    return {
      metrics: this.getMetrics(),
      attempts: [...this.parseAttempts],
      diagnostics: [...this.diagnostics],
    };
  }

  private initializeMetrics(): ParsingMetrics {
    return {
      totalRequests: 0,
      successfulParses: 0,
      failedParses: 0,
      fallbackUsed: 0,
      averageResponseTime: 0,
      averageConfidence: 0,
      errorsByType: {},
      formatDetectionAccuracy: 0,
      retryCount: 0,
    };
  }

  private updateMetrics(attempt: ParseAttempt): void {
    this.metrics = this.calculateMetrics(this.parseAttempts);
  }

  private calculateMetrics(attempts: ParseAttempt[]): ParsingMetrics {
    if (attempts.length === 0) {
      return this.initializeMetrics();
    }

    const successful = attempts.filter((a) => a.success);
    const failed = attempts.filter((a) => !a.success);
    const fallbackUsed = attempts.filter((a) => a.usedFallback);

    const totalResponseTime = attempts.reduce(
      (sum, a) => sum + a.responseTimeMs,
      0
    );
    const totalConfidence = successful.reduce(
      (sum, a) => sum + a.confidence,
      0
    );
    const totalRetries = attempts.reduce((sum, a) => sum + a.retryCount, 0);

    const errorsByType: Record<string, number> = {};
    failed.forEach((attempt) => {
      if (attempt.errorType) {
        errorsByType[attempt.errorType] =
          (errorsByType[attempt.errorType] || 0) + 1;
      }
    });

    return {
      totalRequests: attempts.length,
      successfulParses: successful.length,
      failedParses: failed.length,
      fallbackUsed: fallbackUsed.length,
      averageResponseTime: totalResponseTime / attempts.length,
      averageConfidence:
        successful.length > 0 ? totalConfidence / successful.length : 0,
      errorsByType,
      formatDetectionAccuracy: successful.length / attempts.length,
      retryCount: totalRetries,
    };
  }

  private cleanupOldData(): void {
    const cutoffTime = Date.now() - this.retentionMs;

    this.parseAttempts = this.parseAttempts.filter(
      (a) => a.timestamp > cutoffTime
    );
    this.diagnostics = this.diagnostics.filter((d) => d.timestamp > cutoffTime);
  }
}

/**
 * Performance monitor for parsing pipeline stages
 */
export class ParsingPerformanceMonitor {
  private activeOperations: Map<string, { stage: string; startTime: number }> =
    new Map();
  private metricsCollector: ParsingMetricsCollector;

  constructor(metricsCollector: ParsingMetricsCollector) {
    this.metricsCollector = metricsCollector;
  }

  /**
   * Start monitoring a parsing operation stage
   */
  startStage(parseAttemptId: string, stage: DiagnosticInfo["stage"]): void {
    const key = `${parseAttemptId}:${stage}`;
    this.activeOperations.set(key, {
      stage,
      startTime: Date.now(),
    });
  }

  /**
   * End monitoring a parsing operation stage
   */
  endStage(
    parseAttemptId: string,
    stage: DiagnosticInfo["stage"],
    success: boolean,
    details: Record<string, any> = {},
    error?: string
  ): void {
    const key = `${parseAttemptId}:${stage}`;
    const operation = this.activeOperations.get(key);

    if (!operation) {
      return;
    }

    const duration = Date.now() - operation.startTime;

    this.metricsCollector.recordDiagnostic({
      parseAttemptId,
      timestamp: Date.now(),
      stage,
      details,
      duration,
      success,
      error,
    });

    this.activeOperations.delete(key);
  }

  /**
   * Get currently active operations
   */
  getActiveOperations(): Array<{
    parseAttemptId: string;
    stage: string;
    duration: number;
  }> {
    const now = Date.now();
    return Array.from(this.activeOperations.entries()).map(
      ([key, operation]) => {
        const [parseAttemptId, stage] = key.split(":");
        return {
          parseAttemptId,
          stage,
          duration: now - operation.startTime,
        };
      }
    );
  }
}

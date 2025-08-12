export interface PerformanceMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;

  responseTime: ResponseTimeMetrics;
  throughput: ThroughputMetrics;

  errorRate: number;
}

export interface ResponseTimeMetrics {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface ThroughputMetrics {
  requestsPerSecond: number;
  bytesPerSecond: number;
}

export interface ErrorSummary {
  errorType: string;
  errorMessage: string;
  count: number;
  percentage: number;
  firstOccurrence: Date;
  lastOccurrence: Date;
}

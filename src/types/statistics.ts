import {
  PerformanceMetrics,
  ResponseTimeMetrics,
  ThroughputMetrics,
  ErrorSummary,
} from "./performance-metrics.js";

/**
 * Raw data point for statistical calculations
 */
export interface DataPoint {
  timestamp: Date;
  responseTime: number;
  statusCode: number;
  bytes: number;
  error?: string;
}

/**
 * Calculates percentile value from a sorted array of numbers
 */
export function calculatePercentile(
  sortedValues: number[],
  percentile: number
): number {
  if (sortedValues.length === 0) return 0;
  if (percentile <= 0) return sortedValues[0];
  if (percentile >= 100) return sortedValues[sortedValues.length - 1];

  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * Calculates basic statistical measures from an array of numbers
 */
export function calculateBasicStats(values: number[]): {
  min: number;
  max: number;
  avg: number;
  sum: number;
  count: number;
} {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, sum: 0, count: 0 };
  }

  const sum = values.reduce((acc, val) => acc + val, 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = sum / values.length;

  return { min, max, avg, sum, count: values.length };
}

/**
 * Calculates response time metrics from raw data points
 */
export function calculateResponseTimeMetrics(
  dataPoints: DataPoint[]
): ResponseTimeMetrics {
  const responseTimes = dataPoints.map((point) => point.responseTime);
  const sortedTimes = [...responseTimes].sort((a, b) => a - b);

  const basicStats = calculateBasicStats(responseTimes);

  return {
    min: basicStats.min,
    max: basicStats.max,
    avg: Math.round(basicStats.avg * 100) / 100, // Round to 2 decimal places
    p50: Math.round(calculatePercentile(sortedTimes, 50) * 100) / 100,
    p90: Math.round(calculatePercentile(sortedTimes, 90) * 100) / 100,
    p95: Math.round(calculatePercentile(sortedTimes, 95) * 100) / 100,
    p99: Math.round(calculatePercentile(sortedTimes, 99) * 100) / 100,
  };
}

/**
 * Calculates throughput metrics from raw data points
 */
export function calculateThroughputMetrics(
  dataPoints: DataPoint[],
  testDurationSeconds: number
): ThroughputMetrics {
  if (testDurationSeconds <= 0 || dataPoints.length === 0) {
    return { requestsPerSecond: 0, bytesPerSecond: 0 };
  }

  const totalRequests = dataPoints.length;
  const totalBytes = dataPoints.reduce((sum, point) => sum + point.bytes, 0);

  return {
    requestsPerSecond:
      Math.round((totalRequests / testDurationSeconds) * 100) / 100,
    bytesPerSecond: Math.round((totalBytes / testDurationSeconds) * 100) / 100,
  };
}

/**
 * Calculates error summary from raw data points
 */
export function calculateErrorSummary(dataPoints: DataPoint[]): ErrorSummary[] {
  const errorMap = new Map<
    string,
    {
      count: number;
      firstOccurrence: Date;
      lastOccurrence: Date;
      message: string;
    }
  >();

  const totalRequests = dataPoints.length;

  // Group errors by type/message
  dataPoints.forEach((point) => {
    if (point.error || point.statusCode >= 400) {
      const errorKey = point.error || `HTTP ${point.statusCode}`;
      const errorMessage = point.error || `HTTP Error ${point.statusCode}`;

      if (errorMap.has(errorKey)) {
        const existing = errorMap.get(errorKey)!;
        existing.count++;
        existing.lastOccurrence = point.timestamp;
      } else {
        errorMap.set(errorKey, {
          count: 1,
          firstOccurrence: point.timestamp,
          lastOccurrence: point.timestamp,
          message: errorMessage,
        });
      }
    }
  });

  // Convert to ErrorSummary array
  return Array.from(errorMap.entries())
    .map(([errorType, data]) => ({
      errorType,
      errorMessage: data.message,
      count: data.count,
      percentage: Math.round((data.count / totalRequests) * 10000) / 100, // Round to 2 decimal places
      firstOccurrence: data.firstOccurrence,
      lastOccurrence: data.lastOccurrence,
    }))
    .sort((a, b) => b.count - a.count); // Sort by count descending
}

/**
 * Calculates complete performance metrics from raw data points
 */
export function calculatePerformanceMetrics(
  dataPoints: DataPoint[],
  testDurationSeconds: number
): PerformanceMetrics {
  const totalRequests = dataPoints.length;
  const successfulRequests = dataPoints.filter(
    (point) => !point.error && point.statusCode >= 200 && point.statusCode < 400
  ).length;
  const failedRequests = totalRequests - successfulRequests;

  const responseTime = calculateResponseTimeMetrics(dataPoints);
  const throughput = calculateThroughputMetrics(
    dataPoints,
    testDurationSeconds
  );
  const errorRate =
    totalRequests > 0
      ? Math.round((failedRequests / totalRequests) * 10000) / 100
      : 0;

  return {
    totalRequests,
    successfulRequests,
    failedRequests,
    responseTime,
    throughput,
    errorRate,
  };
}

/**
 * Calculates moving average for trend analysis
 */
export function calculateMovingAverage(
  values: number[],
  windowSize: number
): number[] {
  if (windowSize <= 0 || windowSize > values.length) {
    return values;
  }

  const result: number[] = [];

  for (let i = 0; i <= values.length - windowSize; i++) {
    const window = values.slice(i, i + windowSize);
    const average = window.reduce((sum, val) => sum + val, 0) / windowSize;
    result.push(Math.round(average * 100) / 100);
  }

  return result;
}

/**
 * Calculates standard deviation
 */
export function calculateStandardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;

  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squaredDifferences = values.map((val) => Math.pow(val - mean, 2));
  const variance =
    squaredDifferences.reduce((sum, val) => sum + val, 0) / (values.length - 1);

  return Math.round(Math.sqrt(variance) * 100) / 100;
}

/**
 * Detects performance anomalies using statistical methods
 */
export function detectAnomalies(
  values: number[],
  threshold: number = 2
): {
  anomalies: { index: number; value: number; zScore: number }[];
  mean: number;
  standardDeviation: number;
} {
  if (values.length < 3) {
    return { anomalies: [], mean: 0, standardDeviation: 0 };
  }

  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const standardDeviation = calculateStandardDeviation(values);

  const anomalies = values
    .map((value, index) => {
      const zScore =
        standardDeviation > 0 ? Math.abs(value - mean) / standardDeviation : 0;
      return { index, value, zScore };
    })
    .filter((item) => item.zScore > threshold);

  return { anomalies, mean, standardDeviation };
}

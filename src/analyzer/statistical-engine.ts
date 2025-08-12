import {
  TimeSeriesData,
  TrendAnalysis,
  Anomaly,
  SeasonalPattern,
} from "./results-analyzer";
import {
  PerformanceMetrics,
  ResponseTimeMetrics,
} from "../types/performance-metrics";

export class StatisticalEngine {
  /**
   * Calculate percentiles for a given array of values
   */
  calculatePercentiles(values: number[]): Record<string, number> {
    if (values.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;

    return {
      min: sorted[0],
      max: sorted[n - 1],
      avg: this.calculateMean(values),
      p50: this.getPercentile(sorted, 50),
      p90: this.getPercentile(sorted, 90),
      p95: this.getPercentile(sorted, 95),
      p99: this.getPercentile(sorted, 99),
    };
  }

  /**
   * Calculate response time metrics from raw response time data
   */
  calculateResponseTimeMetrics(responseTimes: number[]): ResponseTimeMetrics {
    const percentiles = this.calculatePercentiles(responseTimes);

    return {
      min: percentiles.min,
      max: percentiles.max,
      avg: percentiles.avg,
      p50: percentiles.p50,
      p90: percentiles.p90,
      p95: percentiles.p95,
      p99: percentiles.p99,
    };
  }

  /**
   * Calculate throughput metrics from request timestamps
   */
  calculateThroughputMetrics(
    requestTimestamps: Date[],
    responseSizes: number[] = []
  ): { requestsPerSecond: number; bytesPerSecond: number } {
    if (requestTimestamps.length === 0) {
      return { requestsPerSecond: 0, bytesPerSecond: 0 };
    }

    const startTime = Math.min(...requestTimestamps.map((t) => t.getTime()));
    const endTime = Math.max(...requestTimestamps.map((t) => t.getTime()));
    const durationSeconds = (endTime - startTime) / 1000;

    if (durationSeconds === 0) {
      return { requestsPerSecond: requestTimestamps.length, bytesPerSecond: 0 };
    }

    const requestsPerSecond = requestTimestamps.length / durationSeconds;
    const totalBytes = responseSizes.reduce((sum, size) => sum + size, 0);
    const bytesPerSecond = totalBytes / durationSeconds;

    return { requestsPerSecond, bytesPerSecond };
  }

  /**
   * Analyze trends in time series data
   */
  calculateTrends(timeSeries: TimeSeriesData[]): TrendAnalysis {
    if (timeSeries.length < 2) {
      return {
        direction: "stable",
        slope: 0,
        confidence: 0,
      };
    }

    const sortedData = timeSeries.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    const { slope, rSquared } = this.calculateLinearRegression(sortedData);

    const direction = this.determineTrendDirection(slope, rSquared);
    const seasonality = this.detectSeasonality(sortedData);

    return {
      direction,
      slope,
      confidence: rSquared,
      seasonality,
    };
  }

  /**
   * Identify anomalies in metric data using statistical methods
   */
  identifyAnomalies(metrics: number[], threshold: number = 2.5): Anomaly[] {
    if (metrics.length < 3) return [];

    const mean = this.calculateMean(metrics);
    const stdDev = this.calculateStandardDeviation(metrics);
    const anomalies: Anomaly[] = [];

    metrics.forEach((value, index) => {
      const zScore = Math.abs((value - mean) / stdDev);

      if (zScore > threshold) {
        const severity = this.determineSeverity(zScore, threshold);

        anomalies.push({
          timestamp: new Date(Date.now() + index * 1000), // Approximate timestamp
          value,
          expectedValue: mean,
          severity,
          description: `Value ${value.toFixed(
            2
          )} deviates significantly from expected ${mean.toFixed(
            2
          )} (z-score: ${zScore.toFixed(2)})`,
        });
      }
    });

    return anomalies;
  }

  /**
   * Calculate correlation coefficient between two metric arrays
   */
  correlateMetrics(metrics1: number[], metrics2: number[]): number {
    if (metrics1.length !== metrics2.length || metrics1.length === 0) {
      return 0;
    }

    const mean1 = this.calculateMean(metrics1);
    const mean2 = this.calculateMean(metrics2);

    let numerator = 0;
    let sumSquares1 = 0;
    let sumSquares2 = 0;

    for (let i = 0; i < metrics1.length; i++) {
      const diff1 = metrics1[i] - mean1;
      const diff2 = metrics2[i] - mean2;

      numerator += diff1 * diff2;
      sumSquares1 += diff1 * diff1;
      sumSquares2 += diff2 * diff2;
    }

    const denominator = Math.sqrt(sumSquares1 * sumSquares2);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Detect performance degradation by comparing current metrics to baseline
   */
  detectPerformanceDegradation(
    currentMetrics: PerformanceMetrics,
    baselineMetrics: PerformanceMetrics,
    thresholds: {
      responseTime: number;
      errorRate: number;
      throughput: number;
    } = {
      responseTime: 0.2, // 20% increase
      errorRate: 0.1, // 10% increase
      throughput: 0.15, // 15% decrease
    }
  ): { isDegraded: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check response time degradation
    const responseTimeDegradation =
      (currentMetrics.responseTime.avg - baselineMetrics.responseTime.avg) /
      baselineMetrics.responseTime.avg;
    if (responseTimeDegradation > thresholds.responseTime) {
      issues.push(
        `Response time increased by ${(responseTimeDegradation * 100).toFixed(
          1
        )}%`
      );
    }

    // Check error rate degradation
    const errorRateDegradation =
      currentMetrics.errorRate - baselineMetrics.errorRate;
    if (errorRateDegradation > thresholds.errorRate) {
      issues.push(
        `Error rate increased by ${(errorRateDegradation * 100).toFixed(
          1
        )} percentage points`
      );
    }

    // Check throughput degradation
    const throughputDegradation =
      (baselineMetrics.throughput.requestsPerSecond -
        currentMetrics.throughput.requestsPerSecond) /
      baselineMetrics.throughput.requestsPerSecond;
    if (throughputDegradation > thresholds.throughput) {
      issues.push(
        `Throughput decreased by ${(throughputDegradation * 100).toFixed(1)}%`
      );
    }

    return {
      isDegraded: issues.length > 0,
      issues,
    };
  }

  // Private helper methods

  private getPercentile(sortedValues: number[], percentile: number): number {
    const index = (percentile / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
      return sortedValues[lower];
    }

    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  private calculateMean(values: number[]): number {
    return values.length === 0
      ? 0
      : values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private calculateStandardDeviation(values: number[]): number {
    const mean = this.calculateMean(values);
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    const variance = this.calculateMean(squaredDiffs);
    return Math.sqrt(variance);
  }

  private calculateLinearRegression(data: TimeSeriesData[]): {
    slope: number;
    rSquared: number;
  } {
    const n = data.length;
    const xValues = data.map((_, i) => i); // Use index as x-value for simplicity
    const yValues = data.map((d) => d.value);

    const sumX = xValues.reduce((sum, x) => sum + x, 0);
    const sumY = yValues.reduce((sum, y) => sum + y, 0);
    const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
    const sumXX = xValues.reduce((sum, x) => sum + x * x, 0);
    const sumYY = yValues.reduce((sum, y) => sum + y * y, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared
    const yMean = sumY / n;
    const totalSumSquares = yValues.reduce(
      (sum, y) => sum + Math.pow(y - yMean, 2),
      0
    );
    const residualSumSquares = yValues.reduce((sum, y, i) => {
      const predicted = slope * xValues[i] + intercept;
      return sum + Math.pow(y - predicted, 2);
    }, 0);

    const rSquared =
      totalSumSquares === 0 ? 1 : 1 - residualSumSquares / totalSumSquares;

    return { slope, rSquared: Math.max(0, Math.min(1, rSquared)) };
  }

  private determineTrendDirection(
    slope: number,
    confidence: number
  ): "increasing" | "decreasing" | "stable" {
    const minConfidence = 0.3; // Minimum confidence threshold

    if (confidence < minConfidence) {
      return "stable";
    }

    const slopeThreshold = 0.01; // Minimum slope to consider significant

    if (Math.abs(slope) < slopeThreshold) {
      return "stable";
    }

    return slope > 0 ? "increasing" : "decreasing";
  }

  private detectSeasonality(
    data: TimeSeriesData[]
  ): SeasonalPattern | undefined {
    // Simple seasonality detection - could be enhanced with FFT or autocorrelation
    if (data.length < 10) return undefined;

    // Look for repeating patterns in the data
    const values = data.map((d) => d.value);
    const mean = this.calculateMean(values);

    // Check for potential periods (2 to data.length/3)
    let bestPeriod = 0;
    let bestCorrelation = 0;

    for (let period = 2; period <= Math.floor(data.length / 3); period++) {
      const correlation = this.calculatePeriodicCorrelation(values, period);
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestPeriod = period;
      }
    }

    if (bestCorrelation > 0.5) {
      // Threshold for significant seasonality
      const amplitude = this.calculateAmplitude(values, bestPeriod);
      return {
        period: bestPeriod,
        amplitude,
        phase: 0, // Simplified - could calculate actual phase
      };
    }

    return undefined;
  }

  private calculatePeriodicCorrelation(
    values: number[],
    period: number
  ): number {
    if (values.length < period * 2) return 0;

    const cycles = Math.floor(values.length / period);
    let totalCorrelation = 0;

    for (let cycle = 1; cycle < cycles; cycle++) {
      const segment1 = values.slice(0, period);
      const segment2 = values.slice(cycle * period, (cycle + 1) * period);

      if (segment2.length === period) {
        totalCorrelation += Math.abs(this.correlateMetrics(segment1, segment2));
      }
    }

    return cycles > 1 ? totalCorrelation / (cycles - 1) : 0;
  }

  private calculateAmplitude(values: number[], period: number): number {
    const mean = this.calculateMean(values);
    let maxDeviation = 0;

    for (let i = 0; i < values.length; i++) {
      maxDeviation = Math.max(maxDeviation, Math.abs(values[i] - mean));
    }

    return maxDeviation;
  }

  private determineSeverity(
    zScore: number,
    threshold: number
  ): "low" | "medium" | "high" {
    if (zScore > threshold * 1.1) return "high";
    if (zScore > threshold * 1.05) return "medium";
    return "low";
  }
}

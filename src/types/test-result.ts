import { LoadTestSpec } from "./load-test-spec";
import { PerformanceMetrics, ErrorSummary } from "./performance-metrics";
import { TestStatus } from "./common";

export interface TestResult {
  id: string;
  spec: LoadTestSpec;
  startTime: Date;
  endTime: Date;
  status: TestStatus;

  metrics: PerformanceMetrics;
  errors: ErrorSummary[];
  recommendations: string[];

  rawData: RawResults;
}

export interface RawResults {
  k6Output: any;
  executionLogs: string[];
  systemMetrics: SystemMetrics[];
}

export interface SystemMetrics {
  timestamp: Date;
  cpuUsage: number;
  memoryUsage: number;
  networkIO: {
    bytesIn: number;
    bytesOut: number;
  };
}

export interface AnalyzedResults {
  testResult: TestResult;
  performanceInsights: PerformanceInsight[];
  bottlenecks: Bottleneck[];
  trends: PerformanceTrend[];
}

export interface PerformanceInsight {
  category: "response_time" | "throughput" | "error_rate" | "resource_usage";
  severity: "info" | "warning" | "critical";
  message: string;
  recommendation: string;
}

export interface Bottleneck {
  component: "network" | "server" | "client" | "database";
  description: string;
  impact: "low" | "medium" | "high";
  suggestedFix: string;
}

export interface PerformanceTrend {
  metric: string;
  direction: "improving" | "degrading" | "stable";
  changePercentage: number;
  timeframe: string;
}

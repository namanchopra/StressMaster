import {
  RawResults,
  AnalyzedResults,
  ExportFormat,
  PerformanceInsight,
  Bottleneck,
  PerformanceTrend,
  TestResult,
  LoadTestSpec,
  PerformanceMetrics,
  TestStatus,
} from "../types";
import { StatisticalEngine } from "./statistical-engine";
import { OllamaClient, OllamaRequest } from "../parser/ollama-client";
import { ParserConfig } from "../parser/command-parser";

export interface ResultsAnalyzer {
  analyzeResults(rawResults: RawResults): Promise<AnalyzedResults>;
  generateRecommendations(results: AnalyzedResults): Promise<string[]>;
  exportReport(results: AnalyzedResults, format: ExportFormat): string;
}

export class AIResultsAnalyzer implements ResultsAnalyzer {
  private statisticalEngine: StatisticalEngine;
  private ollamaClient: OllamaClient;
  private config: AnalyzerConfig;
  private templates: Map<string, AnalysisTemplate>;

  constructor(config: AnalyzerConfig) {
    this.config = config;
    this.statisticalEngine = new StatisticalEngine();

    const parserConfig: ParserConfig = {
      ollamaEndpoint: config.ollamaEndpoint,
      modelName: config.modelName,
      maxRetries: 3,
      timeout: 30000,
    };

    this.ollamaClient = new OllamaClient(parserConfig);
    this.templates = new Map();

    // Initialize default templates
    this.initializeDefaultTemplates();

    // Add custom templates
    config.analysisTemplates.forEach((template) => {
      this.templates.set(template.name, template);
    });
  }

  async analyzeResults(rawResults: RawResults): Promise<AnalyzedResults> {
    // For now, we'll need to construct a TestResult from RawResults
    // In a real implementation, this would be passed in or constructed elsewhere
    const testResult: TestResult = {
      id: `test_${Date.now()}`,
      spec: {} as LoadTestSpec, // This would be provided
      startTime: new Date(),
      endTime: new Date(),
      status: "completed" as TestStatus,
      metrics: {} as PerformanceMetrics, // This would be calculated from rawResults
      errors: [],
      recommendations: [],
      rawData: rawResults,
    };

    // Generate performance insights
    const performanceInsights = this.generatePerformanceInsights(testResult);

    // Identify bottlenecks
    const bottlenecks = this.identifyBottlenecks(testResult);

    // Calculate trends (if historical data is available)
    const trends = this.calculatePerformanceTrends(testResult);

    return {
      testResult,
      performanceInsights,
      bottlenecks,
      trends,
    };
  }

  async generateRecommendations(results: AnalyzedResults): Promise<string[]> {
    const recommendations: string[] = [];

    // Generate rule-based recommendations
    const ruleBasedRecommendations =
      this.generateRuleBasedRecommendations(results);
    recommendations.push(...ruleBasedRecommendations);

    // Generate AI-powered recommendations
    try {
      const aiRecommendations = await this.generateAIRecommendations(results);
      recommendations.push(...aiRecommendations);
    } catch (error) {
      console.warn(
        "Failed to generate AI recommendations, falling back to rule-based only:",
        error
      );
    }

    return recommendations;
  }

  exportReport(results: AnalyzedResults, format: ExportFormat): string {
    const generator = new ReportGeneratorImpl();

    switch (format) {
      case "json":
        return generator.generateJsonReport(results);
      case "csv":
        return generator.generateCsvReport(results);
      case "html":
        return generator.generateHtmlReport(results);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  private initializeDefaultTemplates(): void {
    const defaultTemplates: AnalysisTemplate[] = [
      {
        name: "response_time_analysis",
        description:
          "Analyze response time performance and provide optimization recommendations",
        prompt: `Analyze the following load test results and provide specific recommendations for improving response time performance:

Response Time Metrics:
- Average: {avg_response_time}ms
- 95th Percentile: {p95_response_time}ms
- 99th Percentile: {p99_response_time}ms
- Max: {max_response_time}ms

Error Rate: {error_rate}%
Throughput: {throughput} requests/second

Performance Issues Detected:
{performance_issues}

Bottlenecks Identified:
{bottlenecks}

Please provide 3-5 specific, actionable recommendations to improve response time performance. Focus on practical solutions that can be implemented by developers or operations teams.`,
        applicableMetrics: ["response_time", "error_rate", "throughput"],
      },
      {
        name: "error_analysis",
        description:
          "Analyze error patterns and provide debugging recommendations",
        prompt: `Analyze the following error patterns from a load test and provide debugging recommendations:

Error Summary:
{error_summary}

Error Rate: {error_rate}%
Total Requests: {total_requests}
Failed Requests: {failed_requests}

Common Error Types:
{error_types}

Please provide specific recommendations for:
1. Identifying the root cause of these errors
2. Steps to reproduce and debug the issues
3. Preventive measures to avoid similar errors in the future

Focus on actionable debugging strategies and monitoring improvements.`,
        applicableMetrics: ["error_rate", "error_types"],
      },
      {
        name: "throughput_optimization",
        description:
          "Analyze throughput performance and provide scaling recommendations",
        prompt: `Analyze the following throughput performance data and provide scaling recommendations:

Throughput: {throughput} requests/second
Target Load: {target_load} requests/second
Response Time: {avg_response_time}ms (avg), {p95_response_time}ms (95th percentile)
Error Rate: {error_rate}%

Resource Utilization:
{resource_metrics}

Bottlenecks:
{bottlenecks}

Please provide recommendations for:
1. Optimizing current throughput performance
2. Scaling strategies to handle higher loads
3. Infrastructure improvements
4. Application-level optimizations

Focus on both immediate improvements and long-term scaling strategies.`,
        applicableMetrics: ["throughput", "response_time", "resource_usage"],
      },
      {
        name: "load_pattern_analysis",
        description:
          "Analyze load test patterns and provide testing strategy recommendations",
        prompt: `Analyze the following load test pattern and results, then provide testing strategy recommendations:

Test Type: {test_type}
Load Pattern: {load_pattern}
Duration: {test_duration}
Peak Load: {peak_load} requests/second

Results Summary:
- Success Rate: {success_rate}%
- Average Response Time: {avg_response_time}ms
- Peak Response Time: {max_response_time}ms
- Throughput: {throughput} requests/second

Performance Degradation Points:
{degradation_points}

Please provide recommendations for:
1. Optimizing the current load testing strategy
2. Additional test scenarios to consider
3. Performance benchmarks and SLA recommendations
4. Monitoring and alerting strategies

Focus on comprehensive testing approaches and performance validation strategies.`,
        applicableMetrics: ["load_pattern", "test_duration", "success_rate"],
      },
    ];

    defaultTemplates.forEach((template) => {
      this.templates.set(template.name, template);
    });
  }

  private generatePerformanceInsights(testResult: any): PerformanceInsight[] {
    const insights: PerformanceInsight[] = [];
    const metrics = testResult.metrics;

    // Response time insights
    if (metrics.responseTime.avg > this.config.thresholds.responseTime.poor) {
      insights.push({
        category: "response_time",
        severity: "critical",
        message: `Average response time (${metrics.responseTime.avg}ms) exceeds acceptable threshold (${this.config.thresholds.responseTime.poor}ms)`,
        recommendation:
          "Consider optimizing database queries, implementing caching, or scaling infrastructure",
      });
    } else if (
      metrics.responseTime.avg > this.config.thresholds.responseTime.acceptable
    ) {
      insights.push({
        category: "response_time",
        severity: "warning",
        message: `Average response time (${metrics.responseTime.avg}ms) is above optimal threshold (${this.config.thresholds.responseTime.acceptable}ms)`,
        recommendation:
          "Monitor response time trends and consider performance optimizations",
      });
    }

    // Error rate insights
    if (metrics.errorRate > this.config.thresholds.errorRate.poor) {
      insights.push({
        category: "error_rate",
        severity: "critical",
        message: `Error rate (${(metrics.errorRate * 100).toFixed(
          1
        )}%) is critically high`,
        recommendation:
          "Investigate error logs immediately and implement error handling improvements",
      });
    } else if (
      metrics.errorRate > this.config.thresholds.errorRate.acceptable
    ) {
      insights.push({
        category: "error_rate",
        severity: "warning",
        message: `Error rate (${(metrics.errorRate * 100).toFixed(
          1
        )}%) is above acceptable threshold`,
        recommendation:
          "Review error patterns and implement preventive measures",
      });
    }

    // Throughput insights
    if (
      metrics.throughput.requestsPerSecond <
      this.config.thresholds.throughput.minimum
    ) {
      insights.push({
        category: "throughput",
        severity: "critical",
        message: `Throughput (${metrics.throughput.requestsPerSecond} RPS) is below minimum requirement (${this.config.thresholds.throughput.minimum} RPS)`,
        recommendation:
          "Scale infrastructure or optimize application performance to meet throughput requirements",
      });
    } else if (
      metrics.throughput.requestsPerSecond <
      this.config.thresholds.throughput.target
    ) {
      insights.push({
        category: "throughput",
        severity: "warning",
        message: `Throughput (${metrics.throughput.requestsPerSecond} RPS) is below target (${this.config.thresholds.throughput.target} RPS)`,
        recommendation:
          "Consider performance optimizations to reach target throughput",
      });
    }

    return insights;
  }

  private identifyBottlenecks(testResult: any): Bottleneck[] {
    const bottlenecks: Bottleneck[] = [];
    const metrics = testResult.metrics;

    // High response time with low error rate suggests server-side bottleneck
    if (
      metrics.responseTime.avg >
        this.config.thresholds.responseTime.acceptable &&
      metrics.errorRate < this.config.thresholds.errorRate.acceptable
    ) {
      bottlenecks.push({
        component: "server",
        description:
          "High response times with low error rates indicate server-side processing bottlenecks",
        impact: "high",
        suggestedFix:
          "Profile application code, optimize database queries, or increase server resources",
      });
    }

    // High error rate suggests application or infrastructure issues
    if (metrics.errorRate > this.config.thresholds.errorRate.poor) {
      bottlenecks.push({
        component: "server",
        description:
          "High error rate indicates application stability or infrastructure capacity issues",
        impact: "high",
        suggestedFix:
          "Review error logs, fix application bugs, or scale infrastructure capacity",
      });
    }

    // Low throughput with acceptable response times suggests client-side limitations
    if (
      metrics.throughput.requestsPerSecond <
        this.config.thresholds.throughput.minimum &&
      metrics.responseTime.avg <= this.config.thresholds.responseTime.acceptable
    ) {
      bottlenecks.push({
        component: "client",
        description:
          "Low throughput with good response times may indicate client-side limitations",
        impact: "medium",
        suggestedFix:
          "Increase concurrent connections, optimize client configuration, or review load generation setup",
      });
    }

    // Very high 99th percentile compared to average suggests inconsistent performance
    if (metrics.responseTime.p99 > metrics.responseTime.avg * 3) {
      bottlenecks.push({
        component: "server",
        description:
          "Large gap between average and 99th percentile response times indicates inconsistent performance",
        impact: "medium",
        suggestedFix:
          "Investigate performance outliers, optimize resource allocation, or implement request queuing",
      });
    }

    return bottlenecks;
  }

  private calculatePerformanceTrends(testResult: any): PerformanceTrend[] {
    // For now, return empty array as we don't have historical data
    // In a real implementation, this would compare against previous test results
    return [];
  }

  private generateRuleBasedRecommendations(results: AnalyzedResults): string[] {
    const recommendations: string[] = [];
    const metrics = results.testResult.metrics;

    // Response time recommendations
    if (metrics.responseTime.avg > this.config.thresholds.responseTime.poor) {
      recommendations.push(
        "Critical: Implement response time optimizations - consider database indexing, query optimization, and caching strategies"
      );
    }

    // Error rate recommendations
    if (metrics.errorRate > this.config.thresholds.errorRate.poor) {
      recommendations.push(
        "Critical: Address high error rate - review application logs, implement proper error handling, and ensure adequate infrastructure capacity"
      );
    }

    // Throughput recommendations
    if (
      metrics.throughput.requestsPerSecond <
      this.config.thresholds.throughput.minimum
    ) {
      recommendations.push(
        "Critical: Scale infrastructure to meet minimum throughput requirements - consider horizontal scaling, load balancing, or performance optimizations"
      );
    }

    // Bottleneck-specific recommendations
    results.bottlenecks.forEach((bottleneck) => {
      if (bottleneck.impact === "high") {
        recommendations.push(
          `High Impact: ${bottleneck.description} - ${bottleneck.suggestedFix}`
        );
      }
    });

    return recommendations;
  }

  private async generateAIRecommendations(
    results: AnalyzedResults
  ): Promise<string[]> {
    const recommendations: string[] = [];
    const metrics = results.testResult.metrics;

    // Determine which templates to use based on the results
    const applicableTemplates = this.selectApplicableTemplates(results);

    for (const template of applicableTemplates) {
      try {
        const prompt = this.populateTemplate(template, results);
        const aiResponse = await this.queryOllama(prompt);

        if (aiResponse && aiResponse.trim()) {
          recommendations.push(`AI Analysis (${template.name}): ${aiResponse}`);
        }
      } catch (error) {
        console.warn(
          `Failed to generate AI recommendation for template ${template.name}:`,
          error
        );
      }
    }

    return recommendations;
  }

  private selectApplicableTemplates(
    results: AnalyzedResults
  ): AnalysisTemplate[] {
    const templates: AnalysisTemplate[] = [];
    const metrics = results.testResult.metrics;

    // Always include response time analysis
    const responseTimeTemplate = this.templates.get("response_time_analysis");
    if (responseTimeTemplate) {
      templates.push(responseTimeTemplate);
    }

    // Include error analysis if there are significant errors
    if (metrics.errorRate > this.config.thresholds.errorRate.good) {
      const errorTemplate = this.templates.get("error_analysis");
      if (errorTemplate) {
        templates.push(errorTemplate);
      }
    }

    // Include throughput analysis if throughput is below target
    if (
      metrics.throughput.requestsPerSecond <
      this.config.thresholds.throughput.target
    ) {
      const throughputTemplate = this.templates.get("throughput_optimization");
      if (throughputTemplate) {
        templates.push(throughputTemplate);
      }
    }

    return templates;
  }

  private populateTemplate(
    template: AnalysisTemplate,
    results: AnalyzedResults
  ): string {
    let prompt = template.prompt;
    const metrics = results.testResult.metrics;

    // Replace placeholders with actual values
    const replacements: Record<string, string> = {
      "{avg_response_time}": metrics.responseTime.avg.toString(),
      "{p95_response_time}": metrics.responseTime.p95.toString(),
      "{p99_response_time}": metrics.responseTime.p99.toString(),
      "{max_response_time}": metrics.responseTime.max.toString(),
      "{error_rate}": (metrics.errorRate * 100).toFixed(1),
      "{throughput}": metrics.throughput.requestsPerSecond.toString(),
      "{total_requests}": metrics.totalRequests.toString(),
      "{failed_requests}": metrics.failedRequests.toString(),
      "{success_rate}": (
        (metrics.successfulRequests / metrics.totalRequests) *
        100
      ).toFixed(1),
      "{performance_issues}": results.performanceInsights
        .map((i) => `- ${i.message}`)
        .join("\n"),
      "{bottlenecks}": results.bottlenecks
        .map((b) => `- ${b.description}`)
        .join("\n"),
      "{error_summary}": results.testResult.errors
        .map((e) => `${e.errorType}: ${e.count} occurrences (${e.percentage}%)`)
        .join("\n"),
      "{error_types}": results.testResult.errors
        .map((e) => e.errorType)
        .join(", "),
    };

    // Replace all placeholders
    Object.entries(replacements).forEach(([placeholder, value]) => {
      prompt = prompt.replace(new RegExp(placeholder, "g"), value);
    });

    return prompt;
  }

  private async queryOllama(prompt: string): Promise<string> {
    const request: OllamaRequest = {
      model: this.config.modelName,
      prompt,
      options: {
        temperature: 0.3, // Lower temperature for more focused recommendations
        num_predict: 500, // Limit response length
      },
    };

    const response = await this.ollamaClient.generateCompletion(request);
    return response.response || "";
  }
}

export interface AnalyzerConfig {
  ollamaEndpoint: string;
  modelName: string;
  analysisTemplates: AnalysisTemplate[];
  thresholds: PerformanceThresholds;
}

export interface AnalysisTemplate {
  name: string;
  description: string;
  prompt: string;
  applicableMetrics: string[];
}

export interface PerformanceThresholds {
  responseTime: {
    good: number;
    acceptable: number;
    poor: number;
  };
  errorRate: {
    good: number;
    acceptable: number;
    poor: number;
  };
  throughput: {
    minimum: number;
    target: number;
    excellent: number;
  };
}

export interface ReportGenerator {
  generateJsonReport(results: AnalyzedResults): string;
  generateCsvReport(results: AnalyzedResults): string;
  generateHtmlReport(results: AnalyzedResults): string;
}

export interface StatisticalAnalysis {
  calculatePercentiles(values: number[]): Record<string, number>;
  calculateTrends(timeSeries: TimeSeriesData[]): TrendAnalysis;
  identifyAnomalies(metrics: number[]): Anomaly[];
  correlateMetrics(metrics1: number[], metrics2: number[]): number;
}

export interface TimeSeriesData {
  timestamp: Date;
  value: number;
  metric: string;
}

export interface TrendAnalysis {
  direction: "increasing" | "decreasing" | "stable";
  slope: number;
  confidence: number;
  seasonality?: SeasonalPattern;
}

export interface SeasonalPattern {
  period: number;
  amplitude: number;
  phase: number;
}

export interface Anomaly {
  timestamp: Date;
  value: number;
  expectedValue: number;
  severity: "low" | "medium" | "high";
  description: string;
}

class ReportGeneratorImpl implements ReportGenerator {
  generateJsonReport(results: AnalyzedResults): string {
    return JSON.stringify(results, null, 2);
  }

  generateCsvReport(results: AnalyzedResults): string {
    const metrics = results.testResult.metrics;
    const csvLines: string[] = [];

    // Header
    csvLines.push("Metric,Value,Unit");

    // Basic metrics
    csvLines.push(`Total Requests,${metrics.totalRequests},count`);
    csvLines.push(`Successful Requests,${metrics.successfulRequests},count`);
    csvLines.push(`Failed Requests,${metrics.failedRequests},count`);
    csvLines.push(`Error Rate,${(metrics.errorRate * 100).toFixed(2)},%`);

    // Response time metrics
    csvLines.push(`Average Response Time,${metrics.responseTime.avg},ms`);
    csvLines.push(`Min Response Time,${metrics.responseTime.min},ms`);
    csvLines.push(`Max Response Time,${metrics.responseTime.max},ms`);
    csvLines.push(`50th Percentile,${metrics.responseTime.p50},ms`);
    csvLines.push(`90th Percentile,${metrics.responseTime.p90},ms`);
    csvLines.push(`95th Percentile,${metrics.responseTime.p95},ms`);
    csvLines.push(`99th Percentile,${metrics.responseTime.p99},ms`);

    // Throughput metrics
    csvLines.push(
      `Requests Per Second,${metrics.throughput.requestsPerSecond},rps`
    );
    csvLines.push(`Bytes Per Second,${metrics.throughput.bytesPerSecond},bps`);

    return csvLines.join("\n");
  }

  generateHtmlReport(results: AnalyzedResults): string {
    const metrics = results.testResult.metrics;
    const testResult = results.testResult;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Load Test Report - ${testResult.id}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { border-bottom: 2px solid #007acc; padding-bottom: 20px; margin-bottom: 30px; }
        .header h1 { color: #007acc; margin: 0; }
        .header .meta { color: #666; margin-top: 10px; }
        .section { margin-bottom: 30px; }
        .section h2 { color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .metric-card { background: #f8f9fa; padding: 15px; border-radius: 6px; border-left: 4px solid #007acc; }
        .metric-card h3 { margin: 0 0 10px 0; color: #333; font-size: 14px; text-transform: uppercase; }
        .metric-card .value { font-size: 24px; font-weight: bold; color: #007acc; }
        .metric-card .unit { color: #666; font-size: 14px; }
        .insights { margin-top: 20px; }
        .insight { padding: 10px; margin-bottom: 10px; border-radius: 4px; border-left: 4px solid; }
        .insight.critical { background: #fff5f5; border-color: #e53e3e; }
        .insight.warning { background: #fffbf0; border-color: #dd6b20; }
        .insight.info { background: #f0f8ff; border-color: #3182ce; }
        .bottleneck { background: #f7fafc; padding: 15px; margin-bottom: 10px; border-radius: 6px; border-left: 4px solid #4a5568; }
        .bottleneck h4 { margin: 0 0 5px 0; color: #2d3748; }
        .bottleneck .component { color: #4a5568; font-size: 12px; text-transform: uppercase; font-weight: bold; }
        .bottleneck .impact { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
        .impact.high { background: #fed7d7; color: #c53030; }
        .impact.medium { background: #feebc8; color: #c05621; }
        .impact.low { background: #c6f6d5; color: #2f855a; }
        .recommendations { background: #f0fff4; padding: 20px; border-radius: 6px; border-left: 4px solid #38a169; }
        .recommendations ul { margin: 0; padding-left: 20px; }
        .recommendations li { margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f8f9fa; font-weight: bold; }
        .status-${testResult.status} { 
            display: inline-block; 
            padding: 4px 12px; 
            border-radius: 16px; 
            font-size: 12px; 
            font-weight: bold; 
            text-transform: uppercase;
        }
        .status-completed { background: #c6f6d5; color: #2f855a; }
        .status-failed { background: #fed7d7; color: #c53030; }
        .status-cancelled { background: #e2e8f0; color: #4a5568; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Load Test Report</h1>
            <div class="meta">
                <strong>Test ID:</strong> ${testResult.id}<br>
                <strong>Status:</strong> <span class="status-${
                  testResult.status
                }">${testResult.status}</span><br>
                <strong>Duration:</strong> ${
                  new Date(testResult.endTime).getTime() -
                  new Date(testResult.startTime).getTime()
                }ms<br>
                <strong>Start Time:</strong> ${new Date(
                  testResult.startTime
                ).toLocaleString()}<br>
                <strong>End Time:</strong> ${new Date(
                  testResult.endTime
                ).toLocaleString()}
            </div>
        </div>

        <div class="section">
            <h2>Performance Metrics</h2>
            <div class="metrics-grid">
                <div class="metric-card">
                    <h3>Total Requests</h3>
                    <div class="value">${metrics.totalRequests.toLocaleString()}</div>
                </div>
                <div class="metric-card">
                    <h3>Success Rate</h3>
                    <div class="value">${(
                      (metrics.successfulRequests / metrics.totalRequests) *
                      100
                    ).toFixed(1)}</div>
                    <div class="unit">%</div>
                </div>
                <div class="metric-card">
                    <h3>Error Rate</h3>
                    <div class="value">${(metrics.errorRate * 100).toFixed(
                      2
                    )}</div>
                    <div class="unit">%</div>
                </div>
                <div class="metric-card">
                    <h3>Average Response Time</h3>
                    <div class="value">${metrics.responseTime.avg}</div>
                    <div class="unit">ms</div>
                </div>
                <div class="metric-card">
                    <h3>95th Percentile</h3>
                    <div class="value">${metrics.responseTime.p95}</div>
                    <div class="unit">ms</div>
                </div>
                <div class="metric-card">
                    <h3>Throughput</h3>
                    <div class="value">${metrics.throughput.requestsPerSecond.toFixed(
                      1
                    )}</div>
                    <div class="unit">req/s</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Response Time Metric</th>
                        <th>Value (ms)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Minimum</td><td>${
                      metrics.responseTime.min
                    }</td></tr>
                    <tr><td>Maximum</td><td>${
                      metrics.responseTime.max
                    }</td></tr>
                    <tr><td>Average</td><td>${
                      metrics.responseTime.avg
                    }</td></tr>
                    <tr><td>50th Percentile</td><td>${
                      metrics.responseTime.p50
                    }</td></tr>
                    <tr><td>90th Percentile</td><td>${
                      metrics.responseTime.p90
                    }</td></tr>
                    <tr><td>95th Percentile</td><td>${
                      metrics.responseTime.p95
                    }</td></tr>
                    <tr><td>99th Percentile</td><td>${
                      metrics.responseTime.p99
                    }</td></tr>
                </tbody>
            </table>
        </div>

        ${
          results.performanceInsights.length > 0
            ? `
        <div class="section">
            <h2>Performance Insights</h2>
            <div class="insights">
                ${results.performanceInsights
                  .map(
                    (insight) => `
                    <div class="insight ${insight.severity}">
                        <strong>${insight.category
                          .replace("_", " ")
                          .toUpperCase()}:</strong> ${insight.message}
                        <br><em>Recommendation: ${insight.recommendation}</em>
                    </div>
                `
                  )
                  .join("")}
            </div>
        </div>
        `
            : ""
        }

        ${
          results.bottlenecks.length > 0
            ? `
        <div class="section">
            <h2>Identified Bottlenecks</h2>
            ${results.bottlenecks
              .map(
                (bottleneck) => `
                <div class="bottleneck">
                    <div class="component">${bottleneck.component}</div>
                    <h4>${bottleneck.description}</h4>
                    <div class="impact ${bottleneck.impact}">Impact: ${bottleneck.impact}</div>
                    <p><strong>Suggested Fix:</strong> ${bottleneck.suggestedFix}</p>
                </div>
            `
              )
              .join("")}
        </div>
        `
            : ""
        }

        ${
          testResult.errors.length > 0
            ? `
        <div class="section">
            <h2>Error Summary</h2>
            <table>
                <thead>
                    <tr>
                        <th>Error Type</th>
                        <th>Count</th>
                        <th>Percentage</th>
                        <th>First Occurrence</th>
                        <th>Last Occurrence</th>
                    </tr>
                </thead>
                <tbody>
                    ${testResult.errors
                      .map(
                        (error) => `
                        <tr>
                            <td>${error.errorType}</td>
                            <td>${error.count}</td>
                            <td>${error.percentage.toFixed(2)}%</td>
                            <td>${new Date(
                              error.firstOccurrence
                            ).toLocaleString()}</td>
                            <td>${new Date(
                              error.lastOccurrence
                            ).toLocaleString()}</td>
                        </tr>
                    `
                      )
                      .join("")}
                </tbody>
            </table>
        </div>
        `
            : ""
        }

        ${
          testResult.recommendations.length > 0
            ? `
        <div class="section">
            <h2>Recommendations</h2>
            <div class="recommendations">
                <ul>
                    ${testResult.recommendations
                      .map((rec) => `<li>${rec}</li>`)
                      .join("")}
                </ul>
            </div>
        </div>
        `
            : ""
        }
    </div>
</body>
</html>`;
  }
}

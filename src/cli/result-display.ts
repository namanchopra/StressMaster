import chalk from "chalk";
import Table from "cli-table3";
import {
  TestResult,
  ExportFormat,
  ProgressUpdate,
  ExecutionMetrics,
} from "../types";
import { promises as fs } from "fs";

export class ResultDisplayManager {
  private progressBar: ProgressBar | null = null;

  displayResults(results: TestResult): void {
    this.clearProgress();

    console.log(chalk.green.bold("\n✅ Test Completed Successfully!\n"));

    this.displayTestSummary(results);
    this.displayPerformanceMetrics(results);
    this.displayResponseTimeDistribution(results);
    this.displayThroughputMetrics(results);

    if (results.errors.length > 0) {
      this.displayErrors(results);
    }

    if (results.recommendations.length > 0) {
      this.displayRecommendations(results);
    }
  }

  private displayTestSummary(results: TestResult): void {
    const summaryTable = new Table({
      head: [chalk.blue.bold("Test Summary"), ""],
      colWidths: [25, 50],
      style: { head: [], border: [] },
    });

    summaryTable.push(
      ["Test ID", results.id],
      ["Status", this.formatStatus(results.status)],
      ["Test Type", results.spec.testType || "N/A"],
      ["Start Time", results.startTime.toLocaleString()],
      ["End Time", results.endTime.toLocaleString()],
      ["Duration", this.formatDuration(results.startTime, results.endTime)]
    );

    console.log(summaryTable.toString());
    console.log();
  }

  private displayPerformanceMetrics(results: TestResult): void {
    const metricsTable = new Table({
      head: [chalk.blue.bold("Performance Metrics"), chalk.blue.bold("Value")],
      colWidths: [30, 20],
      style: { head: [], border: [] },
    });

    const successRate =
      results.metrics.successfulRequests / results.metrics.totalRequests;
    const errorRate =
      results.metrics.failedRequests / results.metrics.totalRequests;

    metricsTable.push(
      ["Total Requests", results.metrics.totalRequests.toLocaleString()],
      [
        "Successful Requests",
        chalk.green(results.metrics.successfulRequests.toLocaleString()),
      ],
      [
        "Failed Requests",
        chalk.red(results.metrics.failedRequests.toLocaleString()),
      ],
      ["Success Rate", this.formatPercentage(successRate, successRate >= 0.95)],
      ["Error Rate", this.formatPercentage(errorRate, errorRate <= 0.05)]
    );

    console.log(metricsTable.toString());
    console.log();
  }

  private displayResponseTimeDistribution(results: TestResult): void {
    const responseTable = new Table({
      head: [
        chalk.blue.bold("Response Time Distribution"),
        chalk.blue.bold("Time (ms)"),
      ],
      colWidths: [30, 15],
      style: { head: [], border: [] },
    });

    const rt = results.metrics.responseTime;

    responseTable.push(
      ["Minimum", rt.min.toString()],
      ["Average", rt.avg.toFixed(2)],
      ["50th Percentile (Median)", rt.p50.toString()],
      ["90th Percentile", rt.p90.toString()],
      ["95th Percentile", rt.p95.toString()],
      ["99th Percentile", rt.p99.toString()],
      ["Maximum", rt.max.toString()]
    );

    console.log(responseTable.toString());

    // Add a simple ASCII histogram for response time distribution
    this.displayResponseTimeHistogram(results.metrics.responseTime);
    console.log();
  }

  private displayResponseTimeHistogram(responseTime: any): void {
    const values = [
      { label: "Min", value: responseTime.min },
      { label: "P50", value: responseTime.p50 },
      { label: "P90", value: responseTime.p90 },
      { label: "P95", value: responseTime.p95 },
      { label: "P99", value: responseTime.p99 },
      { label: "Max", value: responseTime.max },
    ];

    const maxValue = Math.max(...values.map((v) => v.value));
    const scale = 40; // Max bar width

    console.log(chalk.blue.bold("\nResponse Time Distribution:"));
    values.forEach(({ label, value }) => {
      const barLength = Math.round((value / maxValue) * scale);
      const bar = "█".repeat(barLength);
      const padding = " ".repeat(Math.max(0, 6 - label.length));
      console.log(`${label}${padding} ${chalk.cyan(bar)} ${value}ms`);
    });
  }

  private displayThroughputMetrics(results: TestResult): void {
    const throughputTable = new Table({
      head: [chalk.blue.bold("Throughput Metrics"), chalk.blue.bold("Value")],
      colWidths: [30, 20],
      style: { head: [], border: [] },
    });

    throughputTable.push(
      [
        "Requests per Second",
        results.metrics.throughput.requestsPerSecond.toFixed(2),
      ],
      [
        "Bytes per Second",
        this.formatBytes(results.metrics.throughput.bytesPerSecond) + "/s",
      ],
      [
        "Total Data Transferred",
        this.formatBytes(
          results.metrics.throughput.bytesPerSecond *
            this.getDurationInSeconds(results.startTime, results.endTime)
        ),
      ]
    );

    console.log(throughputTable.toString());
    console.log();
  }

  private displayErrors(results: TestResult): void {
    console.log(chalk.yellow.bold("⚠️  Error Summary:\n"));

    const errorTable = new Table({
      head: [
        chalk.yellow.bold("Error Type"),
        chalk.yellow.bold("Message"),
        chalk.yellow.bold("Count"),
        chalk.yellow.bold("Rate"),
        chalk.yellow.bold("First Seen"),
      ],
      colWidths: [15, 40, 8, 8, 20],
      style: { head: [], border: [] },
    });

    results.errors.slice(0, 10).forEach((error) => {
      errorTable.push([
        error.errorType,
        error.errorMessage.length > 35
          ? error.errorMessage.substring(0, 35) + "..."
          : error.errorMessage,
        error.count.toString(),
        this.formatPercentage(error.percentage / 100),
        error.firstOccurrence.toLocaleTimeString(),
      ]);
    });

    console.log(errorTable.toString());

    if (results.errors.length > 10) {
      console.log(
        chalk.gray(`... and ${results.errors.length - 10} more error types`)
      );
    }
    console.log();
  }

  private displayRecommendations(results: TestResult): void {
    console.log(chalk.blue.bold("💡 AI Recommendations:\n"));

    results.recommendations.forEach((recommendation, index) => {
      console.log(`${chalk.blue(`${index + 1}.`)} ${recommendation}`);
    });
    console.log();
  }

  showProgress(update: ProgressUpdate): void {
    if (!this.progressBar) {
      this.progressBar = new ProgressBar();
    }
    this.progressBar.update(update);
  }

  showExecutionMetrics(metrics: ExecutionMetrics): void {
    // Clear previous line and show current metrics
    process.stdout.write("\r\x1b[K");

    const status = [
      `VUs: ${chalk.cyan(metrics.currentVUs)}`,
      `RPS: ${chalk.green(metrics.requestsPerSecond.toFixed(1))}`,
      `Total: ${chalk.blue(metrics.requestsCompleted)}`,
      `Avg RT: ${chalk.yellow(metrics.avgResponseTime.toFixed(0))}ms`,
      `Error Rate: ${chalk.red((metrics.errorRate * 100).toFixed(1))}%`,
    ].join(" | ");

    process.stdout.write(`📊 ${status}`);
  }

  clearProgress(): void {
    if (this.progressBar) {
      this.progressBar.clear();
      this.progressBar = null;
    }
    // Clear the execution metrics line
    process.stdout.write("\r\x1b[K");
  }

  async exportResults(
    results: TestResult,
    format: ExportFormat,
    filename?: string
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const defaultFilename = `load-test-${results.id}-${timestamp}.${format}`;
    const outputFile = filename || defaultFilename;

    try {
      let content: string;

      switch (format) {
        case "json":
          content = this.convertToJSON(results);
          break;
        case "csv":
          content = this.convertToCSV(results);
          break;
        case "html":
          content = this.convertToHTML(results);
          break;
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }

      await fs.writeFile(outputFile, content, "utf-8");
      console.log(chalk.green(`✅ Results exported to: ${outputFile}`));
      return outputFile;
    } catch (error) {
      console.error(chalk.red(`❌ Export failed: ${error}`));
      throw error;
    }
  }

  private convertToJSON(results: TestResult): string {
    return JSON.stringify(results, null, 2);
  }

  private convertToCSV(results: TestResult): string {
    const headers = ["Metric Category", "Metric Name", "Value", "Unit"];

    const rows: string[][] = [
      // Test Summary
      ["Summary", "Test ID", results.id, ""],
      ["Summary", "Status", results.status, ""],
      ["Summary", "Start Time", results.startTime.toISOString(), ""],
      ["Summary", "End Time", results.endTime.toISOString(), ""],
      [
        "Summary",
        "Duration",
        this.getDurationInSeconds(
          results.startTime,
          results.endTime
        ).toString(),
        "seconds",
      ],

      // Request Metrics
      [
        "Requests",
        "Total Requests",
        results.metrics.totalRequests.toString(),
        "count",
      ],
      [
        "Requests",
        "Successful Requests",
        results.metrics.successfulRequests.toString(),
        "count",
      ],
      [
        "Requests",
        "Failed Requests",
        results.metrics.failedRequests.toString(),
        "count",
      ],
      [
        "Requests",
        "Success Rate",
        (
          (results.metrics.successfulRequests / results.metrics.totalRequests) *
          100
        ).toFixed(2),
        "percent",
      ],
      [
        "Requests",
        "Error Rate",
        results.metrics.errorRate.toString(),
        "percent",
      ],

      // Response Time Metrics
      [
        "Response Time",
        "Minimum",
        results.metrics.responseTime.min.toString(),
        "ms",
      ],
      [
        "Response Time",
        "Average",
        results.metrics.responseTime.avg.toString(),
        "ms",
      ],
      [
        "Response Time",
        "50th Percentile",
        results.metrics.responseTime.p50.toString(),
        "ms",
      ],
      [
        "Response Time",
        "90th Percentile",
        results.metrics.responseTime.p90.toString(),
        "ms",
      ],
      [
        "Response Time",
        "95th Percentile",
        results.metrics.responseTime.p95.toString(),
        "ms",
      ],
      [
        "Response Time",
        "99th Percentile",
        results.metrics.responseTime.p99.toString(),
        "ms",
      ],
      [
        "Response Time",
        "Maximum",
        results.metrics.responseTime.max.toString(),
        "ms",
      ],

      // Throughput Metrics
      [
        "Throughput",
        "Requests Per Second",
        results.metrics.throughput.requestsPerSecond.toString(),
        "req/s",
      ],
      [
        "Throughput",
        "Bytes Per Second",
        results.metrics.throughput.bytesPerSecond.toString(),
        "bytes/s",
      ],
    ];

    // Add error data
    results.errors.forEach((error) => {
      rows.push(["Errors", error.errorType, error.count.toString(), "count"]);
    });

    // Add recommendations
    results.recommendations.forEach((rec, index) => {
      rows.push(["Recommendations", `Recommendation ${index + 1}`, rec, ""]);
    });

    return [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
  }

  private convertToHTML(results: TestResult): string {
    const successRate =
      results.metrics.successfulRequests / results.metrics.totalRequests;
    const duration = this.getDurationInSeconds(
      results.startTime,
      results.endTime
    );

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Load Test Results - ${results.id}</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background-color: #f5f5f5; 
        }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 15px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 2.5em; }
        .header .subtitle { color: #7f8c8d; margin-top: 5px; }
        .section { margin: 30px 0; }
        .section h2 { color: #34495e; border-left: 4px solid #3498db; padding-left: 15px; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .metric-card { background: #f8f9fa; padding: 20px; border-radius: 6px; border-left: 4px solid #3498db; }
        .metric-value { font-size: 2em; font-weight: bold; color: #2c3e50; }
        .metric-label { color: #7f8c8d; font-size: 0.9em; margin-top: 5px; }
        .success { color: #27ae60; }
        .error { color: #e74c3c; }
        .warning { color: #f39c12; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #34495e; color: white; font-weight: 600; }
        tr:nth-child(even) { background-color: #f8f9fa; }
        .status-badge { padding: 4px 12px; border-radius: 20px; font-size: 0.8em; font-weight: bold; }
        .status-completed { background-color: #d4edda; color: #155724; }
        .status-failed { background-color: #f8d7da; color: #721c24; }
        .recommendations { background: #e8f4fd; padding: 20px; border-radius: 6px; border-left: 4px solid #3498db; }
        .recommendations ul { margin: 0; padding-left: 20px; }
        .recommendations li { margin: 10px 0; }
        .chart-container { margin: 20px 0; }
        .response-time-bar { background: linear-gradient(90deg, #3498db, #2980b9); height: 20px; border-radius: 10px; margin: 5px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Load Test Results</h1>
            <div class="subtitle">
                Test ID: ${results.id} | 
                <span class="status-badge status-${
                  results.status
                }">${results.status.toUpperCase()}</span> | 
                Completed: ${results.endTime.toLocaleString()}
            </div>
        </div>
        
        <div class="section">
            <h2>📊 Performance Overview</h2>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-value">${results.metrics.totalRequests.toLocaleString()}</div>
                    <div class="metric-label">Total Requests</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value success">${this.formatPercentage(
                      successRate
                    )}</div>
                    <div class="metric-label">Success Rate</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${results.metrics.responseTime.avg.toFixed(
                      2
                    )}ms</div>
                    <div class="metric-label">Average Response Time</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${results.metrics.throughput.requestsPerSecond.toFixed(
                      2
                    )}</div>
                    <div class="metric-label">Requests per Second</div>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>⏱️ Response Time Distribution</h2>
            <table>
                <tr><th>Percentile</th><th>Response Time (ms)</th></tr>
                <tr><td>Minimum</td><td>${
                  results.metrics.responseTime.min
                }</td></tr>
                <tr><td>50th (Median)</td><td>${
                  results.metrics.responseTime.p50
                }</td></tr>
                <tr><td>90th</td><td>${
                  results.metrics.responseTime.p90
                }</td></tr>
                <tr><td>95th</td><td>${
                  results.metrics.responseTime.p95
                }</td></tr>
                <tr><td>99th</td><td>${
                  results.metrics.responseTime.p99
                }</td></tr>
                <tr><td>Maximum</td><td>${
                  results.metrics.responseTime.max
                }</td></tr>
            </table>
        </div>

        <div class="section">
            <h2>🚀 Throughput Metrics</h2>
            <table>
                <tr><th>Metric</th><th>Value</th></tr>
                <tr><td>Requests per Second</td><td>${results.metrics.throughput.requestsPerSecond.toFixed(
                  2
                )}</td></tr>
                <tr><td>Bytes per Second</td><td>${this.formatBytes(
                  results.metrics.throughput.bytesPerSecond
                )}/s</td></tr>
                <tr><td>Total Data Transferred</td><td>${this.formatBytes(
                  results.metrics.throughput.bytesPerSecond * duration
                )}</td></tr>
                <tr><td>Test Duration</td><td>${duration} seconds</td></tr>
            </table>
        </div>

        ${
          results.errors.length > 0
            ? `
        <div class="section">
            <h2>⚠️ Error Summary</h2>
            <table>
                <tr><th>Error Type</th><th>Message</th><th>Count</th><th>Rate</th><th>First Seen</th></tr>
                ${results.errors
                  .map(
                    (error) => `
                <tr>
                    <td>${error.errorType}</td>
                    <td>${error.errorMessage}</td>
                    <td>${error.count}</td>
                    <td>${this.formatPercentage(error.percentage / 100)}</td>
                    <td>${error.firstOccurrence.toLocaleString()}</td>
                </tr>
                `
                  )
                  .join("")}
            </table>
        </div>
        `
            : ""
        }

        ${
          results.recommendations.length > 0
            ? `
        <div class="section">
            <h2>💡 AI Recommendations</h2>
            <div class="recommendations">
                <ul>
                    ${results.recommendations
                      .map((rec) => `<li>${rec}</li>`)
                      .join("")}
                </ul>
            </div>
        </div>
        `
            : ""
        }

        <div class="section">
            <h2>📋 Test Configuration</h2>
            <table>
                <tr><th>Parameter</th><th>Value</th></tr>
                <tr><td>Test Type</td><td>${
                  results.spec.testType || "N/A"
                }</td></tr>
                <tr><td>Start Time</td><td>${results.startTime.toLocaleString()}</td></tr>
                <tr><td>End Time</td><td>${results.endTime.toLocaleString()}</td></tr>
                <tr><td>Duration</td><td>${duration} seconds</td></tr>
            </table>
        </div>
    </div>
</body>
</html>`;
  }

  private formatStatus(status: string): string {
    switch (status) {
      case "completed":
        return chalk.green("✅ Completed");
      case "failed":
        return chalk.red("❌ Failed");
      case "cancelled":
        return chalk.yellow("⏹️  Cancelled");
      default:
        return status;
    }
  }

  private formatDuration(start: Date, end: Date): string {
    const duration = end.getTime() - start.getTime();
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  private getDurationInSeconds(start: Date, end: Date): number {
    return Math.floor((end.getTime() - start.getTime()) / 1000);
  }

  private formatPercentage(value: number, isGood?: boolean): string {
    const percentage = `${(value * 100).toFixed(2)}%`;
    if (isGood === undefined) return percentage;
    return isGood ? chalk.green(percentage) : chalk.red(percentage);
  }

  private formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}

class ProgressBar {
  private lastUpdate: ProgressUpdate | null = null;

  update(progress: ProgressUpdate): void {
    this.lastUpdate = progress;
    this.render();
  }

  private render(): void {
    if (!this.lastUpdate) return;

    const { progress, currentPhase, message } = this.lastUpdate;
    const barWidth = 40;
    const filledWidth = Math.round((progress / 100) * barWidth);
    const emptyWidth = barWidth - filledWidth;

    const progressBar =
      chalk.green("█".repeat(filledWidth)) + chalk.gray("░".repeat(emptyWidth));
    const percentage = `${progress.toFixed(1)}%`.padStart(6);

    // Clear the line and write the progress bar
    process.stdout.write("\r\x1b[K");
    process.stdout.write(
      `🔄 ${currentPhase}: [${progressBar}] ${percentage} - ${message}`
    );
  }

  clear(): void {
    process.stdout.write("\r\x1b[K");
  }
}

/**
 * Diagnostic tools for Smart AI Parser debugging
 */

import {
  ParsingMetricsCollector,
  ParseAttempt,
  DiagnosticInfo,
} from "./parsing-metrics";
import { SmartParserConfig } from "./smart-parser-config";

export interface DiagnosticReport {
  summary: {
    totalAttempts: number;
    successRate: number;
    averageResponseTime: number;
    mostCommonErrors: Array<{
      type: string;
      count: number;
      percentage: number;
    }>;
    performanceByStage: Array<{
      stage: string;
      averageDuration: number;
      successRate: number;
    }>;
  };
  recommendations: string[];
  configSuggestions: Partial<SmartParserConfig>;
  detailedAnalysis: {
    slowestAttempts: ParseAttempt[];
    failedAttempts: ParseAttempt[];
    fallbackUsage: {
      frequency: number;
      successRate: number;
      commonTriggers: string[];
    };
  };
}

export interface DebugSession {
  id: string;
  startTime: number;
  endTime?: number;
  parseAttempts: string[];
  notes: string[];
  tags: string[];
}

/**
 * Diagnostic analyzer for parsing operations
 */
export class ParsingDiagnosticAnalyzer {
  private metricsCollector: ParsingMetricsCollector;
  private debugSessions: Map<string, DebugSession> = new Map();

  constructor(metricsCollector: ParsingMetricsCollector) {
    this.metricsCollector = metricsCollector;
  }

  /**
   * Generate comprehensive diagnostic report
   */
  generateReport(
    fromTimestamp?: number,
    toTimestamp?: number
  ): DiagnosticReport {
    const attempts = this.metricsCollector.getParseAttempts(
      fromTimestamp,
      toTimestamp
    );
    const metrics = this.metricsCollector.getAggregatedMetrics(
      fromTimestamp || 0,
      toTimestamp || Date.now()
    );

    return {
      summary: this.generateSummary(attempts, metrics),
      recommendations: this.generateRecommendations(attempts, metrics),
      configSuggestions: this.generateConfigSuggestions(attempts, metrics),
      detailedAnalysis: this.generateDetailedAnalysis(attempts),
    };
  }

  /**
   * Analyze specific parsing attempt
   */
  analyzeParseAttempt(parseAttemptId: string): {
    attempt: ParseAttempt | null;
    diagnostics: DiagnosticInfo[];
    timeline: Array<{ stage: string; duration: number; success: boolean }>;
    issues: string[];
    suggestions: string[];
  } {
    const attempts = this.metricsCollector.getParseAttempts();
    const attempt = attempts.find((a) => a.id === parseAttemptId) || null;
    const diagnostics = this.metricsCollector.getDiagnostics(parseAttemptId);

    const timeline = diagnostics.map((d) => ({
      stage: d.stage,
      duration: d.duration,
      success: d.success,
    }));

    const issues = this.identifyIssues(attempt, diagnostics);
    const suggestions = this.generateSuggestions(attempt, diagnostics);

    return {
      attempt,
      diagnostics,
      timeline,
      issues,
      suggestions,
    };
  }

  /**
   * Start a debug session
   */
  startDebugSession(tags: string[] = []): string {
    const sessionId = `debug_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 11)}`;

    this.debugSessions.set(sessionId, {
      id: sessionId,
      startTime: Date.now(),
      parseAttempts: [],
      notes: [],
      tags,
    });

    return sessionId;
  }

  /**
   * End a debug session
   */
  endDebugSession(sessionId: string): DebugSession | null {
    const session = this.debugSessions.get(sessionId);
    if (!session) {
      return null;
    }

    session.endTime = Date.now();
    return session;
  }

  /**
   * Add parse attempt to debug session
   */
  addToDebugSession(sessionId: string, parseAttemptId: string): void {
    const session = this.debugSessions.get(sessionId);
    if (session) {
      session.parseAttempts.push(parseAttemptId);
    }
  }

  /**
   * Add note to debug session
   */
  addDebugNote(sessionId: string, note: string): void {
    const session = this.debugSessions.get(sessionId);
    if (session) {
      session.notes.push(`${new Date().toISOString()}: ${note}`);
    }
  }

  /**
   * Get debug session report
   */
  getDebugSessionReport(sessionId: string): {
    session: DebugSession | null;
    attempts: ParseAttempt[];
    summary: any;
  } {
    const session = this.debugSessions.get(sessionId) || null;
    if (!session) {
      return { session: null, attempts: [], summary: null };
    }

    const attempts = this.metricsCollector
      .getParseAttempts()
      .filter((a) => session.parseAttempts.includes(a.id));

    const summary = {
      duration: (session.endTime || Date.now()) - session.startTime,
      totalAttempts: attempts.length,
      successRate:
        attempts.length > 0
          ? attempts.filter((a) => a.success).length / attempts.length
          : 0,
      averageResponseTime:
        attempts.length > 0
          ? attempts.reduce((sum, a) => sum + a.responseTimeMs, 0) /
            attempts.length
          : 0,
    };

    return { session, attempts, summary };
  }

  /**
   * Export diagnostic data
   */
  exportDiagnosticData(): {
    report: DiagnosticReport;
    rawData: any;
    debugSessions: DebugSession[];
  } {
    return {
      report: this.generateReport(),
      rawData: this.metricsCollector.exportData(),
      debugSessions: Array.from(this.debugSessions.values()),
    };
  }

  private generateSummary(attempts: ParseAttempt[], metrics: any) {
    const diagnostics = attempts.flatMap((a) =>
      this.metricsCollector.getDiagnostics(a.id)
    );

    const errorCounts = Object.entries(metrics.errorsByType)
      .map(([type, count]) => ({
        type,
        count: count as number,
        percentage: ((count as number) / attempts.length) * 100,
      }))
      .sort((a, b) => b.count - a.count);

    const stagePerformance = this.calculateStagePerformance(diagnostics);

    return {
      totalAttempts: attempts.length,
      successRate: metrics.formatDetectionAccuracy,
      averageResponseTime: metrics.averageResponseTime,
      mostCommonErrors: errorCounts.slice(0, 5),
      performanceByStage: stagePerformance,
    };
  }

  private generateRecommendations(
    attempts: ParseAttempt[],
    metrics: any
  ): string[] {
    const recommendations: string[] = [];

    // Only generate recommendations if we have data
    if (attempts.length === 0) {
      return recommendations;
    }

    if (metrics.formatDetectionAccuracy < 0.8) {
      recommendations.push(
        "Consider improving format detection patterns or lowering confidence threshold"
      );
    }

    if (metrics.averageResponseTime > 1500) {
      recommendations.push(
        "Response times are high - consider optimizing AI provider settings or input preprocessing"
      );
    }

    if (
      metrics.totalRequests > 0 &&
      metrics.fallbackUsed / metrics.totalRequests > 0.3
    ) {
      recommendations.push(
        "High fallback usage detected - review AI provider configuration and prompts"
      );
    }

    const retryRate =
      metrics.totalRequests > 0
        ? metrics.retryCount / metrics.totalRequests
        : 0;
    if (retryRate > 0.5) {
      recommendations.push(
        "High retry rate - consider adjusting retry logic or improving input validation"
      );
    }

    return recommendations;
  }

  private generateConfigSuggestions(
    attempts: ParseAttempt[],
    metrics: any
  ): Partial<SmartParserConfig> {
    const suggestions: Partial<SmartParserConfig> = {};

    // Suggest timeout increase if response times are high or timeout errors occur
    const hasTimeoutErrors =
      metrics.errorsByType && metrics.errorsByType.timeout > 0;
    if (metrics.averageResponseTime > 3000 || hasTimeoutErrors) {
      suggestions.aiProvider = {
        timeoutMs: Math.max(5000, metrics.averageResponseTime * 1.5),
        maxRetries: 3,
        temperature: 0.1,
        enableValidationRetries: true,
      };
    }

    if (metrics.formatDetectionAccuracy < 0.7) {
      suggestions.formatDetection = {
        confidenceThreshold: Math.max(0.5, metrics.averageConfidence - 0.1),
        enableMultiFormatDetection: true,
        enablePatternMatching: true,
      };
    }

    return suggestions;
  }

  private generateDetailedAnalysis(attempts: ParseAttempt[]) {
    if (attempts.length === 0) {
      return {
        slowestAttempts: [],
        failedAttempts: [],
        fallbackUsage: {
          frequency: 0,
          successRate: 0,
          commonTriggers: [],
        },
      };
    }
    const slowestAttempts = attempts
      .sort((a, b) => b.responseTimeMs - a.responseTimeMs)
      .slice(0, 10);

    const failedAttempts = attempts.filter((a) => !a.success).slice(0, 10);

    const fallbackAttempts = attempts.filter((a) => a.usedFallback);
    const fallbackSuccessRate =
      fallbackAttempts.length > 0
        ? fallbackAttempts.filter((a) => a.success).length /
          fallbackAttempts.length
        : 0;

    const commonTriggers = failedAttempts
      .map((a) => a.errorType)
      .filter(Boolean)
      .reduce((acc: Record<string, number>, type) => {
        acc[type!] = (acc[type!] || 0) + 1;
        return acc;
      }, {});

    return {
      slowestAttempts,
      failedAttempts,
      fallbackUsage: {
        frequency: fallbackAttempts.length / attempts.length,
        successRate: fallbackSuccessRate,
        commonTriggers: Object.keys(commonTriggers).slice(0, 5),
      },
    };
  }

  private calculateStagePerformance(diagnostics: DiagnosticInfo[]) {
    const stageStats: Record<
      string,
      { durations: number[]; successes: number; total: number }
    > = {};

    diagnostics.forEach((d) => {
      if (!stageStats[d.stage]) {
        stageStats[d.stage] = { durations: [], successes: 0, total: 0 };
      }

      stageStats[d.stage].durations.push(d.duration);
      stageStats[d.stage].total++;
      if (d.success) {
        stageStats[d.stage].successes++;
      }
    });

    return Object.entries(stageStats).map(([stage, stats]) => ({
      stage,
      averageDuration:
        stats.durations.reduce((sum, d) => sum + d, 0) / stats.durations.length,
      successRate: stats.successes / stats.total,
    }));
  }

  private identifyIssues(
    attempt: ParseAttempt | null,
    diagnostics: DiagnosticInfo[]
  ): string[] {
    const issues: string[] = [];

    if (!attempt) {
      issues.push("Parse attempt not found");
      return issues;
    }

    if (!attempt.success) {
      issues.push(`Parsing failed: ${attempt.errorMessage || "Unknown error"}`);
    }

    if (attempt.responseTimeMs > 10000) {
      issues.push("Response time exceeded 10 seconds");
    }

    if (attempt.confidence < 0.5) {
      issues.push("Low confidence score in parsing result");
    }

    if (attempt.retryCount > 2) {
      issues.push("High number of retries required");
    }

    const failedStages = diagnostics.filter((d) => !d.success);
    if (failedStages.length > 0) {
      issues.push(
        `Failed stages: ${failedStages.map((d) => d.stage).join(", ")}`
      );
    }

    return issues;
  }

  private generateSuggestions(
    attempt: ParseAttempt | null,
    diagnostics: DiagnosticInfo[]
  ): string[] {
    const suggestions: string[] = [];

    if (!attempt) {
      return suggestions;
    }

    if (attempt.inputLength > 5000) {
      suggestions.push(
        "Consider breaking down large inputs into smaller chunks"
      );
    }

    if (attempt.assumptions > 3) {
      suggestions.push(
        "High number of assumptions made - provide more explicit input"
      );
    }

    if (attempt.warnings > 2) {
      suggestions.push(
        "Multiple warnings generated - review input format and completeness"
      );
    }

    const slowStages = diagnostics.filter((d) => d.duration > 2000);
    if (slowStages.length > 0) {
      suggestions.push(
        `Optimize slow stages: ${slowStages.map((d) => d.stage).join(", ")}`
      );
    }

    return suggestions;
  }
}

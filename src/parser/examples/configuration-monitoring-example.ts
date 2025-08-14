/**
 * Example demonstrating Smart AI Parser configuration and monitoring capabilities
 */

import {
  SmartParserConfigManager,
  ParsingMetricsCollector,
  ParsingPerformanceMonitor,
  ParsingDiagnosticAnalyzer,
  ParseAttempt,
} from "../index";

// Example: Setting up configuration and monitoring
export function setupSmartParserWithMonitoring() {
  // 1. Configure the parser
  const configManager = new SmartParserConfigManager({
    preprocessing: {
      enableSanitization: true,
      enableStructureExtraction: true,
      maxInputLength: 8000,
      normalizeWhitespace: true,
      separateRequests: true,
    },
    formatDetection: {
      confidenceThreshold: 0.8,
      enableMultiFormatDetection: true,
      enablePatternMatching: true,
    },
    aiProvider: {
      maxRetries: 2,
      temperature: 0.1,
      enableValidationRetries: true,
      timeoutMs: 10000,
    },
    monitoring: {
      enableMetrics: true,
      enableDiagnostics: true,
      logLevel: "info",
      metricsRetentionMs: 24 * 60 * 60 * 1000,
    },
  });

  // 2. Set up monitoring
  const metricsCollector = new ParsingMetricsCollector(24 * 60 * 60 * 1000); // 24 hour retention
  const performanceMonitor = new ParsingPerformanceMonitor(metricsCollector);
  const diagnosticAnalyzer = new ParsingDiagnosticAnalyzer(metricsCollector);

  return {
    configManager,
    metricsCollector,
    performanceMonitor,
    diagnosticAnalyzer,
  };
}

// Example: Monitoring a parsing operation
export async function monitorParsingOperation(
  performanceMonitor: ParsingPerformanceMonitor,
  metricsCollector: ParsingMetricsCollector,
  parseAttemptId: string,
  input: string
) {
  const startTime = Date.now();

  try {
    // Stage 1: Preprocessing
    performanceMonitor.startStage(parseAttemptId, "preprocessing");
    await simulateProcessing(50); // Simulate preprocessing time
    performanceMonitor.endStage(parseAttemptId, "preprocessing", true, {
      inputLength: input.length,
      sanitized: true,
    });

    // Stage 2: Format Detection
    performanceMonitor.startStage(parseAttemptId, "format_detection");
    await simulateProcessing(30);
    performanceMonitor.endStage(parseAttemptId, "format_detection", true, {
      detectedFormat: "json",
      confidence: 0.9,
    });

    // Stage 3: AI Parsing
    performanceMonitor.startStage(parseAttemptId, "ai_parsing");
    await simulateProcessing(1500); // Simulate AI processing time
    performanceMonitor.endStage(parseAttemptId, "ai_parsing", true, {
      tokens: 250,
      temperature: 0.1,
    });

    // Record successful attempt
    const attempt: ParseAttempt = {
      id: parseAttemptId,
      timestamp: Date.now(),
      inputLength: input.length,
      detectedFormat: "json",
      confidence: 0.9,
      responseTimeMs: Date.now() - startTime,
      success: true,
      usedFallback: false,
      retryCount: 0,
      assumptions: 1,
      warnings: 0,
    };

    metricsCollector.recordParseAttempt(attempt);
    return attempt;
  } catch (error) {
    // Record failed attempt
    const attempt: ParseAttempt = {
      id: parseAttemptId,
      timestamp: Date.now(),
      inputLength: input.length,
      detectedFormat: "unknown",
      confidence: 0.2,
      responseTimeMs: Date.now() - startTime,
      success: false,
      errorType: "processing_error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      usedFallback: false,
      retryCount: 0,
      assumptions: 0,
      warnings: 2,
    };

    metricsCollector.recordParseAttempt(attempt);
    throw error;
  }
}

// Example: Analyzing performance and generating reports
export function analyzePerformance(
  diagnosticAnalyzer: ParsingDiagnosticAnalyzer,
  configManager: SmartParserConfigManager
) {
  // Generate comprehensive diagnostic report
  const report = diagnosticAnalyzer.generateReport();

  console.log("=== Parsing Performance Report ===");
  console.log(`Total Requests: ${report.summary.totalAttempts}`);
  console.log(
    `Success Rate: ${(report.summary.successRate * 100).toFixed(1)}%`
  );
  console.log(
    `Average Response Time: ${report.summary.averageResponseTime.toFixed(0)}ms`
  );

  if (report.summary.mostCommonErrors.length > 0) {
    console.log("\nMost Common Errors:");
    report.summary.mostCommonErrors.forEach((error) => {
      console.log(
        `  - ${error.type}: ${error.count} (${error.percentage.toFixed(1)}%)`
      );
    });
  }

  if (report.recommendations.length > 0) {
    console.log("\nRecommendations:");
    report.recommendations.forEach((rec) => {
      console.log(`  - ${rec}`);
    });
  }

  // Apply configuration suggestions
  if (Object.keys(report.configSuggestions).length > 0) {
    console.log("\nApplying configuration suggestions...");
    configManager.updateConfig(report.configSuggestions);
    console.log("Configuration updated based on performance data");
  }

  return report;
}

// Example: Debug session workflow
export function runDebugSession(
  diagnosticAnalyzer: ParsingDiagnosticAnalyzer,
  parseAttemptIds: string[]
) {
  // Start debug session
  const sessionId = diagnosticAnalyzer.startDebugSession([
    "performance",
    "debugging",
  ]);
  console.log(`Started debug session: ${sessionId}`);

  // Add parse attempts to session
  parseAttemptIds.forEach((id) => {
    diagnosticAnalyzer.addToDebugSession(sessionId, id);
  });

  // Add notes
  diagnosticAnalyzer.addDebugNote(
    sessionId,
    "Testing new input format handling"
  );
  diagnosticAnalyzer.addDebugNote(
    sessionId,
    "Investigating slow response times"
  );

  // End session and get report
  diagnosticAnalyzer.endDebugSession(sessionId);
  const debugReport = diagnosticAnalyzer.getDebugSessionReport(sessionId);

  console.log("\n=== Debug Session Report ===");
  console.log(`Session Duration: ${debugReport.summary?.duration}ms`);
  console.log(`Attempts Analyzed: ${debugReport.summary?.totalAttempts}`);
  console.log(
    `Success Rate: ${((debugReport.summary?.successRate || 0) * 100).toFixed(
      1
    )}%`
  );

  return debugReport;
}

// Example: Configuration validation
export function validateConfiguration(configManager: SmartParserConfigManager) {
  const config = configManager.getConfig();
  const errors = configManager.validateConfig(config);

  if (errors.length > 0) {
    console.log("Configuration validation errors:");
    errors.forEach((error) => {
      console.log(`  - ${error}`);
    });
    return false;
  }

  console.log("Configuration is valid");
  return true;
}

// Helper function to simulate processing time
async function simulateProcessing(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Example usage
export async function runExample() {
  console.log("=== Smart AI Parser Configuration and Monitoring Example ===\n");

  // Setup
  const {
    configManager,
    metricsCollector,
    performanceMonitor,
    diagnosticAnalyzer,
  } = setupSmartParserWithMonitoring();

  // Validate configuration
  validateConfiguration(configManager);

  // Simulate some parsing operations
  const parseAttemptIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const attemptId = `example-${i + 1}`;
    parseAttemptIds.push(attemptId);

    try {
      await monitorParsingOperation(
        performanceMonitor,
        metricsCollector,
        attemptId,
        `{"method": "GET", "url": "https://api.example.com/test-${i}"}`
      );
      console.log(`✓ Parse attempt ${attemptId} completed successfully`);
    } catch (error) {
      console.log(`✗ Parse attempt ${attemptId} failed: ${error}`);
    }
  }

  // Analyze performance
  console.log("\n");
  analyzePerformance(diagnosticAnalyzer, configManager);

  // Run debug session
  console.log("\n");
  runDebugSession(diagnosticAnalyzer, parseAttemptIds);

  // Export data
  const exportData = diagnosticAnalyzer.exportDiagnosticData();
  console.log("\n=== Export Summary ===");
  console.log(
    `Total metrics exported: ${exportData.rawData.attempts.length} attempts`
  );
  console.log(`Debug sessions: ${exportData.debugSessions.length}`);
}

// Uncomment to run the example
// runExample().catch(console.error);

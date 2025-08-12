import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LoadTestWorkflowOrchestrator } from "../../orchestrator/load-test-orchestrator";
import { AICommandParser } from "../../parser/command-parser";
import { K6ScriptGenerator } from "../../generator/script-generator";
import { K6ScriptExecutor } from "../../executor/script-executor";
import { AIResultsAnalyzer } from "../../analyzer/results-analyzer";
import { LoadTestSpec, K6Script, RawResults } from "../../types";
import { BehaviorSubject } from "rxjs";

describe("Workflow Integration Tests", () => {
  let orchestrator: LoadTestWorkflowOrchestrator;
  let parser: AICommandParser;
  let generator: K6ScriptGenerator;
  let executor: K6ScriptExecutor;
  let analyzer: AIResultsAnalyzer;

  const mockNaturalLanguageCommand =
    "Send 100 POST requests to https://api.example.com/users with random user data at 10 RPS for 30 seconds";

  const expectedLoadTestSpec: LoadTestSpec = {
    id: "integration-test-1",
    name: "User API Load Test",
    description: "Load test for user creation endpoint",
    testType: "baseline",
    requests: [
      {
        method: "POST",
        url: "https://api.example.com/users",
        headers: { "Content-Type": "application/json" },
        payload: {
          template:
            '{"name": "{{randomName}}", "email": "{{randomEmail}}", "id": "{{randomId}}"}',
          variables: [
            {
              name: "randomName",
              type: "random_string",
              parameters: { length: 10 },
            },
            {
              name: "randomEmail",
              type: "random_string",
              parameters: { format: "email" },
            },
            { name: "randomId", type: "uuid" },
          ],
        },
      },
    ],
    loadPattern: {
      type: "constant",
      requestsPerSecond: 10,
      virtualUsers: 10,
    },
    duration: { value: 30, unit: "seconds" },
  };

  beforeEach(() => {
    // Create real instances for integration testing
    parser = new AICommandParser({
      ollamaUrl: "http://localhost:11434",
      model: "llama3",
      timeout: 30000,
      maxRetries: 3,
    });

    generator = new K6ScriptGenerator({
      templateDirectory: "./templates",
      outputDirectory: "./generated-scripts",
      validateScripts: true,
    });

    executor = new K6ScriptExecutor({
      k6BinaryPath: "k6",
      containerImage: "grafana/k6:latest",
      resourceLimits: {
        maxMemory: "512m",
        maxCpu: "1.0",
        maxDuration: "300s",
        maxVirtualUsers: 100,
      },
      outputFormats: ["json"],
      tempDirectory: "./test-results",
    });

    analyzer = new AIResultsAnalyzer({
      enableAIRecommendations: true,
      ollamaUrl: "http://localhost:11434",
      model: "llama3",
    });

    orchestrator = new LoadTestWorkflowOrchestrator(
      {
        maxConcurrentTests: 2,
        defaultTimeout: 60000,
        retryAttempts: 3,
        historyLimit: 100,
        stepTimeout: 30000,
        enableWorkflowRecovery: true,
      },
      parser,
      generator,
      executor,
      analyzer
    );
  });

  afterEach(() => {
    // Cleanup any running tests
    vi.clearAllMocks();
  });

  describe("Complete Command-to-Result Workflow", () => {
    it("should parse natural language command and execute complete workflow", async () => {
      // Mock the parser to return a valid spec
      vi.spyOn(parser, "parseCommand").mockResolvedValue(expectedLoadTestSpec);
      vi.spyOn(parser, "validateSpec").mockReturnValue({
        isValid: true,
        errors: [],
      });

      // Mock script generation
      const mockScript: K6Script = {
        id: "generated-script-1",
        name: "User API Load Test Script",
        content: "export default function() { /* test */ }",
        imports: ["http", "check"],
        options: { vus: 10, duration: "30s", rps: 10 },
        metadata: {
          generatedAt: new Date(),
          specId: expectedLoadTestSpec.id,
          version: "1.0.0",
          description: "Generated load test script",
          tags: ["integration-test"],
        },
      };

      vi.spyOn(generator, "generateScript").mockReturnValue(mockScript);
      vi.spyOn(generator, "validateScript").mockReturnValue({
        isValid: true,
        errors: [],
      });

      // Mock script execution
      const mockRawResults: RawResults = {
        testId: "integration-test-1",
        startTime: new Date(),
        endTime: new Date(Date.now() + 30000),
        metrics: {
          http_req_duration: {
            avg: 150,
            min: 50,
            max: 300,
            p90: 200,
            p95: 250,
            p99: 290,
          },
          http_reqs: { count: 300, rate: 10 },
          http_req_failed: { count: 5, rate: 0.0167 },
          vus: { value: 10 },
          vus_max: { value: 10 },
        },
        checks: {
          "status is 200": { passes: 295, fails: 5 },
          "response time < 500ms": { passes: 300, fails: 0 },
        },
        executionLogs: [
          "Starting load test execution",
          "Ramping up to 10 virtual users",
          "Test completed successfully",
        ],
        systemMetrics: [],
      };

      vi.spyOn(executor, "executeScript").mockResolvedValue(mockRawResults);

      // Mock results analysis
      const mockAnalyzedResults = {
        summary: {
          totalRequests: 300,
          successfulRequests: 295,
          failedRequests: 5,
          averageResponseTime: 150,
          p95ResponseTime: 250,
          throughput: 10,
          errorRate: 0.0167,
        },
        recommendations: [
          "Response times are within acceptable range",
          "Error rate is low but monitor for patterns",
          "Consider increasing load to find breaking point",
        ],
      };

      vi.spyOn(analyzer, "analyzeResults").mockReturnValue(mockAnalyzedResults);

      // Execute the complete workflow
      const result = await orchestrator.executeLoadTest(expectedLoadTestSpec);

      // Verify the complete workflow
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.spec).toEqual(expectedLoadTestSpec);
      expect(result.status).toBe("completed");
      expect(result.metrics).toBeDefined();
      expect(result.recommendations).toHaveLength(3);

      // Verify all components were called
      expect(parser.validateSpec).toHaveBeenCalledWith(expectedLoadTestSpec);
      expect(generator.generateScript).toHaveBeenCalledWith(
        expectedLoadTestSpec
      );
      expect(executor.executeScript).toHaveBeenCalledWith(mockScript);
      expect(analyzer.analyzeResults).toHaveBeenCalledWith(mockRawResults);
    });

    it("should handle workflow failures and recovery", async () => {
      // Mock parser failure followed by success
      vi.spyOn(parser, "parseCommand")
        .mockRejectedValueOnce(new Error("AI service temporarily unavailable"))
        .mockResolvedValueOnce(expectedLoadTestSpec);

      vi.spyOn(parser, "validateSpec").mockReturnValue({
        isValid: true,
        errors: [],
      });

      // Mock successful generation and execution
      const mockScript: K6Script = {
        id: "recovery-test-script",
        name: "Recovery Test Script",
        content: "export default function() { /* test */ }",
        imports: [],
        options: { vus: 1, duration: "10s" },
        metadata: {
          generatedAt: new Date(),
          specId: expectedLoadTestSpec.id,
          version: "1.0.0",
          description: "Recovery test script",
          tags: ["recovery-test"],
        },
      };

      vi.spyOn(generator, "generateScript").mockReturnValue(mockScript);
      vi.spyOn(generator, "validateScript").mockReturnValue({
        isValid: true,
        errors: [],
      });

      const mockRawResults: RawResults = {
        testId: "recovery-test-1",
        startTime: new Date(),
        endTime: new Date(Date.now() + 10000),
        metrics: {
          http_req_duration: {
            avg: 100,
            min: 50,
            max: 200,
            p90: 150,
            p95: 180,
            p99: 195,
          },
          http_reqs: { count: 10, rate: 1 },
          http_req_failed: { count: 0, rate: 0 },
          vus: { value: 1 },
          vus_max: { value: 1 },
        },
        checks: {},
        executionLogs: ["Recovery test completed"],
        systemMetrics: [],
      };

      vi.spyOn(executor, "executeScript").mockResolvedValue(mockRawResults);

      vi.spyOn(analyzer, "analyzeResults").mockReturnValue({
        summary: {
          totalRequests: 10,
          successfulRequests: 10,
          failedRequests: 0,
          averageResponseTime: 100,
          p95ResponseTime: 180,
          throughput: 1,
          errorRate: 0,
        },
        recommendations: ["Test completed successfully after recovery"],
      });

      // Execute workflow - should succeed after retry
      const result = await orchestrator.executeLoadTest(expectedLoadTestSpec);

      expect(result).toBeDefined();
      expect(result.status).toBe("completed");
      expect(parser.parseCommand).toHaveBeenCalledTimes(2); // Failed once, succeeded on retry
    });
  });

  describe("Multi-step Workflow Integration", () => {
    it("should execute multi-step workflow with data correlation", async () => {
      const simpleSpec: LoadTestSpec = {
        id: "simple-test",
        name: "Simple Workflow",
        description: "Basic load test workflow",
        testType: "baseline",
        requests: [
          {
            method: "GET",
            url: "https://api.example.com/health",
          },
        ],
        loadPattern: {
          type: "constant",
          virtualUsers: 2,
        },
        duration: { value: 10, unit: "seconds" },
      };

      vi.spyOn(parser, "validateSpec").mockReturnValue({
        isValid: true,
        errors: [],
      });

      const mockScript: K6Script = {
        id: "simple-script",
        name: "Simple Script",
        content: "export default function() { /* test */ }",
        imports: ["http", "check"],
        options: { vus: 2, duration: "10s" },
        metadata: {
          generatedAt: new Date(),
          specId: simpleSpec.id,
          version: "1.0.0",
          description: "Simple test script",
          tags: ["simple"],
        },
      };

      vi.spyOn(generator, "generateScript").mockReturnValue(mockScript);
      vi.spyOn(generator, "validateScript").mockReturnValue({
        isValid: true,
        errors: [],
      });

      const mockResults: RawResults = {
        testId: "simple-test",
        startTime: new Date(),
        endTime: new Date(Date.now() + 10000),
        metrics: {
          http_req_duration: {
            avg: 100,
            min: 50,
            max: 200,
            p90: 150,
            p95: 180,
            p99: 195,
          },
          http_reqs: { count: 20, rate: 2 },
          http_req_failed: { count: 0, rate: 0 },
          vus: { value: 2 },
          vus_max: { value: 2 },
        },
        checks: {
          "status is 200": { passes: 20, fails: 0 },
        },
        executionLogs: ["Simple workflow completed"],
        systemMetrics: [],
      };

      vi.spyOn(executor, "executeScript").mockResolvedValue(mockResults);

      vi.spyOn(analyzer, "analyzeResults").mockReturnValue({
        summary: {
          totalRequests: 20,
          successfulRequests: 20,
          failedRequests: 0,
          averageResponseTime: 100,
          p95ResponseTime: 180,
          throughput: 2,
          errorRate: 0,
        },
        recommendations: ["Simple workflow completed successfully"],
      });

      const result = await orchestrator.executeLoadTest(simpleSpec);

      expect(result).toBeDefined();
      expect(result.status).toBe("completed");
      expect(result.metrics.totalRequests).toBe(20);
      expect(result.recommendations).toContain(
        "Simple workflow completed successfully"
      );
    });
  });
});

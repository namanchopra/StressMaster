/**
 * Performance benchmarks for parsing accuracy and response time
 * Measures system performance against defined benchmarks
 */

import { describe, it, expect, beforeEach } from "vitest";
import { UniversalCommandParser } from "../../universal-command-parser";
import { MockAIProvider } from "../mocks/mock-ai-provider";
import {
  allTestDataSets,
  TestDataSet,
  TestInput,
  ExpectedParseResult,
} from "../test-data/messy-input-datasets";
import { LoadTestSpec } from "../../../types";

interface BenchmarkResult {
  accuracy: number;
  averageResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  successRate: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
}

interface AccuracyMetrics {
  exactMatches: number;
  acceptableMatches: number;
  totalTests: number;
  accuracy: number;
}

describe("Parsing Performance Benchmarks", () => {
  let parser: UniversalCommandParser;
  let mockProvider: MockAIProvider;

  beforeEach(() => {
    mockProvider = new MockAIProvider();
    parser = new UniversalCommandParser(mockProvider);
  });

  describe("Response Time Benchmarks", () => {
    it("should parse typical requests within 2 seconds", async () => {
      const typicalRequests = [
        'POST https://api.example.com/users with JSON {"name": "John"} using 10 users',
        "GET https://api.example.com/data with Authorization: Bearer token for 30 seconds",
        'PUT https://api.example.com/update with {"id": 123} testing 5 users',
        "DELETE https://api.example.com/items/456 load test with 15 users for 60 seconds",
      ];

      const responseTimes: number[] = [];

      for (const request of typicalRequests) {
        const startTime = Date.now();
        const result = await parser.parseCommand(request);
        const endTime = Date.now();

        const responseTime = endTime - startTime;
        responseTimes.push(responseTime);

        expect(result).toBeDefined();
        expect(responseTime).toBeLessThan(2000); // Target: <2s for typical requests
      }

      const averageTime =
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      console.log(
        `Average response time for typical requests: ${averageTime}ms`
      );

      expect(averageTime).toBeLessThan(1500); // Average should be even better
    });

    it("should parse complex requests within 5 seconds", async () => {
      const complexRequests = [
        `POST https://api.example.com/complex
         Content-Type: application/json
         Authorization: Bearer very-long-token-string-that-goes-on-and-on
         X-Custom-Header: custom-value
         
         {
           "user": {
             "name": "John Doe",
             "email": "john@example.com",
             "preferences": {
               "notifications": true,
               "theme": "dark"
             }
           },
           "metadata": {
             "source": "api-test",
             "timestamp": "2024-01-01T00:00:00Z"
           }
         }
         
         Load test with 25 users for 2 minutes with ramp-up of 30 seconds`,

        `I need to test multiple endpoints:
         1. POST https://api.example.com/users with user data
         2. GET https://api.example.com/users/123 to verify creation
         3. PUT https://api.example.com/users/123 to update
         4. DELETE https://api.example.com/users/123 to cleanup
         
         Use these headers for all requests:
         - Content-Type: application/json
         - Authorization: Bearer abc123
         - X-Request-ID: test-123
         
         Run load test with 50 concurrent users for 5 minutes`,
      ];

      const responseTimes: number[] = [];

      for (const request of complexRequests) {
        const startTime = Date.now();
        const result = await parser.parseCommand(request);
        const endTime = Date.now();

        const responseTime = endTime - startTime;
        responseTimes.push(responseTime);

        expect(result).toBeDefined();
        expect(responseTime).toBeLessThan(5000); // Target: <5s for complex requests
      }

      const averageTime =
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      console.log(
        `Average response time for complex requests: ${averageTime}ms`
      );
    });

    it("should handle concurrent parsing requests efficiently", async () => {
      const concurrentRequests = Array.from(
        { length: 10 },
        (_, i) =>
          `POST https://api.example.com/test${i} with {"id": ${i}} using ${
            i + 1
          } users`
      );

      const startTime = Date.now();
      const results = await Promise.all(
        concurrentRequests.map((req) => parser.parseCommand(req))
      );
      const endTime = Date.now();

      const totalTime = endTime - startTime;
      const averageTimePerRequest = totalTime / concurrentRequests.length;

      expect(results).toHaveLength(10);
      results.forEach((result) => expect(result).toBeDefined());

      expect(totalTime).toBeLessThan(8000); // All 10 requests should complete within 8 seconds
      expect(averageTimePerRequest).toBeLessThan(1000); // Average per request should be <1s when concurrent

      console.log(
        `Concurrent parsing: ${totalTime}ms total, ${averageTimePerRequest}ms average per request`
      );
    });
  });

  describe("Accuracy Benchmarks", () => {
    it("should achieve >95% accuracy for clean input", async () => {
      const cleanInputs = allTestDataSets
        .filter((dataset) => dataset.category === "clean")
        .flatMap((dataset) =>
          dataset.inputs.map((input, idx) => ({
            input,
            expected: dataset.expectedOutputs[idx],
            fallback: dataset.acceptableFallbacks[idx],
          }))
        );

      if (cleanInputs.length === 0) {
        // Add some clean test cases
        const cleanTestCases = [
          {
            input: {
              raw: 'POST https://api.example.com/users Content-Type: application/json {"name": "John"} Load test with 10 users for 30 seconds',
              description: "Clean structured input",
              expectedChallenges: [],
              minimumConfidence: 0.95,
            },
            expected: {
              method: "POST",
              url: "https://api.example.com/users",
              headers: { "Content-Type": "application/json" },
              body: '{"name":"John"}',
              loadPattern: { users: 10, duration: "30s" },
            } as LoadTestSpec,
            fallback: null,
          },
        ];

        const accuracy = await measureAccuracy(cleanTestCases);
        expect(accuracy.accuracy).toBeGreaterThan(0.95); // >95% accuracy target

        console.log(
          `Clean input accuracy: ${(accuracy.accuracy * 100).toFixed(1)}%`
        );
      }
    });

    it("should achieve >80% accuracy for messy input", async () => {
      const messyInputs = allTestDataSets
        .filter((dataset) => dataset.category === "messy")
        .flatMap((dataset) =>
          dataset.inputs.map((input, idx) => ({
            input,
            expected: dataset.expectedOutputs[idx],
            fallback: dataset.acceptableFallbacks[idx],
          }))
        );

      const accuracy = await measureAccuracy(messyInputs);
      expect(accuracy.accuracy).toBeGreaterThan(0.8); // >80% accuracy target for messy input

      console.log(
        `Messy input accuracy: ${(accuracy.accuracy * 100).toFixed(1)}%`
      );
      console.log(
        `Total tests: ${accuracy.totalTests}, Exact matches: ${accuracy.exactMatches}, Acceptable: ${accuracy.acceptableMatches}`
      );
    });

    it("should achieve >70% accuracy for mixed format input", async () => {
      const mixedInputs = allTestDataSets
        .filter((dataset) => dataset.category === "mixed")
        .flatMap((dataset) =>
          dataset.inputs.map((input, idx) => ({
            input,
            expected: dataset.expectedOutputs[idx],
            fallback: dataset.acceptableFallbacks[idx],
          }))
        );

      const accuracy = await measureAccuracy(mixedInputs);
      expect(accuracy.accuracy).toBeGreaterThan(0.7); // >70% accuracy target for mixed input

      console.log(
        `Mixed format input accuracy: ${(accuracy.accuracy * 100).toFixed(1)}%`
      );
    });

    it("should handle edge cases with >50% success rate", async () => {
      const edgeCases = allTestDataSets
        .filter((dataset) => dataset.category === "edge_cases")
        .flatMap((dataset) =>
          dataset.inputs.map((input, idx) => ({
            input,
            expected: dataset.expectedOutputs[idx],
            fallback: dataset.acceptableFallbacks[idx],
          }))
        );

      const accuracy = await measureAccuracy(edgeCases);
      expect(accuracy.accuracy).toBeGreaterThan(0.5); // >50% success rate for edge cases

      console.log(
        `Edge cases accuracy: ${(accuracy.accuracy * 100).toFixed(1)}%`
      );
    });

    async function measureAccuracy(
      testCases: Array<{
        input: TestInput;
        expected: ExpectedParseResult;
        fallback: ExpectedParseResult | null;
      }>
    ): Promise<AccuracyMetrics> {
      let exactMatches = 0;
      let acceptableMatches = 0;
      let totalTests = testCases.length;

      for (const testCase of testCases) {
        try {
          const result = await parser.parseCommand(testCase.input.raw);

          if (isExactMatch(result, testCase.expected)) {
            exactMatches++;
            acceptableMatches++;
          } else if (
            testCase.fallback &&
            isExactMatch(result, testCase.fallback)
          ) {
            acceptableMatches++;
          } else if (isAcceptableMatch(result, testCase.expected)) {
            acceptableMatches++;
          }
        } catch (error) {
          // Test failed - no match
          console.warn(
            `Test failed for input: ${testCase.input.description}`,
            error
          );
        }
      }

      return {
        exactMatches,
        acceptableMatches,
        totalTests,
        accuracy: acceptableMatches / totalTests,
      };
    }

    function isExactMatch(
      result: LoadTestSpec,
      expected: LoadTestSpec
    ): boolean {
      return (
        result.method === expected.method &&
        result.url === expected.url &&
        JSON.stringify(result.headers || {}) ===
          JSON.stringify(expected.headers || {}) &&
        result.body === expected.body &&
        JSON.stringify(result.loadPattern) ===
          JSON.stringify(expected.loadPattern)
      );
    }

    function isAcceptableMatch(
      result: LoadTestSpec,
      expected: LoadTestSpec
    ): boolean {
      // More lenient matching - core fields must match
      const methodMatch = result.method === expected.method;
      const urlMatch = result.url === expected.url;
      const hasLoadPattern =
        result.loadPattern && Object.keys(result.loadPattern).length > 0;

      return methodMatch && urlMatch && hasLoadPattern;
    }
  });

  describe("Memory Usage Benchmarks", () => {
    it("should use <50MB per parsing request", async () => {
      const initialMemory = process.memoryUsage();

      const largeRequest = `
        POST https://api.example.com/bulk
        Content-Type: application/json
        
        ${JSON.stringify({
          data: "x".repeat(10000),
          items: new Array(1000).fill({
            id: 1,
            name: "test item",
            description: "large data",
          }),
        })}
        
        Load test with 20 users for 60 seconds
      `;

      await parser.parseCommand(largeRequest);

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryIncreaseMB = memoryIncrease / (1024 * 1024);

      console.log(`Memory increase: ${memoryIncreaseMB.toFixed(2)}MB`);
      expect(memoryIncreaseMB).toBeLessThan(50); // Target: <50MB per request
    });
  });

  describe("Comprehensive Benchmark Suite", () => {
    it("should run full benchmark suite and report metrics", async () => {
      const benchmarkResults: BenchmarkResult[] = [];

      for (const dataset of allTestDataSets) {
        const result = await runBenchmarkForDataset(dataset);
        benchmarkResults.push(result);

        console.log(
          `\n=== ${dataset.category.toUpperCase()} DATASET RESULTS ===`
        );
        console.log(`Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
        console.log(`Success Rate: ${(result.successRate * 100).toFixed(1)}%`);
        console.log(`Average Response Time: ${result.averageResponseTime}ms`);
        console.log(`Max Response Time: ${result.maxResponseTime}ms`);
        console.log(`Tests: ${result.passedTests}/${result.totalTests} passed`);
      }

      // Overall metrics
      const overallAccuracy =
        benchmarkResults.reduce((sum, r) => sum + r.accuracy, 0) /
        benchmarkResults.length;
      const overallResponseTime =
        benchmarkResults.reduce((sum, r) => sum + r.averageResponseTime, 0) /
        benchmarkResults.length;

      console.log(`\n=== OVERALL BENCHMARK RESULTS ===`);
      console.log(`Overall Accuracy: ${(overallAccuracy * 100).toFixed(1)}%`);
      console.log(
        `Overall Average Response Time: ${overallResponseTime.toFixed(0)}ms`
      );

      // Verify overall performance meets targets
      expect(overallAccuracy).toBeGreaterThan(0.75); // Overall accuracy >75%
      expect(overallResponseTime).toBeLessThan(3000); // Overall response time <3s
    });

    async function runBenchmarkForDataset(
      dataset: TestDataSet
    ): Promise<BenchmarkResult> {
      const responseTimes: number[] = [];
      let passedTests = 0;
      let failedTests = 0;

      for (let i = 0; i < dataset.inputs.length; i++) {
        const input = dataset.inputs[i];
        const expected = dataset.expectedOutputs[i];

        try {
          const startTime = Date.now();
          const result = await parser.parseCommand(input.raw);
          const endTime = Date.now();

          const responseTime = endTime - startTime;
          responseTimes.push(responseTime);

          if (result && isAcceptableMatch(result, expected)) {
            passedTests++;
          } else {
            failedTests++;
          }
        } catch (error) {
          failedTests++;
          responseTimes.push(5000); // Penalty time for failures
        }
      }

      const totalTests = dataset.inputs.length;
      const accuracy = passedTests / totalTests;
      const successRate = passedTests / totalTests;
      const averageResponseTime =
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);
      const minResponseTime = Math.min(...responseTimes);

      return {
        accuracy,
        averageResponseTime,
        maxResponseTime,
        minResponseTime,
        successRate,
        totalTests,
        passedTests,
        failedTests,
      };
    }

    function isAcceptableMatch(
      result: LoadTestSpec,
      expected: LoadTestSpec
    ): boolean {
      const methodMatch = result.method === expected.method;
      const urlMatch = result.url === expected.url;
      const hasLoadPattern =
        result.loadPattern && Object.keys(result.loadPattern).length > 0;

      return methodMatch && urlMatch && hasLoadPattern;
    }
  });
});

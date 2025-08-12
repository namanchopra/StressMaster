import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OllamaClient } from "../../parser/ollama-client";
import { K6ScriptExecutor } from "../../executor/script-executor";
import { K6Script } from "../../types";
import axios from "axios";

describe("Container Communication Tests", () => {
  let ollamaClient: OllamaClient;
  let scriptExecutor: K6ScriptExecutor;

  beforeEach(() => {
    ollamaClient = new OllamaClient({
      baseUrl: "http://localhost:11434",
      model: "llama3",
      timeout: 30000,
      maxRetries: 3,
    });

    scriptExecutor = new K6ScriptExecutor({
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Ollama Service Communication", () => {
    it("should successfully connect to Ollama service", async () => {
      // Mock successful Ollama response
      vi.spyOn(axios, "post").mockResolvedValue({
        status: 200,
        data: {
          model: "llama3",
          created_at: new Date().toISOString(),
          response: JSON.stringify({
            testType: "baseline",
            method: "GET",
            url: "https://api.example.com/health",
            virtualUsers: 10,
            duration: "30s",
          }),
          done: true,
        },
      });

      const result = await ollamaClient.generateCompletion(
        "Create a simple health check load test with 10 users for 30 seconds"
      );

      expect(result).toBeDefined();
      expect(result.response).toContain("baseline");
      expect(axios.post).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.objectContaining({
          model: "llama3",
          prompt: expect.stringContaining(
            "Create a simple health check load test"
          ),
        }),
        expect.objectContaining({
          timeout: 30000,
        })
      );
    });

    it("should handle Ollama service connection failures", async () => {
      // Mock connection failure
      vi.spyOn(axios, "post").mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(
        ollamaClient.generateCompletion("Test command")
      ).rejects.toThrow("ECONNREFUSED");
    });

    it("should retry on temporary Ollama failures", async () => {
      // Mock temporary failure followed by success
      vi.spyOn(axios, "post")
        .mockRejectedValueOnce(new Error("Service temporarily unavailable"))
        .mockResolvedValueOnce({
          status: 200,
          data: {
            model: "llama3",
            created_at: new Date().toISOString(),
            response: JSON.stringify({
              testType: "stress",
              method: "POST",
              url: "https://api.example.com/data",
              virtualUsers: 50,
              duration: "60s",
            }),
            done: true,
          },
        });

      const result = await ollamaClient.generateCompletion(
        "Create a stress test with 50 users"
      );

      expect(result).toBeDefined();
      expect(result.response).toContain("stress");
      expect(axios.post).toHaveBeenCalledTimes(2); // 1 failure + 1 success
    });
  });

  describe("K6 Script Execution", () => {
    it("should execute K6 script successfully", async () => {
      const testScript: K6Script = {
        id: "test-script-1",
        name: "Basic Test Script",
        content: "export default function() { /* test */ }",
        imports: ["http", "check"],
        options: { vus: 2, duration: "10s" },
        metadata: {
          generatedAt: new Date(),
          specId: "test-spec",
          version: "1.0.0",
          description: "Basic test script",
          tags: ["test"],
        },
      };

      // Mock successful K6 execution
      const mockExecuteCommand = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          metrics: {
            http_req_duration: {
              avg: 150,
              min: 100,
              max: 200,
              p90: 180,
              p95: 190,
              p99: 195,
            },
            http_reqs: { count: 20, rate: 2 },
            http_req_failed: { count: 0, rate: 0 },
            vus: { value: 2 },
            vus_max: { value: 2 },
          },
          checks: {
            "status is 200": { passes: 20, fails: 0 },
            "response time < 1000ms": { passes: 20, fails: 0 },
          },
        }),
        stderr: "",
        exitCode: 0,
      });

      // Mock the executor's internal command execution
      vi.spyOn(scriptExecutor as any, "executeCommand", "get").mockReturnValue(
        mockExecuteCommand
      );

      const result = await scriptExecutor.executeScript(testScript);

      expect(result).toBeDefined();
      expect(result.testId).toBe("test-script-1");
      expect(result.metrics.http_reqs.count).toBe(20);
      expect(result.metrics.http_req_failed.count).toBe(0);
    });

    it("should handle K6 execution failures", async () => {
      const testScript: K6Script = {
        id: "failing-test",
        name: "Failing Test",
        content: "export default function() { /* test */ }",
        imports: [],
        options: { vus: 1, duration: "5s" },
        metadata: {
          generatedAt: new Date(),
          specId: "failing-test-spec",
          version: "1.0.0",
          description: "Failing test",
          tags: ["failure-test"],
        },
      };

      // Mock execution failure
      const mockExecuteCommand = vi
        .fn()
        .mockRejectedValue(new Error("Script execution failed"));

      vi.spyOn(scriptExecutor as any, "executeCommand", "get").mockReturnValue(
        mockExecuteCommand
      );

      await expect(scriptExecutor.executeScript(testScript)).rejects.toThrow(
        "Script execution failed"
      );
    });
  });

  describe("Service Integration", () => {
    it("should coordinate between Ollama and K6 services", async () => {
      // Mock Ollama parsing a command
      vi.spyOn(axios, "post").mockResolvedValue({
        status: 200,
        data: {
          model: "llama3",
          created_at: new Date().toISOString(),
          response: JSON.stringify({
            testType: "baseline",
            method: "GET",
            url: "https://api.example.com/test",
            virtualUsers: 3,
            duration: "15s",
          }),
          done: true,
        },
      });

      // Parse command with Ollama
      const parseResult = await ollamaClient.generateCompletion(
        "Test the API endpoint with 3 users for 15 seconds"
      );

      expect(parseResult.response).toContain("baseline");

      // Generate and execute script based on parsed result
      const parsedData = JSON.parse(parseResult.response);
      const testScript: K6Script = {
        id: "coordination-test",
        name: "Service Coordination Test",
        content: "export default function() { /* test */ }",
        imports: ["http", "check"],
        options: {
          vus: parsedData.virtualUsers,
          duration: parsedData.duration,
        },
        metadata: {
          generatedAt: new Date(),
          specId: "coordination-test-spec",
          version: "1.0.0",
          description: "Service coordination test",
          tags: ["coordination"],
        },
      };

      // Mock K6 execution
      const mockExecuteCommand = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          metrics: {
            http_req_duration: {
              avg: 200,
              min: 150,
              max: 300,
              p90: 250,
              p95: 280,
              p99: 295,
            },
            http_reqs: { count: 45, rate: 3 },
            http_req_failed: { count: 0, rate: 0 },
            vus: { value: 3 },
            vus_max: { value: 3 },
          },
          checks: {
            "status is 200": { passes: 45, fails: 0 },
          },
        }),
        stderr: "",
        exitCode: 0,
      });

      vi.spyOn(scriptExecutor as any, "executeCommand", "get").mockReturnValue(
        mockExecuteCommand
      );

      const executionResult = await scriptExecutor.executeScript(testScript);

      expect(executionResult.metrics.http_reqs.count).toBe(45);
      expect(executionResult.metrics.http_req_failed.count).toBe(0);
      expect(executionResult.checks["status is 200"].passes).toBe(45);
    });

    it("should handle service communication failures gracefully", async () => {
      // Mock Ollama failure
      vi.spyOn(axios, "post").mockRejectedValue(
        new Error("Ollama service unavailable")
      );

      await expect(
        ollamaClient.generateCompletion("Test command")
      ).rejects.toThrow("Ollama service unavailable");
    });
  });
});

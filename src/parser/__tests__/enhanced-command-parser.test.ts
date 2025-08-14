/**
 * Integration tests for enhanced command parser with smart parsing pipeline
 */

import { describe, it, expect, beforeEach, vi, Mock } from "vitest";
import { AICommandParser, DetailedParseResult } from "../command-parser";
import { UniversalCommandParser } from "../universal-command-parser";
import { LoadTestSpec } from "../../types";

// Mock the Ollama client
vi.mock("../ollama-client", () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({
    healthCheck: vi.fn().mockResolvedValue(true),
    checkModelAvailability: vi.fn().mockResolvedValue(true),
    pullModel: vi.fn().mockResolvedValue(undefined),
    generateCompletion: vi.fn().mockImplementation((request: any) => {
      // Dynamic response based on input
      const prompt = request.prompt || "";
      let method = "GET";
      let url = "https://api.example.com/test";

      if (prompt.includes("POST") || prompt.includes("post")) {
        method = "POST";
      }
      if (prompt.includes("/api/orders")) {
        url = "/api/orders";
      }
      if (prompt.includes("/login") || prompt.includes("login")) {
        url = "https://api.example.com/login";
      }

      return Promise.resolve({
        response: JSON.stringify({
          id: "test_123",
          name: "Test Load Test",
          description: "Test input",
          testType: "baseline",
          requests: [
            {
              method,
              url,
            },
          ],
          loadPattern: {
            type: "constant",
            virtualUsers: 10,
          },
          duration: {
            value: 30,
            unit: "seconds",
          },
        }),
      });
    }),
    getActiveConnections: vi.fn().mockReturnValue(0),
    getQueueLength: vi.fn().mockReturnValue(0),
    getErrorStatistics: vi.fn().mockReturnValue({}),
    getServiceHealth: vi.fn().mockReturnValue({ status: "healthy" }),
    clearDiagnostics: vi.fn(),
    getGracefulDegradationStrategy: vi.fn().mockReturnValue({
      canDegrade: false,
      strategy: "none",
      confidence: 1.0,
      limitations: [],
    }),
  })),
}));

// Mock AI Provider Factory
vi.mock("../ai-provider-factory", () => ({
  AIProviderFactory: {
    create: vi.fn().mockReturnValue({
      getProviderName: vi.fn().mockReturnValue("MockProvider"),
      initialize: vi.fn().mockResolvedValue(undefined),
      generateCompletion: vi.fn().mockImplementation((request: any) => {
        // Dynamic response based on input
        const prompt = request.prompt || "";
        let method = "GET";
        let url = "https://api.example.com/test";

        if (prompt.includes("POST") || prompt.includes("post")) {
          method = "POST";
        }
        if (prompt.includes("/api/orders")) {
          url = "/api/orders";
        }
        if (prompt.includes("/login") || prompt.includes("login")) {
          url = "https://api.example.com/login";
        }

        return Promise.resolve({
          response: JSON.stringify({
            id: "test_123",
            name: "Test Load Test",
            description: "Test input",
            testType: "baseline",
            requests: [
              {
                method,
                url,
              },
            ],
            loadPattern: {
              type: "constant",
              virtualUsers: 10,
            },
            duration: {
              value: 30,
              unit: "seconds",
            },
          }),
        });
      }),
      healthCheck: vi.fn().mockResolvedValue(true),
    }),
  },
}));

describe("Enhanced Command Parser Integration", () => {
  let aiParser: AICommandParser;
  let universalParser: UniversalCommandParser;

  beforeEach(async () => {
    aiParser = new AICommandParser({
      ollamaEndpoint: "http://localhost:11434",
      modelName: "test-model",
      maxRetries: 3,
      timeout: 30000,
    });

    universalParser = new UniversalCommandParser({
      provider: "openai",
      model: "gpt-3.5-turbo",
      apiKey: "test-key",
    });

    await aiParser.initialize();
    await universalParser.initialize();
  });

  describe("Smart Parsing Pipeline", () => {
    it("should process natural language input through complete pipeline", async () => {
      const input =
        "Test the API endpoint https://api.example.com/users with 50 users for 2 minutes";

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result).toBeDefined();
      expect(result.spec).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.processingSteps).toContain("Input preprocessing");
      expect(result.processingSteps).toContain("Format detection");
      expect(result.processingSteps).toContain("Context enhancement");
      expect(result.processingSteps).toContain("Smart prompt building");
      expect(result.processingSteps).toContain("AI parsing");
      expect(result.processingSteps).toContain("Explanation generation");
    });

    it("should handle mixed structured data input", async () => {
      const input = `
        POST request to /api/orders
        Headers: Content-Type: application/json
        Body: {"productId": 123, "quantity": 2}
        Load: 100 concurrent users
        Duration: 5 minutes
      `;

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result.spec.requests[0].method).toBe("POST");
      expect(result.spec.requests[0].url).toContain("/api/orders");
      expect(result.explanation.extractedComponents).toContain(
        "HTTP Method: POST"
      );
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("should handle curl command input", async () => {
      const input = `curl -X POST https://api.example.com/login -H "Content-Type: application/json" -d '{"username": "test", "password": "pass"}'`;

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result.spec.requests[0].method).toBe("POST");
      expect(result.spec.requests[0].url).toBe("https://api.example.com/login");
      expect(result.explanation.extractedComponents).toContain(
        "HTTP Method: POST"
      );
      expect(result.explanation.extractedComponents).toContain(
        "URL: https://api.example.com/login"
      );
    });

    it("should detect and resolve ambiguities", async () => {
      const input = "Test the endpoint with some users";

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result.ambiguities.length).toBeGreaterThan(0);
      expect(result.assumptions.length).toBeGreaterThan(0);
      expect(result.warnings).toContain(
        "Input had low confidence - please verify the generated test specification"
      );
    });

    it("should provide detailed explanations", async () => {
      const input =
        "GET https://api.example.com/products with 25 users for 1 minute";

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result.explanation).toBeDefined();
      expect(result.explanation.extractedComponents).toBeDefined();
      expect(result.explanation.assumptions).toBeDefined();
      expect(result.explanation.ambiguityResolutions).toBeDefined();
      expect(result.explanation.suggestions).toBeDefined();
    });
  });

  describe("Universal Parser Smart Pipeline", () => {
    it("should work with universal parser", async () => {
      const input =
        "Load test POST /api/users with 20 concurrent users for 30 seconds";

      const result = await universalParser.parseCommandWithSmartPipeline(input);

      expect(result).toBeDefined();
      expect(result.spec).toBeDefined();
      expect(result.processingSteps).toContain("AI parsing (MockProvider)");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should handle provider-specific processing", async () => {
      const input =
        "Stress test the API with increasing load from 10 to 100 users";

      const result = await universalParser.parseCommandWithSmartPipeline(input);

      expect(result.spec.testType).toBeDefined();
      expect(result.processingSteps).toContain("AI parsing (MockProvider)");
    });
  });

  describe("Fallback Mechanisms", () => {
    it("should fallback gracefully when AI parsing fails", async () => {
      // Mock AI failure
      const mockGenerateCompletion = vi
        .fn()
        .mockRejectedValue(new Error("AI service unavailable"));
      (aiParser as any).ollamaClient.generateCompletion =
        mockGenerateCompletion;

      const input = "GET https://api.example.com/test with 10 users";

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result).toBeDefined();
      expect(result.spec).toBeDefined();
      expect(result.warnings).toContain(
        "Smart parsing failed: Smart prompt parsing failed: AI service unavailable"
      );
      expect(result.processingSteps).toContain(
        "Error: Smart prompt parsing failed: AI service unavailable"
      );
    });

    it("should use fallback when AI is not ready", async () => {
      const parser = new AICommandParser({
        ollamaEndpoint: "http://localhost:11434",
        modelName: "test-model",
        maxRetries: 3,
        timeout: 30000,
      });
      // Don't initialize, so AI is not ready

      const input = "Test API with 5 users";

      const result = await parser.parseCommandWithSmartPipeline(input);

      expect(result).toBeDefined();
      expect(result.spec).toBeDefined();
      expect(result.warnings).toContain(
        "AI model not available, used fallback parsing"
      );
      expect(result.processingSteps).toContain(
        "Fallback parsing (AI not ready)"
      );
    });
  });

  describe("Input Format Detection", () => {
    it("should detect natural language format", async () => {
      const input =
        "Please create a load test for the user registration API with 50 concurrent users";

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should detect JSON with text format", async () => {
      const input = `
        Test this API endpoint with the following request:
        {"method": "POST", "url": "/api/users", "body": {"name": "test"}}
        Use 20 users for 1 minute
      `;

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result).toBeDefined();
      expect(result.explanation.extractedComponents.length).toBeGreaterThan(0);
    });

    it("should detect concatenated requests", async () => {
      const input = `
        First request: GET /api/users
        Second request: POST /api/orders
        Test with 10 users each
      `;

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result).toBeDefined();
      expect(result.spec).toBeDefined();
    });
  });

  describe("Context Enhancement", () => {
    it("should infer missing fields", async () => {
      const input = "Test the login endpoint";

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result.assumptions.length).toBeGreaterThan(0);
      expect(result.assumptions.some((a) => a.field === "method")).toBe(true);
      expect(result.assumptions.some((a) => a.field === "url")).toBe(true);
    });

    it("should resolve ambiguities with reasonable defaults", async () => {
      const input = "Load test with users";

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result.ambiguities.length).toBeGreaterThan(0);
      expect(result.spec.loadPattern.virtualUsers).toBeGreaterThan(0);
    });
  });

  describe("Smart Prompt Building", () => {
    it("should build contextual prompts with examples", async () => {
      const input = "POST to /api/orders with 100 users";

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result).toBeDefined();
      expect(result.spec.requests[0].method).toBe("POST");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should provide clarifications for ambiguous input", async () => {
      const input = "Test something";

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.ambiguities.length).toBeGreaterThan(0);
    });
  });

  describe("Detailed Feedback", () => {
    it("should provide comprehensive parsing feedback", async () => {
      const input =
        "Spike test GET https://api.example.com/health with 1000 users for 10 seconds";

      const result = await aiParser.getDetailedParsingFeedback(input);

      expect(result.spec).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.explanation).toBeDefined();
      expect(result.processingSteps).toBeDefined();
      expect(result.assumptions).toBeDefined();
      expect(result.warnings).toBeDefined();
    });

    it("should track processing steps", async () => {
      const input = "Test API endpoint";

      const result = await aiParser.getDetailedParsingFeedback(input);

      expect(result.processingSteps).toContain("Input preprocessing");
      expect(result.processingSteps).toContain("Format detection");
      expect(result.processingSteps).toContain("Context enhancement");
      expect(result.processingSteps).toContain("Smart prompt building");
      expect(result.processingSteps).toContain("Explanation generation");
    });
  });

  describe("Status and Capabilities", () => {
    it("should report smart parsing status for AI parser", () => {
      const status = aiParser.getSmartParsingStatus();

      expect(status.isReady).toBe(true);
      expect(status.components.preprocessor).toBe(true);
      expect(status.components.formatDetector).toBe(true);
      expect(status.components.contextEnhancer).toBe(true);
      expect(status.components.promptBuilder).toBe(true);
      expect(status.capabilities).toContain(
        "Input sanitization and structure extraction"
      );
      expect(status.capabilities).toContain(
        "Format detection with confidence scoring"
      );
    });

    it("should report smart parsing status for universal parser", () => {
      const status = universalParser.getSmartParsingStatus();

      expect(status.isReady).toBe(true);
      expect(status.providerName).toBe("MockProvider");
      expect(status.components.preprocessor).toBe(true);
      expect(status.capabilities).toContain(
        "Universal AI provider support (MockProvider)"
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed input gracefully", async () => {
      const input = "}{invalid json}{ test @#$%";

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result).toBeDefined();
      expect(result.spec).toBeDefined();
      // Confidence may be high due to successful fallback parsing
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should handle empty input", async () => {
      const input = "";

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result).toBeDefined();
      expect(result.spec).toBeDefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("should handle very long input", async () => {
      const input = "Test API ".repeat(1000) + "with 10 users";

      const result = await aiParser.parseCommandWithSmartPipeline(input);

      expect(result).toBeDefined();
      expect(result.spec).toBeDefined();
    });
  });

  describe("Performance and Efficiency", () => {
    it("should complete parsing within reasonable time", async () => {
      const input = "Load test POST /api/users with 50 users for 2 minutes";

      const startTime = Date.now();
      const result = await aiParser.parseCommandWithSmartPipeline(input);
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it("should handle multiple concurrent parsing requests", async () => {
      const inputs = [
        "GET /api/users with 10 users",
        "POST /api/orders with 20 users",
        "PUT /api/products with 15 users",
      ];

      const promises = inputs.map((input) =>
        aiParser.parseCommandWithSmartPipeline(input)
      );
      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toBeDefined();
        expect(result.spec).toBeDefined();
      });
    });
  });

  describe("Enhanced Feedback Methods", () => {
    describe("Assumption Logging", () => {
      it("should log parsing assumptions for transparency", () => {
        const consoleSpy = vi
          .spyOn(console, "log")
          .mockImplementation(() => {});

        const assumptions = [
          {
            field: "method",
            assumedValue: "GET",
            reason: "No HTTP method specified",
            alternatives: ["POST", "PUT", "DELETE"],
          },
          {
            field: "virtualUsers",
            assumedValue: 10,
            reason: "No user count specified",
            alternatives: [1, 5, 20, 50],
          },
        ];

        aiParser.logParsingAssumptions(assumptions);

        expect(consoleSpy).toHaveBeenCalledWith("🔍 Parsing Assumptions Made:");
        expect(consoleSpy).toHaveBeenCalledWith(
          "  1. method: GET (No HTTP method specified)"
        );
        expect(consoleSpy).toHaveBeenCalledWith(
          "     Alternatives: POST, PUT, DELETE"
        );
        expect(consoleSpy).toHaveBeenCalledWith(
          "  2. virtualUsers: 10 (No user count specified)"
        );

        consoleSpy.mockRestore();
      });

      it("should not log when no assumptions are made", () => {
        const consoleSpy = vi
          .spyOn(console, "log")
          .mockImplementation(() => {});

        aiParser.logParsingAssumptions([]);

        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
      });
    });

    describe("Error Analysis", () => {
      it("should provide specific error analysis for missing URL", () => {
        const error = new Error("URL is required");
        const input = "Test with 10 users";

        const analysis = aiParser.getParsingErrors(input, error);

        expect(analysis.errorType).toBe("missing_url");
        expect(analysis.suggestions).toContain(
          "Include a complete URL (e.g., https://api.example.com/endpoint)"
        );
        expect(analysis.recoveryOptions).toContain(
          "Try with a sample URL: https://httpbin.org/get"
        );
      });

      it("should provide specific error analysis for missing method", () => {
        const error = new Error("HTTP method is required");
        const input = "Test /api/users";

        const analysis = aiParser.getParsingErrors(input, error);

        expect(analysis.errorType).toBe("missing_method");
        expect(analysis.suggestions).toContain(
          "Specify the HTTP method (GET, POST, PUT, DELETE)"
        );
        expect(analysis.recoveryOptions).toContain(
          "Default to GET method for read operations"
        );
      });

      it("should provide specific error analysis for AI service errors", () => {
        const error = new Error("AI service unavailable");
        const input = "Test API";

        const analysis = aiParser.getParsingErrors(input, error);

        expect(analysis.errorType).toBe("ai_service_error");
        expect(analysis.suggestions).toContain(
          "Check if the AI service is running"
        );
        expect(analysis.recoveryOptions).toContain("Use fallback parsing mode");
      });

      it("should include context-specific suggestions", () => {
        const error = new Error("Parsing failed");
        const input = "Test something";
        const context = {
          originalInput: input,
          cleanedInput: input,
          extractedComponents: {
            methods: [],
            urls: [],
            headers: [],
            bodies: [],
            counts: [],
          },
          inferredFields: {},
          ambiguities: [
            { field: "url", possibleValues: [], reason: "No URL specified" },
          ],
          confidence: 0.2,
        };

        const analysis = aiParser.getParsingErrors(input, error, context);

        expect(analysis.suggestions).toContain(
          "Try being more specific in your request"
        );
        expect(analysis.suggestions).toContain("Clarify: No URL specified");
      });
    });

    describe("Warning Analysis", () => {
      it("should identify uncertain areas in parsing", () => {
        const spec: LoadTestSpec = {
          id: "test_123",
          name: "Test",
          description: "Test",
          testType: "baseline",
          requests: [
            {
              method: "GET",
              url: "https://api.example.com/users",
            },
          ],
          loadPattern: {
            type: "constant",
            virtualUsers: 100,
          },
          duration: { value: 30, unit: "seconds" },
        };

        const context = {
          originalInput: "Test API",
          cleanedInput: "Test API",
          extractedComponents: {
            methods: [],
            urls: [],
            headers: [],
            bodies: [],
            counts: [],
          },
          inferredFields: {
            testType: "baseline",
            duration: "30",
            loadPattern: "constant",
          },
          ambiguities: [
            { field: "method", possibleValues: [], reason: "Method unclear" },
          ],
          confidence: 0.3,
        };

        const warnings = aiParser.getParsingWarnings(spec, context, 0.3);

        expect(warnings.uncertainAreas).toContain(
          "Overall parsing confidence is low"
        );
        expect(warnings.uncertainAreas).toContain("method: Method unclear");
        expect(warnings.uncertainAreas).toContain(
          "testType was inferred as: baseline"
        );
        expect(warnings.needsConfirmation).toContain(
          "Please verify the generated test specification"
        );
        expect(warnings.recommendations).toContain(
          "Consider using ramp-up pattern for high loads"
        );
      });

      it("should warn about missing authentication for API endpoints", () => {
        const spec: LoadTestSpec = {
          id: "test_123",
          name: "Test",
          description: "Test",
          testType: "baseline",
          requests: [
            {
              method: "GET",
              url: "https://api.example.com/users",
            },
          ],
          loadPattern: {
            type: "constant",
            virtualUsers: 10,
          },
          duration: { value: 30, unit: "seconds" },
        };

        const context = {
          originalInput: "Test API",
          cleanedInput: "Test API",
          extractedComponents: {
            methods: [],
            urls: [],
            headers: [],
            bodies: [],
            counts: [],
          },
          inferredFields: {},
          ambiguities: [],
          confidence: 0.8,
        };

        const warnings = aiParser.getParsingWarnings(spec, context, 0.8);

        expect(warnings.uncertainAreas).toContain(
          "No authentication headers detected for API endpoint"
        );
        expect(warnings.needsConfirmation).toContain(
          "Add authentication if required"
        );
        expect(warnings.recommendations).toContain(
          "Consider adding API key or bearer token"
        );
      });

      it("should warn about missing request body for POST requests", () => {
        const spec: LoadTestSpec = {
          id: "test_123",
          name: "Test",
          description: "Test",
          testType: "baseline",
          requests: [
            {
              method: "POST",
              url: "https://api.example.com/users",
            },
          ],
          loadPattern: {
            type: "constant",
            virtualUsers: 10,
          },
          duration: { value: 30, unit: "seconds" },
        };

        const context = {
          originalInput: "POST to API",
          cleanedInput: "POST to API",
          extractedComponents: {
            methods: ["POST"],
            urls: [],
            headers: [],
            bodies: [],
            counts: [],
          },
          inferredFields: {},
          ambiguities: [],
          confidence: 0.8,
        };

        const warnings = aiParser.getParsingWarnings(spec, context, 0.8);

        expect(warnings.uncertainAreas).toContain(
          "No request body specified for data modification method"
        );
        expect(warnings.needsConfirmation).toContain(
          "Add request body if needed"
        );
        expect(warnings.recommendations).toContain(
          "Include sample JSON data for testing"
        );
      });
    });

    describe("Comprehensive Feedback", () => {
      it("should provide comprehensive feedback for successful parsing", async () => {
        const input =
          "GET https://api.example.com/users with 25 users for 1 minute";

        const result = await aiParser.parseCommandWithComprehensiveFeedback(
          input
        );

        expect(result.spec).toBeDefined();
        expect(result.loggedAssumptions).toBeDefined();
        expect(result.warningAnalysis).toBeDefined();
        expect(result.warningAnalysis.uncertainAreas).toBeDefined();
        expect(result.warningAnalysis.needsConfirmation).toBeDefined();
        expect(result.warningAnalysis.recommendations).toBeDefined();
        expect(result.processingSteps).toContain("Input preprocessing");
        expect(result.processingSteps).toContain("AI parsing");
      });

      it("should provide comprehensive feedback for failed parsing", async () => {
        // Create a new parser that will fail
        const failingParser = new AICommandParser({
          ollamaEndpoint: "http://localhost:11434",
          modelName: "test-model",
          maxRetries: 3,
          timeout: 30000,
        });

        // Mock the parseCommandWithSmartPipeline to throw an error
        const originalMethod = failingParser.parseCommandWithSmartPipeline;
        failingParser.parseCommandWithSmartPipeline = vi
          .fn()
          .mockRejectedValue(new Error("AI service unavailable"));

        const input = "Test something";

        const result =
          await failingParser.parseCommandWithComprehensiveFeedback(input);

        expect(result.spec).toBeDefined();
        expect(result.errorAnalysis).toBeDefined();
        expect(result.errorAnalysis?.errorType).toBe("ai_service_error");
        expect(result.errorAnalysis?.suggestions).toContain(
          "Check if the AI service is running"
        );
        expect(result.warningAnalysis.uncertainAreas).toContain(
          "Parsing failed"
        );
        expect(result.loggedAssumptions).toBe(false);
      });
    });
  });

  describe("Universal Parser Enhanced Feedback", () => {
    describe("Provider-Specific Features", () => {
      it("should provide provider-specific error suggestions", () => {
        const error = new Error("API key invalid");
        const input = "Test API";

        const analysis = universalParser.getParsingErrors(input, error);

        expect(analysis.providerSpecific).toBeDefined();
        expect(analysis.providerSpecific.length).toBeGreaterThan(0);
        // Since we're using MockProvider, check for generic suggestions
        expect(analysis.providerSpecific).toContain(
          "Check MockProvider service configuration"
        );
      });

      it("should include provider notes in warning analysis", () => {
        const spec: LoadTestSpec = {
          id: "test_123",
          name: "Test",
          description: "Test",
          testType: "baseline",
          requests: [
            {
              method: "GET",
              url: "https://api.example.com/test",
            },
          ],
          loadPattern: {
            type: "constant",
            virtualUsers: 10,
          },
          duration: { value: 30, unit: "seconds" },
        };

        const context = {
          originalInput: "Test API",
          cleanedInput: "Test API",
          extractedComponents: {
            methods: [],
            urls: [],
            headers: [],
            bodies: [],
            counts: [],
          },
          inferredFields: {},
          ambiguities: [],
          confidence: 0.8,
        };

        const warnings = universalParser.getParsingWarnings(spec, context, 0.8);

        expect(warnings.providerNotes).toContain("Parsed using MockProvider");
      });

      it("should provide comprehensive feedback with provider context", async () => {
        const input = "Load test GET /api/health with 15 users";

        const result =
          await universalParser.parseCommandWithComprehensiveFeedback(input);

        expect(result.spec).toBeDefined();
        expect(result.warningAnalysis.providerNotes).toContain(
          "Parsed using MockProvider"
        );
        expect(result.processingSteps).toContain("AI parsing (MockProvider)");
      });
    });
  });
});

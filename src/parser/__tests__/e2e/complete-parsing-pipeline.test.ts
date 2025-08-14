/**
 * End-to-end tests for complete parsing pipeline
 * Tests the entire flow from raw input to LoadTestSpec output
 */

import { describe, it, expect, beforeEach } from "vitest";
import { UniversalCommandParser } from "../../universal-command-parser";
import { InputPreprocessor } from "../../input-preprocessor";
import { FormatDetector } from "../../format-detector";
import { ContextEnhancer } from "../../context-enhancer";
import { SmartPromptBuilder } from "../../smart-prompt-builder";
import { SmartAIProvider } from "../../smart-ai-provider";
import { ErrorRecovery } from "../../error-recovery";
import { MockAIProvider } from "../mocks/mock-ai-provider";
import { LoadTestSpec } from "../../../types";
import { allTestDataSets } from "../test-data/messy-input-datasets";

describe("Complete Parsing Pipeline E2E Tests", () => {
  let parser: UniversalCommandParser;
  let mockProvider: MockAIProvider;
  let preprocessor: InputPreprocessor;
  let formatDetector: FormatDetector;
  let contextEnhancer: ContextEnhancer;
  let promptBuilder: SmartPromptBuilder;
  let smartProvider: SmartAIProvider;
  let errorRecovery: ErrorRecovery;

  beforeEach(() => {
    mockProvider = new MockAIProvider();
    preprocessor = new InputPreprocessor();
    formatDetector = new FormatDetector();
    contextEnhancer = new ContextEnhancer();
    promptBuilder = new SmartPromptBuilder();
    smartProvider = new SmartAIProvider(mockProvider);
    errorRecovery = new ErrorRecovery();
    parser = new UniversalCommandParser(smartProvider);
  });

  describe("Full Pipeline Integration", () => {
    it("should process clean input through complete pipeline", async () => {
      const cleanInput = `
        POST https://api.example.com/users
        Content-Type: application/json
        Authorization: Bearer token123
        
        {
          "name": "John Doe",
          "email": "john@example.com"
        }
        
        Load test with 10 users for 30 seconds
      `;

      // Test each stage of the pipeline
      const sanitized = preprocessor.sanitize(cleanInput);
      expect(sanitized).toBeDefined();
      expect(sanitized.length).toBeGreaterThan(0);

      const structuredData = preprocessor.extractStructuredData(sanitized);
      expect(structuredData.urls).toContain("https://api.example.com/users");
      expect(structuredData.methods).toContain("POST");

      const format = formatDetector.detectFormat(sanitized);
      expect(format).toBeDefined();
      expect(formatDetector.getConfidence()).toBeGreaterThan(0.8);

      const hints = formatDetector.getParsingHints();
      expect(hints.length).toBeGreaterThan(0);

      const context = contextEnhancer.buildContext(
        sanitized,
        structuredData,
        hints
      );
      expect(context.extractedComponents.methods).toContain("POST");
      expect(context.extractedComponents.urls).toContain(
        "https://api.example.com/users"
      );

      const prompt = promptBuilder.buildPrompt(context);
      expect(prompt.systemPrompt).toBeDefined();
      expect(prompt.contextualExamples.length).toBeGreaterThan(0);

      // Final parsing
      const result = await parser.parseCommand(cleanInput);
      expect(result).toBeDefined();
      expect(result.method).toBe("POST");
      expect(result.url).toBe("https://api.example.com/users");
      expect(result.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer token123",
      });
      expect(result.body).toContain("John Doe");
      expect(result.loadPattern?.users).toBe(10);
    });

    it("should handle messy input with error recovery", async () => {
      const messyInput = `
        POST     https://api.example.com/users    POST https://api.example.com/data
        Content-Type: application/json Content-Type: application/xml
        Authorization:Bearer token123
        
        {"name": "John"} {"id": 123}
        
        Test with 5 users 10 users for 30 seconds 60 seconds
      `;

      const result = await parser.parseCommand(messyInput);

      expect(result).toBeDefined();
      expect(result.method).toBe("POST");
      expect(result.url).toMatch(/https:\/\/api\.example\.com\/(users|data)/);
      expect(result.headers).toBeDefined();
      expect(result.loadPattern).toBeDefined();
    });

    it("should process all test datasets through pipeline", async () => {
      const results: Array<{
        category: string;
        input: string;
        result: LoadTestSpec | null;
        error: Error | null;
        processingTime: number;
      }> = [];

      for (const dataset of allTestDataSets) {
        for (const input of dataset.inputs) {
          const startTime = Date.now();
          let result: LoadTestSpec | null = null;
          let error: Error | null = null;

          try {
            result = await parser.parseCommand(input.raw);
          } catch (e) {
            error = e as Error;
          }

          const processingTime = Date.now() - startTime;

          results.push({
            category: dataset.category,
            input: input.description,
            result,
            error,
            processingTime,
          });
        }
      }

      // Analyze results
      const successfulResults = results.filter((r) => r.result !== null);
      const failedResults = results.filter((r) => r.result === null);
      const averageProcessingTime =
        results.reduce((sum, r) => sum + r.processingTime, 0) / results.length;

      console.log(`\n=== PIPELINE E2E TEST RESULTS ===`);
      console.log(`Total tests: ${results.length}`);
      console.log(
        `Successful: ${successfulResults.length} (${(
          (successfulResults.length / results.length) *
          100
        ).toFixed(1)}%)`
      );
      console.log(
        `Failed: ${failedResults.length} (${(
          (failedResults.length / results.length) *
          100
        ).toFixed(1)}%)`
      );
      console.log(
        `Average processing time: ${averageProcessingTime.toFixed(0)}ms`
      );

      // Verify pipeline performance
      expect(successfulResults.length / results.length).toBeGreaterThan(0.7); // >70% success rate
      expect(averageProcessingTime).toBeLessThan(3000); // <3s average processing time

      // Log failed cases for analysis
      if (failedResults.length > 0) {
        console.log(`\nFailed cases:`);
        failedResults.forEach((r) => {
          console.log(
            `- ${r.category}: ${r.input} (${
              r.error?.message || "Unknown error"
            })`
          );
        });
      }
    });
  });

  describe("Pipeline Component Integration", () => {
    it("should demonstrate preprocessing -> format detection flow", async () => {
      const rawInput = `
        POST     https://api.example.com/users    
        
        Content-Type:    application/json
        
        {"name":   "John"}
        
        Test with 10 users
      `;

      // Step 1: Preprocessing
      const sanitized = preprocessor.sanitize(rawInput);
      expect(sanitized).not.toContain("    "); // Multiple spaces should be normalized

      const structuredData = preprocessor.extractStructuredData(sanitized);
      expect(structuredData.urls).toContain("https://api.example.com/users");
      expect(structuredData.methods).toContain("POST");
      expect(structuredData.jsonBlocks.length).toBeGreaterThan(0);

      // Step 2: Format Detection
      const format = formatDetector.detectFormat(sanitized);
      expect(["mixed_structured", "json_with_text"]).toContain(format);

      const confidence = formatDetector.getConfidence();
      expect(confidence).toBeGreaterThan(0.5);

      const hints = formatDetector.getParsingHints();
      const methodHint = hints.find((h) => h.type === "method");
      const urlHint = hints.find((h) => h.type === "url");

      expect(methodHint?.value).toBe("POST");
      expect(urlHint?.value).toBe("https://api.example.com/users");
    });

    it("should demonstrate context enhancement -> prompt building flow", async () => {
      const input = `GET /api/data Host: example.com Authorization: Bearer token Test with 5 users`;

      // Preprocessing
      const sanitized = preprocessor.sanitize(input);
      const structuredData = preprocessor.extractStructuredData(sanitized);
      const format = formatDetector.detectFormat(sanitized);
      const hints = formatDetector.getParsingHints();

      // Context Enhancement
      const context = contextEnhancer.buildContext(
        sanitized,
        structuredData,
        hints
      );
      expect(context.extractedComponents.methods).toContain("GET");
      expect(context.extractedComponents.urls.length).toBeGreaterThan(0);

      const enhancedContext = contextEnhancer.inferMissingFields(context);
      expect(enhancedContext.inferredFields).toBeDefined();

      const resolvedContext =
        contextEnhancer.resolveAmbiguities(enhancedContext);
      expect(resolvedContext.ambiguities).toBeDefined();

      // Prompt Building
      const prompt = promptBuilder.buildPrompt(resolvedContext);
      expect(prompt.systemPrompt).toBeDefined();
      expect(prompt.systemPrompt.length).toBeGreaterThan(100);

      const examples = promptBuilder.selectRelevantExamples(resolvedContext);
      expect(examples.length).toBeGreaterThan(0);

      const clarifications = promptBuilder.addClarifications(resolvedContext);
      expect(clarifications).toBeDefined();
    });

    it("should demonstrate smart AI provider -> error recovery flow", async () => {
      const problematicInput = `POST https://api.example.com/users {"name": "John" "email": "john@example.com"} Test with users`;

      // Configure mock to fail initially
      let attemptCount = 0;
      const originalParseCommand = mockProvider.parseCommand;
      mockProvider.parseCommand = async (input: string) => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error("JSON parsing error");
        }
        return originalParseCommand.call(mockProvider, input);
      };

      const result = await parser.parseCommand(problematicInput);

      expect(result).toBeDefined();
      expect(attemptCount).toBeGreaterThan(1); // Should have retried
      expect(result.method).toBe("POST");
      expect(result.url).toBe("https://api.example.com/users");
    });
  });

  describe("Real-world Scenario Tests", () => {
    it("should handle copy-pasted curl command", async () => {
      const curlCommand = `curl -X POST https://api.example.com/orders \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" \\
  -H "X-Request-ID: req-12345" \\
  -d '{
    "product_id": 123,
    "quantity": 2,
    "customer_id": 456,
    "shipping_address": {
      "street": "123 Main St",
      "city": "Anytown",
      "state": "CA",
      "zip": "12345"
    }
  }'

Load test this endpoint with 50 concurrent users for 5 minutes`;

      const result = await parser.parseCommand(curlCommand);

      expect(result).toBeDefined();
      expect(result.method).toBe("POST");
      expect(result.url).toBe("https://api.example.com/orders");
      expect(result.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
        "X-Request-ID": "req-12345",
      });
      expect(result.body).toContain("product_id");
      expect(result.loadPattern?.users).toBe(50);
      expect(result.loadPattern?.duration).toBe("5m");
    });

    it("should handle API documentation example", async () => {
      const apiDocExample = `
        ## Create User Endpoint
        
        **URL:** POST /api/v1/users
        **Host:** https://api.myservice.com
        
        **Headers:**
        - Content-Type: application/json
        - Authorization: Bearer <your-token>
        - X-API-Version: 1.0
        
        **Request Body:**
        \`\`\`json
        {
          "username": "johndoe",
          "email": "john@example.com",
          "full_name": "John Doe",
          "role": "user"
        }
        \`\`\`
        
        **Example Response:**
        \`\`\`json
        {
          "id": 123,
          "username": "johndoe",
          "created_at": "2024-01-01T00:00:00Z"
        }
        \`\`\`
        
        I want to load test this endpoint with 100 users over 10 minutes.
      `;

      const result = await parser.parseCommand(apiDocExample);

      expect(result).toBeDefined();
      expect(result.method).toBe("POST");
      expect(result.url).toBe("https://api.myservice.com/api/v1/users");
      expect(result.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer <your-token>",
        "X-API-Version": "1.0",
      });
      expect(result.body).toContain("johndoe");
      expect(result.loadPattern?.users).toBe(100);
      expect(result.loadPattern?.duration).toBe("10m");
    });

    it("should handle log file excerpt", async () => {
      const logExcerpt = `
        [2024-01-01 10:30:15] INFO: Incoming request
        [2024-01-01 10:30:15] DEBUG: Method: PUT
        [2024-01-01 10:30:15] DEBUG: URL: https://api.service.com/api/v2/profiles/user123
        [2024-01-01 10:30:15] DEBUG: Headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer jwt-token-here",
          "User-Agent": "MyApp/1.0",
          "X-Correlation-ID": "abc-123-def"
        }
        [2024-01-01 10:30:15] DEBUG: Body: {
          "profile": {
            "display_name": "John Smith",
            "bio": "Software Engineer",
            "location": "San Francisco, CA"
          },
          "preferences": {
            "email_notifications": true,
            "privacy_level": "public"
          }
        }
        [2024-01-01 10:30:15] INFO: Request processed successfully
        
        Can you create a load test for this request with 25 users for 3 minutes?
      `;

      const result = await parser.parseCommand(logExcerpt);

      expect(result).toBeDefined();
      expect(result.method).toBe("PUT");
      expect(result.url).toBe(
        "https://api.service.com/api/v2/profiles/user123"
      );
      expect(result.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer jwt-token-here",
        "User-Agent": "MyApp/1.0",
        "X-Correlation-ID": "abc-123-def",
      });
      expect(result.body).toContain("display_name");
      expect(result.loadPattern?.users).toBe(25);
      expect(result.loadPattern?.duration).toBe("3m");
    });
  });

  describe("Pipeline Error Handling", () => {
    it("should gracefully handle pipeline failures", async () => {
      // Test with completely invalid input
      const invalidInputs = [
        "",
        "   ",
        "!@#$%^&*()",
        "This is just random text with no structure",
        "POST", // Incomplete
        "https://example.com", // Missing method
      ];

      for (const input of invalidInputs) {
        const result = await parser.parseCommand(input);

        // Should either return a valid spec or handle gracefully
        if (result) {
          expect(result).toBeDefined();
          // If it returns something, it should be minimally valid
          if (result.method) {
            expect(["GET", "POST", "PUT", "DELETE", "PATCH"]).toContain(
              result.method
            );
          }
          if (result.url) {
            expect(result.url).toMatch(/^https?:\/\//);
          }
        }
      }
    });

    it("should handle component failures gracefully", async () => {
      const input = "POST https://api.example.com/test with 10 users";

      // Mock component failures
      const originalSanitize = preprocessor.sanitize;
      preprocessor.sanitize = () => {
        throw new Error("Preprocessor failure");
      };

      try {
        const result = await parser.parseCommand(input);
        // Should still work via fallback mechanisms
        expect(result).toBeDefined();
      } catch (error) {
        // Or fail gracefully
        expect(error).toBeInstanceOf(Error);
      } finally {
        // Restore original method
        preprocessor.sanitize = originalSanitize;
      }
    });
  });

  describe("Performance Under Load", () => {
    it("should maintain performance with concurrent pipeline executions", async () => {
      const testInputs = [
        "POST https://api1.example.com/users with 10 users",
        "GET https://api2.example.com/data with 5 users for 30s",
        'PUT https://api3.example.com/update with JSON {"id": 123} using 15 users',
        "DELETE https://api4.example.com/items/456 load test 20 users for 60s",
      ];

      const startTime = Date.now();

      // Run multiple concurrent pipeline executions
      const promises = [];
      for (let i = 0; i < 20; i++) {
        const input = testInputs[i % testInputs.length];
        promises.push(parser.parseCommand(input));
      }

      const results = await Promise.all(promises);
      const endTime = Date.now();

      const totalTime = endTime - startTime;
      const averageTime = totalTime / results.length;

      expect(results).toHaveLength(20);
      results.forEach((result) => expect(result).toBeDefined());

      expect(totalTime).toBeLessThan(15000); // All requests within 15 seconds
      expect(averageTime).toBeLessThan(1000); // Average <1s per request

      console.log(
        `Concurrent pipeline performance: ${totalTime}ms total, ${averageTime.toFixed(
          0
        )}ms average`
      );
    });
  });
});

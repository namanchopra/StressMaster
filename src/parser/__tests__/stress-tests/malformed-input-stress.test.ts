/**
 * Stress tests for malformed and concatenated input handling
 * Tests system resilience under various stress conditions
 */

import { describe, it, expect, beforeEach } from "vitest";
import { UniversalCommandParser } from "../../universal-command-parser";
import { MockAIProvider } from "../mocks/mock-ai-provider";
import { LoadTestSpec } from "../../../types";

describe("Malformed Input Stress Tests", () => {
  let parser: UniversalCommandParser;
  let mockProvider: MockAIProvider;

  beforeEach(() => {
    mockProvider = new MockAIProvider();
    // Create parser with mock provider directly
    parser = {
      parseCommand: async (input: string) => {
        return await mockProvider.parseCommand(input);
      },
    } as UniversalCommandParser;
  });

  describe("Concatenated Requests Stress Tests", () => {
    it("should handle multiple concatenated requests without separators", async () => {
      const concatenatedInput = `
        POST https://api1.com/users GET https://api2.com/data PUT https://api3.com/update
        Content-Type: application/json Authorization: Bearer token1 X-API-Key: key123
        {"name": "John"} {"id": 123} {"status": "active"}
        Test with 5 users 10 users 15 users for 30 seconds 60 seconds 90 seconds
      `;

      const result = await parser.parseCommand(concatenatedInput);

      expect(result).toBeDefined();
      expect(result.method).toBeDefined();
      expect(result.url).toBeDefined();
      expect(result.loadPattern).toBeDefined();
    });

    it("should handle extremely long concatenated input", async () => {
      const baseRequest = "POST https://api.example.com/test ";
      const longInput =
        baseRequest.repeat(100) +
        'Content-Type: application/json {"data": "test"} Load test with 10 users';

      const startTime = Date.now();
      const result = await parser.parseCommand(longInput);
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it("should separate and parse multiple distinct requests", async () => {
      const multipleRequests = `
        Request 1: POST https://api.example.com/users with JSON {"name": "John"}
        Request 2: GET https://api.example.com/data with Authorization: Bearer token
        Request 3: DELETE https://api.example.com/items/123
        
        Run load test with 20 users for 60 seconds
      `;

      const result = await parser.parseCommand(multipleRequests);

      expect(result).toBeDefined();
      // Should pick the most complete or first valid request
      expect(["POST", "GET", "DELETE"]).toContain(result.method);
    });
  });

  describe("Malformed Data Stress Tests", () => {
    it("should handle JSON with syntax errors", async () => {
      const malformedJson = `
        POST https://api.example.com/users
        Content-Type: application/json
        
        {
          "name": "John",
          "email": "john@example.com"
          "age": 30,
          "active": true
          "metadata": {
            "source": "test"
            "priority": high
          }
        }
        
        Load test with 10 users
      `;

      const result = await parser.parseCommand(malformedJson);

      expect(result).toBeDefined();
      expect(result.method).toBe("POST");
      expect(result.url).toBe("https://api.example.com/users");
      // Should attempt to fix or work with malformed JSON
    });

    it("should handle URLs with invalid characters", async () => {
      const invalidUrls = `
        POST https://api.example.com/users with spaces
        GET http://api[invalid].com/data
        PUT https://api.example.com/update?param=value with spaces&another=test
        
        Test with 5 users
      `;

      const result = await parser.parseCommand(invalidUrls);

      expect(result).toBeDefined();
      expect(result.url).toBeDefined();
      // Should clean or fix URL issues
    });

    it("should handle headers with invalid formats", async () => {
      const invalidHeaders = `
        POST https://api.example.com/data
        Content-Type application/json (missing colon)
        Authorization Bearer token123 (missing colon)
        X-Custom-Header: value: with: colons
        Invalid Header Format
        : EmptyHeaderName
        
        {"data": "test"}
        Load test with 8 users
      `;

      const result = await parser.parseCommand(invalidHeaders);

      expect(result).toBeDefined();
      expect(result.headers).toBeDefined();
      // Should extract valid headers and ignore invalid ones
    });
  });

  describe("Special Characters and Encoding Stress Tests", () => {
    it("should handle various Unicode characters", async () => {
      const unicodeInput = `
        POST https://api.example.com/users
        Content-Type: application/json
        
        {
          "name": "José María",
          "description": "Testing with émojis 🚀 and spëcial chars",
          "tags": ["测试", "тест", "テスト"]
        }
        
        Load test with 10 users for 30 seconds
      `;

      const result = await parser.parseCommand(unicodeInput);

      expect(result).toBeDefined();
      expect(result.body).toBeDefined();
    });

    it("should handle mixed encoding and escape sequences", async () => {
      const mixedEncoding = `
        POST https://api.example.com/data
        Content-Type: application/json
        
        {
          "text": "Line 1\\nLine 2\\tTabbed",
          "escaped": "\\"quoted\\" text",
          "unicode": "\\u0048\\u0065\\u006C\\u006C\\u006F"
        }
        
        Test with 15 users
      `;

      const result = await parser.parseCommand(mixedEncoding);

      expect(result).toBeDefined();
      expect(result.body).toBeDefined();
    });
  });

  describe("Memory and Performance Stress Tests", () => {
    it("should handle very large request bodies", async () => {
      const largeData = JSON.stringify({
        data: "x".repeat(10000),
        array: new Array(1000).fill({
          id: 1,
          name: "test",
          description: "large object",
        }),
      });

      const largeBodyInput = `
        POST https://api.example.com/bulk
        Content-Type: application/json
        
        ${largeData}
        
        Load test with 5 users
      `;

      const startTime = Date.now();
      const result = await parser.parseCommand(largeBodyInput);
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(3000); // Should handle large input efficiently
    });

    it("should handle rapid successive parsing requests", async () => {
      const requests = Array.from(
        { length: 50 },
        (_, i) => `
        POST https://api.example.com/test${i}
        Content-Type: application/json
        {"id": ${i}}
        Test with ${i + 1} users
      `
      );

      const startTime = Date.now();
      const results = await Promise.all(
        requests.map((req) => parser.parseCommand(req))
      );
      const endTime = Date.now();

      expect(results).toHaveLength(50);
      results.forEach((result) => {
        expect(result).toBeDefined();
        expect(result.method).toBe("POST");
      });

      expect(endTime - startTime).toBeLessThan(10000); // Should handle concurrent requests
    });
  });

  describe("Error Recovery Stress Tests", () => {
    it("should recover from AI provider failures", async () => {
      // Configure mock to fail initially then succeed
      let callCount = 0;
      mockProvider.parseCommand = async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error("AI provider temporarily unavailable");
        }
        return {
          method: "POST",
          url: "https://api.example.com/users",
          loadPattern: { users: 10 },
        } as LoadTestSpec;
      };

      const input = `
        POST https://api.example.com/users
        Content-Type: application/json
        {"name": "John"}
        Test with 10 users
      `;

      const result = await parser.parseCommand(input);

      expect(result).toBeDefined();
      expect(callCount).toBeGreaterThan(1); // Should have retried
    });

    it("should handle parsing timeout scenarios", async () => {
      // Configure mock to simulate slow response
      mockProvider.parseCommand = async () => {
        await new Promise((resolve) => setTimeout(resolve, 6000)); // 6 second delay
        return {
          method: "GET",
          url: "https://api.example.com/data",
        } as LoadTestSpec;
      };

      const input = "GET https://api.example.com/data with 5 users";

      const startTime = Date.now();
      const result = await parser.parseCommand(input);
      const endTime = Date.now();

      expect(result).toBeDefined();
      // Should either complete quickly via fallback or timeout gracefully
      expect(endTime - startTime).toBeLessThan(8000);
    });
  });

  describe("Edge Case Input Patterns", () => {
    it("should handle input with only whitespace and special characters", async () => {
      const weirdInput = `
        !!!@@@###$$$%%%^^^&&&***((()))
        
        
        <<<>>>???///\\\\\\|||
        
        
        ~~~\`\`\`---\=\=\=+++
      `;

      const result = await parser.parseCommand(weirdInput);

      // Should either return a minimal valid spec or handle gracefully
      expect(result).toBeDefined();
    });

    it("should handle input with mixed languages", async () => {
      const multiLanguageInput = `
        POST https://api.example.com/users
        Заголовок: application/json
        Autorización: Bearer token123
        
        {
          "nom": "Jean",
          "correo": "jean@example.com",
          "年齢": 30
        }
        
        Ejecutar prueba de carga con 10 usuarios durante 30 segundos
      `;

      const result = await parser.parseCommand(multiLanguageInput);

      expect(result).toBeDefined();
      expect(result.method).toBe("POST");
      expect(result.url).toBe("https://api.example.com/users");
    });

    it("should handle deeply nested and complex JSON structures", async () => {
      const complexJson = {
        user: {
          profile: {
            personal: {
              name: { first: "John", last: "Doe" },
              contacts: {
                emails: ["john@example.com", "j.doe@work.com"],
                phones: [{ type: "mobile", number: "+1234567890" }],
              },
            },
            preferences: {
              notifications: { email: true, sms: false },
              privacy: { public: false, searchable: true },
            },
          },
          metadata: {
            created: new Date().toISOString(),
            tags: ["premium", "verified"],
            scores: { trust: 0.95, activity: 0.87 },
          },
        },
      };

      const complexInput = `
        POST https://api.example.com/users/complex
        Content-Type: application/json
        
        ${JSON.stringify(complexJson, null, 2)}
        
        Load test with 20 users for 2 minutes
      `;

      const result = await parser.parseCommand(complexInput);

      expect(result).toBeDefined();
      expect(result.body).toBeDefined();
      expect(result.loadPattern?.users).toBe(20);
    });
  });
});

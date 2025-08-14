/**
 * Mock AI Provider for testing
 * Provides predictable responses for test scenarios
 */

// @ts-nocheck

import { AIProvider } from "../../ai-provider";
import { LoadTestSpec } from "../../../types";

export class MockAIProvider {
  private responses: Map<string, LoadTestSpec> = new Map();
  private shouldFail: boolean = false;
  private failureCount: number = 0;
  private maxFailures: number = 0;

  constructor() {
    this.setupDefaultResponses();
  }

  async parseCommand(input: string): Promise<LoadTestSpec> {
    // Simulate failure scenarios
    if (this.shouldFail && this.failureCount < this.maxFailures) {
      this.failureCount++;
      throw new Error("Mock AI provider failure");
    }

    // Reset failure count after max failures reached
    if (this.failureCount >= this.maxFailures) {
      this.shouldFail = false;
      this.failureCount = 0;
    }

    // Try to find a matching response
    const matchingKey = Array.from(this.responses.keys()).find((key) =>
      input.toLowerCase().includes(key.toLowerCase())
    );

    if (matchingKey) {
      return this.responses.get(matchingKey)!;
    }

    // Default parsing logic for unmatched inputs
    return this.parseInputHeuristically(input);
  }

  // Test helper methods
  setResponse(inputPattern: string, response: LoadTestSpec): void {
    this.responses.set(inputPattern, response);
  }

  simulateFailure(maxFailures: number = 1): void {
    this.shouldFail = true;
    this.maxFailures = maxFailures;
    this.failureCount = 0;
  }

  clearFailures(): void {
    this.shouldFail = false;
    this.failureCount = 0;
    this.maxFailures = 0;
  }

  private setupDefaultResponses(): void {
    // Common test patterns
    this.responses.set("POST https://api.example.com/users", {
      id: "test-1",
      name: "POST Users Test",
      description: "Test POST request to users endpoint",
      testType: "baseline",
      duration: { value: 30, unit: "seconds" },
      requests: [
        {
          method: "POST",
          url: "https://api.example.com/users",
          headers: { "Content-Type": "application/json" },
          body: '{"name":"John"}',
        },
      ],
      loadPattern: { type: "constant", virtualUsers: 10 },
    });

    this.responses.set("GET https://api.example.com/data", {
      id: "test-2",
      name: "GET Data Test",
      description: "Test GET request to data endpoint",
      testType: "baseline",
      duration: { value: 60, unit: "seconds" },
      requests: [
        {
          method: "GET",
          url: "https://api.example.com/data",
          headers: { Authorization: "Bearer token" },
        },
      ],
      loadPattern: { type: "constant", virtualUsers: 5 },
    });

    this.responses.set("PUT https://api.example.com/update", {
      method: "PUT",
      url: "https://api.example.com/update",
      headers: { "Content-Type": "application/json" },
      body: '{"id":123}',
      loadPattern: { type: "constant", virtualUsers: 15 },
    });

    this.responses.set("DELETE https://api.example.com/items", {
      method: "DELETE",
      url: "https://api.example.com/items/456",
      loadPattern: { type: "constant", virtualUsers: 20 },
    });

    // Curl command responses
    this.responses.set("curl -X POST", {
      method: "POST",
      url: "https://api.example.com/orders",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
        "X-Request-ID": "req-123",
      },
      body: '{"product_id":123,"quantity":2}',
      loadPattern: { type: "constant", virtualUsers: 50 },
    });

    // Complex JSON responses
    this.responses.set("complex", {
      method: "POST",
      url: "https://api.example.com/complex",
      headers: { "Content-Type": "application/json" },
      body: '{"user":{"name":"John Doe","email":"john@example.com"}}',
      loadPattern: { type: "constant", virtualUsers: 25 },
    });
  }

  private parseInputHeuristically(input: string): LoadTestSpec {
    const spec: any = {};

    // Extract method
    const methodMatch = input.match(/\b(GET|POST|PUT|DELETE|PATCH)\b/i);
    spec.method = methodMatch ? methodMatch[1].toUpperCase() : "GET";

    // Extract URL
    const urlMatch = input.match(/https?:\/\/[^\s]+/);
    spec.url = urlMatch ? urlMatch[0] : "https://api.example.com/default";

    // Extract headers
    const headers: Record<string, string> = {};

    // Content-Type
    const contentTypeMatch = input.match(/Content-Type:\s*([^\n\r]+)/i);
    if (contentTypeMatch) {
      headers["Content-Type"] = contentTypeMatch[1].trim();
    }

    // Authorization
    const authMatch = input.match(/Authorization:\s*([^\n\r]+)/i);
    if (authMatch) {
      headers["Authorization"] = authMatch[1].trim();
    }

    // Custom headers (X-*)
    const customHeaderMatches = input.matchAll(/([Xx]-[^:]+):\s*([^\n\r]+)/g);
    for (const match of customHeaderMatches) {
      headers[match[1]] = match[2].trim();
    }

    if (Object.keys(headers).length > 0) {
      spec.headers = headers;
    }

    // Extract JSON body
    const jsonMatch = input.match(/\{[^}]*\}/);
    if (jsonMatch) {
      try {
        // Try to parse and reformat JSON
        const parsed = JSON.parse(jsonMatch[0]);
        spec.body = JSON.stringify(parsed);
      } catch {
        // Use as-is if parsing fails
        spec.body = jsonMatch[0];
      }
    }

    // Extract load pattern
    const loadPattern: any = {};

    // Users
    const usersMatch = input.match(/(\d+)\s+users?/i);
    if (usersMatch) {
      loadPattern.users = parseInt(usersMatch[1]);
    } else {
      loadPattern.users = 1; // Default
    }

    // Duration
    const durationMatch = input.match(
      /(\d+)\s*(seconds?|minutes?|hours?|s|m|h)/i
    );
    if (durationMatch) {
      const value = durationMatch[1];
      const unit = durationMatch[2].toLowerCase();

      if (unit.startsWith("s")) {
        loadPattern.duration = `${value}s`;
      } else if (unit.startsWith("m")) {
        loadPattern.duration = `${value}m`;
      } else if (unit.startsWith("h")) {
        loadPattern.duration = `${value}h`;
      }
    }

    spec.loadPattern = loadPattern;

    return spec as LoadTestSpec;
  }
}

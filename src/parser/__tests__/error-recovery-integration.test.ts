import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ErrorRecoverySystem,
  ParseError,
  RecoveryStrategy,
  RecoveryContext,
} from "../error-recovery";
import { IntelligentFallbackParser } from "../intelligent-fallback-parser";
import { LoadTestSpec } from "../../types";

describe("Error Recovery Integration", () => {
  let errorRecovery: ErrorRecoverySystem;
  let fallbackParser: IntelligentFallbackParser;

  beforeEach(() => {
    errorRecovery = new ErrorRecoverySystem();
    fallbackParser = new IntelligentFallbackParser();
  });

  describe("Core Error Recovery Functionality", () => {
    it("should classify and recover from AI parsing errors", async () => {
      const error = new Error("AI provider timeout");
      const parseError = errorRecovery.classifyError(error, "ai");

      expect(parseError.level).toBe("ai");
      expect(parseError.type).toBe("ai_timeout");
      expect(parseError.recoveryStrategy.strategy).toBe("retry");
      expect(parseError.recoveryStrategy.confidence).toBeGreaterThan(0.7);
    });

    it("should provide intelligent fallback parsing", () => {
      const input = "GET https://api.example.com/users with 10 users for 30s";
      const result = fallbackParser.parse(input);

      expect(result.spec.requests).toHaveLength(1);
      expect(result.spec.requests[0].method).toBe("GET");
      expect(result.spec.requests[0].url).toContain("api.example.com");
      expect(result.spec.loadPattern.rate).toBe(10);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("should handle complete recovery workflow", async () => {
      const parseError: ParseError = {
        level: "ai",
        type: "network_error",
        message: "Network error",
        suggestions: ["Check connection"],
        recoveryStrategy: {
          canRecover: true,
          strategy: "fallback",
          confidence: 0.8,
          estimatedSuccess: 0.8,
        },
      };

      const recoveryContext: RecoveryContext = {
        originalInput: "POST https://api.test.com/data with 5 users",
        previousAttempts: [],
        availableStrategies: [],
      };

      const mockResult: LoadTestSpec = {
        name: "test",
        requests: [
          {
            method: "POST",
            url: "https://api.test.com/data",
            headers: {},
            body: "",
          },
        ],
        loadPattern: { type: "constant", duration: "30s", rate: 5 },
      };

      const recoveryFunction = vi.fn().mockResolvedValue(mockResult);

      const result = await errorRecovery.recover(
        parseError,
        recoveryContext,
        recoveryFunction
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(mockResult);
      expect(result.confidence).toBe(0.8);
      expect(recoveryFunction).toHaveBeenCalledWith(
        parseError.recoveryStrategy,
        recoveryContext
      );
    });

    it("should track recovery statistics", async () => {
      const parseError: ParseError = {
        level: "validation",
        type: "schema_error",
        message: "Schema validation failed",
        suggestions: [],
        recoveryStrategy: {
          canRecover: true,
          strategy: "enhance_prompt",
          confidence: 0.6,
          estimatedSuccess: 0.6,
        },
      };

      const recoveryContext: RecoveryContext = {
        originalInput: "test input",
        previousAttempts: [],
        availableStrategies: [],
      };

      const recoveryFunction = vi
        .fn()
        .mockRejectedValue(new Error("Recovery failed"));

      await errorRecovery.recover(
        parseError,
        recoveryContext,
        recoveryFunction
      );

      const stats = errorRecovery.getRecoveryStats();
      expect(stats.totalAttempts).toBeGreaterThan(0);
      expect(stats.activeRecoveries).toBeGreaterThan(0);
    });
  });

  describe("Fallback Parser Core Features", () => {
    it("should extract basic HTTP information", () => {
      const input = "POST https://example.com/api";
      const result = fallbackParser.parse(input);

      expect(result.spec.requests[0].method).toBe("POST");
      expect(result.spec.requests[0].url).toBe("https://example.com/api");
    });

    it("should handle missing information gracefully", () => {
      const input = "some random text";
      const result = fallbackParser.parse(input);

      expect(result.spec.requests).toHaveLength(1);
      expect(result.spec.requests[0].url).toBe("http://example.com");
      expect(result.spec.requests[0].method).toBe("GET");
      expect(result.confidence).toBeLessThan(0.5);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("should provide reasonable defaults", () => {
      const input = "https://api.test.com";
      const result = fallbackParser.parse(input);

      expect(result.spec.loadPattern.type).toBe("constant");
      expect(result.spec.loadPattern.rate).toBe(10);
      expect(result.spec.loadPattern.duration).toBe("30s");
      expect(result.assumptions).toContain(
        "Using default load pattern: 10 requests/second for 30 seconds"
      );
    });
  });

  describe("Error Classification", () => {
    it("should classify different error types correctly", () => {
      const testCases = [
        {
          error: new Error("Rate limit exceeded"),
          level: "ai" as const,
          expectedType: "rate_limit",
        },
        {
          error: new Error("Invalid format detected"),
          level: "input" as const,
          expectedType: "invalid_format",
        },
        {
          error: new Error("Schema validation failed"),
          level: "validation" as const,
          expectedType: "schema_validation_error",
        },
        {
          error: new Error("Network connection failed"),
          level: "ai" as const,
          expectedType: "network_error",
        },
      ];

      testCases.forEach(({ error, level, expectedType }) => {
        const parseError = errorRecovery.classifyError(error, level);
        expect(parseError.type).toBe(expectedType);
        expect(parseError.level).toBe(level);
        expect(parseError.recoveryStrategy.canRecover).toBe(true);
      });
    });

    it("should provide appropriate recovery strategies", () => {
      const rateLimitError = errorRecovery.classifyError(
        new Error("Rate limit exceeded"),
        "ai"
      );
      expect(rateLimitError.recoveryStrategy.strategy).toBe("retry");
      expect(rateLimitError.recoveryStrategy.confidence).toBe(0.9);

      const formatError = errorRecovery.classifyError(
        new Error("Invalid format"),
        "input"
      );
      expect(formatError.recoveryStrategy.strategy).toBe("fallback");
      expect(formatError.recoveryStrategy.confidence).toBe(0.8);
    });
  });
});

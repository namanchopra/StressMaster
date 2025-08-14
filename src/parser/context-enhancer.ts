/**
 * Context enhancement engine for building rich parsing context
 * Handles context building, field inference, and ambiguity resolution
 */

import { StructuredData } from "./input-preprocessor";
import { ParsingHint } from "./format-detector";

export interface Ambiguity {
  field: string;
  possibleValues: string[];
  reason: string;
}

export interface ParseContext {
  originalInput: string;
  cleanedInput: string;
  extractedComponents: {
    methods: string[];
    urls: string[];
    headers: Record<string, string>[];
    bodies: string[];
    counts: number[];
    jsonBlocks: string[];
  };
  inferredFields: {
    testType: string;
    duration: string;
    loadPattern: string;
    requestBody?: any;
  };
  ambiguities: Ambiguity[];
  confidence: number;
}

export interface ContextEnhancer {
  buildContext(
    input: string,
    structuredData: StructuredData,
    hints: ParsingHint[]
  ): ParseContext;
  inferMissingFields(context: ParseContext): ParseContext;
  resolveAmbiguities(context: ParseContext): ParseContext;
}

export class DefaultContextEnhancer implements ContextEnhancer {
  private readonly DEFAULT_TEST_TYPE = "load";
  private readonly DEFAULT_DURATION = "30s";
  private readonly DEFAULT_LOAD_PATTERN = "constant";

  private readonly LOAD_PATTERNS = {
    constant: ["constant", "steady", "fixed", "stable"],
    ramp: ["ramp", "gradual", "increase", "scale", "step"],
    spike: ["spike", "burst", "peak", "sudden"],
    stress: ["breaking", "limit", "maximum"], // removed "stress" to avoid confusion with test type
  };

  private readonly TEST_TYPES = {
    load: ["load", "performance", "capacity"],
    stress: ["stress", "breaking", "limit"],
    spike: ["spike", "burst", "peak"],
    volume: ["volume", "data", "large"],
    endurance: ["endurance", "soak", "long", "extended"],
  };

  buildContext(
    input: string,
    structuredData: StructuredData,
    hints: ParsingHint[]
  ): ParseContext {
    const cleanedInput = this.cleanInput(input);

    // Extract components from structured data and hints
    const extractedComponents = this.extractComponents(structuredData, hints);

    // Initialize context with basic information
    const context: ParseContext = {
      originalInput: input,
      cleanedInput,
      extractedComponents,
      inferredFields: {
        testType: "",
        duration: "",
        loadPattern: "",
      },
      ambiguities: [],
      confidence: this.calculateInitialConfidence(structuredData, hints),
    };

    return context;
  }

  inferMissingFields(context: ParseContext): ParseContext {
    const updatedContext = { ...context };

    // Infer test type first
    if (!updatedContext.inferredFields.testType) {
      updatedContext.inferredFields.testType = this.inferTestType(context);
    }

    // Infer duration (may depend on test type)
    if (!updatedContext.inferredFields.duration) {
      updatedContext.inferredFields.duration =
        this.inferDuration(updatedContext);
    }

    // Infer load pattern (may depend on test type)
    if (!updatedContext.inferredFields.loadPattern) {
      updatedContext.inferredFields.loadPattern =
        this.inferLoadPattern(updatedContext);
    }

    // Infer request body from JSON blocks
    if (!updatedContext.inferredFields.requestBody) {
      updatedContext.inferredFields.requestBody =
        this.inferRequestBody(updatedContext);
    }

    // Update confidence based on inference quality
    updatedContext.confidence =
      this.calculateInferenceConfidence(updatedContext);

    return updatedContext;
  }

  resolveAmbiguities(context: ParseContext): ParseContext {
    const updatedContext = { ...context };
    updatedContext.ambiguities = [];

    // Check for method ambiguities
    this.checkMethodAmbiguities(updatedContext);

    // Check for URL ambiguities
    this.checkUrlAmbiguities(updatedContext);

    // Check for count ambiguities
    this.checkCountAmbiguities(updatedContext);

    // Check for header ambiguities
    this.checkHeaderAmbiguities(updatedContext);

    // Check for test configuration ambiguities
    this.checkTestConfigAmbiguities(updatedContext);

    // Adjust confidence based on ambiguities
    updatedContext.confidence =
      this.adjustConfidenceForAmbiguities(updatedContext);

    return updatedContext;
  }

  private cleanInput(input: string): string {
    return input
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private extractComponents(
    structuredData: StructuredData,
    hints: ParsingHint[]
  ): ParseContext["extractedComponents"] {
    // Extract methods from both structured data and hints
    const methods = [
      ...structuredData.methods,
      ...hints.filter((h) => h.type === "method").map((h) => h.value),
    ];

    // Extract URLs from both sources
    const urls = [
      ...structuredData.urls,
      ...hints.filter((h) => h.type === "url").map((h) => h.value),
    ];

    // Extract headers - convert structured data headers to array format
    const headers = [structuredData.headers];

    // Extract bodies from hints (JSON blocks are considered bodies)
    const bodies = [
      ...structuredData.jsonBlocks,
      ...hints.filter((h) => h.type === "body").map((h) => h.value),
    ];

    // Extract counts from hints
    const counts = hints
      .filter((h) => h.type === "count")
      .map((h) => parseInt(h.value, 10))
      .filter((n) => !isNaN(n));

    return {
      methods: Array.from(new Set(methods)), // Remove duplicates
      urls: Array.from(new Set(urls)),
      headers,
      bodies,
      counts,
      jsonBlocks: structuredData.jsonBlocks || [],
    };
  }

  private calculateInitialConfidence(
    structuredData: StructuredData,
    hints: ParsingHint[]
  ): number {
    let confidence = 0.3; // Base confidence

    // Boost confidence for each type of structured data found
    if (structuredData.methods.length > 0) confidence += 0.15;
    if (structuredData.urls.length > 0) confidence += 0.2;
    if (Object.keys(structuredData.headers).length > 0) confidence += 0.1;
    if (structuredData.jsonBlocks.length > 0) confidence += 0.15;

    // Boost confidence for high-confidence hints
    const highConfidenceHints = hints.filter((h) => h.confidence > 0.8);
    confidence += Math.min(highConfidenceHints.length * 0.05, 0.2);

    return Math.min(confidence, 1.0);
  }

  private inferTestType(context: ParseContext): string {
    const input = context.cleanedInput.toLowerCase();

    // Check for explicit test type mentions
    for (const [testType, keywords] of Object.entries(this.TEST_TYPES)) {
      for (const keyword of keywords) {
        if (input.includes(keyword)) {
          return testType;
        }
      }
    }

    // Infer from context
    if (context.extractedComponents.counts.some((c) => c > 1000)) {
      return "stress";
    }

    if (input.includes("concurrent") || input.includes("parallel")) {
      return "load";
    }

    return this.DEFAULT_TEST_TYPE;
  }

  private inferRequestBody(context: ParseContext): any {
    const jsonBlocks = context.extractedComponents.jsonBlocks;

    if (jsonBlocks && jsonBlocks.length > 0) {
      try {
        // Use the first valid JSON block as the request body
        const parsed = JSON.parse(jsonBlocks[0]);

        // If it looks like a complete request structure, use it as-is
        if (parsed.requestId || parsed.payload || parsed.data) {
          return parsed;
        }

        // Otherwise, wrap it in a standard structure if needed
        return parsed;
      } catch (error) {
        console.warn("Failed to parse JSON block:", error);
      }
    }

    return null;
  }

  private inferDuration(context: ParseContext): string {
    const input = context.cleanedInput;

    // Look for explicit duration patterns
    const durationPatterns = [
      /(\d+)\s*(seconds?|s)\b/i,
      /(\d+)\s*(minutes?|m)\b/i,
      /(\d+)\s*(hours?|h)\b/i,
    ];

    for (const pattern of durationPatterns) {
      const match = input.match(pattern);
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();

        // Normalize unit
        if (unit.startsWith("s")) return `${value}s`;
        if (unit.startsWith("m")) return `${value}m`;
        if (unit.startsWith("h")) return `${value}h`;
      }
    }

    // Infer from test type
    const testType = context.inferredFields.testType;
    if (testType === "stress" || testType === "spike") {
      return "60s";
    }
    if (testType === "endurance") {
      return "10m";
    }

    return this.DEFAULT_DURATION;
  }

  private inferLoadPattern(context: ParseContext): string {
    const input = context.cleanedInput.toLowerCase();

    // Check for explicit load pattern mentions
    for (const [pattern, keywords] of Object.entries(this.LOAD_PATTERNS)) {
      for (const keyword of keywords) {
        if (input.includes(keyword)) {
          return pattern;
        }
      }
    }

    // Infer from test type
    const testType = context.inferredFields.testType;
    if (testType === "spike") return "spike";
    if (testType === "stress") return "ramp";

    return this.DEFAULT_LOAD_PATTERN;
  }

  private calculateInferenceConfidence(context: ParseContext): number {
    let confidence = context.confidence;

    // Reduce confidence for inferred fields
    if (context.inferredFields.testType === this.DEFAULT_TEST_TYPE) {
      confidence *= 0.9;
    }
    if (context.inferredFields.duration === this.DEFAULT_DURATION) {
      confidence *= 0.9;
    }
    if (context.inferredFields.loadPattern === this.DEFAULT_LOAD_PATTERN) {
      confidence *= 0.9;
    }

    return Math.max(confidence, 0.1); // Minimum confidence
  }

  private checkMethodAmbiguities(context: ParseContext): void {
    const methods = context.extractedComponents.methods;

    if (methods.length === 0) {
      context.ambiguities.push({
        field: "method",
        possibleValues: ["GET", "POST"],
        reason:
          "No HTTP method specified, common methods are GET for read operations and POST for write operations",
      });
    } else if (methods.length > 1) {
      context.ambiguities.push({
        field: "method",
        possibleValues: methods,
        reason:
          "Multiple HTTP methods found, unclear which one to use for the test",
      });
    }
  }

  private checkUrlAmbiguities(context: ParseContext): void {
    const urls = context.extractedComponents.urls;

    if (urls.length === 0) {
      context.ambiguities.push({
        field: "url",
        possibleValues: ["http://localhost:8080", "https://api.example.com"],
        reason: "No URL specified, need target endpoint for load test",
      });
    } else if (urls.length > 1) {
      context.ambiguities.push({
        field: "url",
        possibleValues: urls,
        reason: "Multiple URLs found, unclear which endpoint to test",
      });
    } else {
      // Check for incomplete URLs
      const url = urls[0];
      if (url.startsWith("/") && !url.startsWith("//")) {
        context.ambiguities.push({
          field: "url",
          possibleValues: [
            `http://localhost${url}`,
            `https://api.example.com${url}`,
          ],
          reason:
            "Relative URL found, need complete URL with protocol and host",
        });
      }
    }
  }

  private checkCountAmbiguities(context: ParseContext): void {
    const counts = context.extractedComponents.counts;

    if (counts.length === 0) {
      context.ambiguities.push({
        field: "userCount",
        possibleValues: ["1", "10", "100"],
        reason:
          "No user count specified, need number of concurrent users for load test",
      });
    } else if (counts.length > 1) {
      context.ambiguities.push({
        field: "userCount",
        possibleValues: counts.map((c) => c.toString()),
        reason:
          "Multiple counts found, unclear which represents the user count",
      });
    }
  }

  private checkHeaderAmbiguities(context: ParseContext): void {
    const headers = context.extractedComponents.headers[0] || {};
    const headerKeys = Object.keys(headers);

    // Check for authentication ambiguities
    const authHeaders = headerKeys.filter(
      (key) =>
        key.toLowerCase().includes("auth") ||
        key.toLowerCase().includes("token") ||
        key.toLowerCase() === "authorization"
    );

    if (authHeaders.length > 1) {
      context.ambiguities.push({
        field: "authentication",
        possibleValues: authHeaders,
        reason:
          "Multiple authentication headers found, unclear which one to use",
      });
    }

    // Check for content-type ambiguities with body
    const hasBody = context.extractedComponents.bodies.length > 0;
    const hasContentType = headerKeys.some(
      (key) => key.toLowerCase() === "content-type"
    );

    if (hasBody && !hasContentType) {
      context.ambiguities.push({
        field: "content-type",
        possibleValues: [
          "application/json",
          "application/x-www-form-urlencoded",
        ],
        reason: "Request body found but no Content-Type header specified",
      });
    }
  }

  private checkTestConfigAmbiguities(context: ParseContext): void {
    // Check for duration ambiguities
    if (context.inferredFields.duration === this.DEFAULT_DURATION) {
      context.ambiguities.push({
        field: "duration",
        possibleValues: ["30s", "1m", "5m"],
        reason: "No test duration specified, using default value",
      });
    }

    // Check for load pattern ambiguities
    if (context.inferredFields.loadPattern === this.DEFAULT_LOAD_PATTERN) {
      context.ambiguities.push({
        field: "loadPattern",
        possibleValues: ["constant", "ramp", "spike"],
        reason: "No load pattern specified, using default constant load",
      });
    }
  }

  private adjustConfidenceForAmbiguities(context: ParseContext): number {
    let confidence = context.confidence;

    // Reduce confidence based on number and severity of ambiguities
    const criticalAmbiguities = context.ambiguities.filter((a) =>
      ["url", "method"].includes(a.field)
    );
    const minorAmbiguities = context.ambiguities.filter(
      (a) => !["url", "method"].includes(a.field)
    );

    // Critical ambiguities significantly reduce confidence
    confidence -= criticalAmbiguities.length * 0.2;

    // Minor ambiguities slightly reduce confidence
    confidence -= minorAmbiguities.length * 0.05;

    return Math.max(confidence, 0.1); // Minimum confidence
  }
}

import { LoadTestSpec, RequestSpec, LoadPattern } from "../types";
import { PromptTemplateManager } from "./prompt-templates";

export interface FallbackParseResult {
  spec: LoadTestSpec;
  confidence: number;
  method: "pattern-matching" | "keyword-extraction" | "template-based";
  matchedPatterns: string[];
}

export class FallbackParser {
  private static readonly PARSING_PATTERNS = [
    {
      name: "http-method-url",
      pattern: /(GET|POST|PUT|DELETE|PATCH)\s+(.+?)(?:\s|$)/i,
      extract: (match: RegExpMatchArray) => ({
        method: match[1].toUpperCase(),
        url: match[2].trim(),
      }),
    },
    {
      name: "url-only",
      pattern: /(https?:\/\/[^\s]+|\/[^\s]+)/i,
      extract: (match: RegExpMatchArray) => ({
        url: match[1],
      }),
    },
    {
      name: "virtual-users",
      pattern: /(\d+)\s*(users?|virtual\s*users?|concurrent|parallel)/i,
      extract: (match: RegExpMatchArray) => ({
        virtualUsers: parseInt(match[1]),
      }),
    },
    {
      name: "requests-per-second",
      pattern: /(\d+)\s*(rps|requests?\s*per\s*second|req\/s)/i,
      extract: (match: RegExpMatchArray) => ({
        requestsPerSecond: parseInt(match[1]),
      }),
    },
    {
      name: "total-requests",
      pattern: /(\d+)\s*(requests?|calls?)/i,
      extract: (match: RegExpMatchArray) => ({
        totalRequests: parseInt(match[1]),
      }),
    },
    {
      name: "duration",
      pattern:
        /(?:for\s+)?(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i,
      extract: (match: RegExpMatchArray) => ({
        duration: {
          value: parseInt(match[1]),
          unit: this.normalizeTimeUnit(match[2]),
        },
      }),
    },
    {
      name: "test-type",
      pattern: /(spike|stress|endurance|volume|baseline)\s*test/i,
      extract: (match: RegExpMatchArray) => ({
        testType: match[1].toLowerCase(),
      }),
    },
    {
      name: "payload-json",
      pattern: /(?:with|payload|body|data)\s*[:\-]?\s*(\{[^}]+\})/i,
      extract: (match: RegExpMatchArray) => ({
        payload: {
          template: match[1],
          variables: this.extractVariablesFromPayload(match[1]),
        },
      }),
    },
  ];

  private static readonly KEYWORD_MAPPINGS = {
    methods: {
      get: "GET",
      post: "POST",
      put: "PUT",
      delete: "DELETE",
      patch: "PATCH",
      fetch: "GET",
      retrieve: "GET",
      create: "POST",
      update: "PUT",
      remove: "DELETE",
      modify: "PATCH",
    },
    testTypes: {
      spike: "spike",
      stress: "stress",
      endurance: "endurance",
      volume: "volume",
      baseline: "baseline",
      load: "baseline",
      performance: "baseline",
    },
    loadPatterns: {
      spike: "spike",
      gradually: "ramp-up",
      ramp: "ramp-up",
      increase: "ramp-up",
      constant: "constant",
      steady: "constant",
      step: "step",
    },
  };

  static parseCommand(input: string): FallbackParseResult {
    const extractedData: any = {};
    const matchedPatterns: string[] = [];
    let confidence = 0.3; // Base confidence for fallback parsing

    // Apply pattern matching
    for (const pattern of this.PARSING_PATTERNS) {
      const match = input.match(pattern.pattern);
      if (match) {
        const extracted = pattern.extract(match);
        Object.assign(extractedData, extracted);
        matchedPatterns.push(pattern.name);
        confidence += 0.1; // Increase confidence for each matched pattern
      }
    }

    // Apply keyword extraction
    const keywordData = this.extractKeywords(input);
    Object.assign(extractedData, keywordData);
    if (Object.keys(keywordData).length > 0) {
      confidence += 0.1;
      matchedPatterns.push("keyword-extraction");
    }

    // Build the LoadTestSpec
    const spec = this.buildLoadTestSpec(extractedData, input);

    // Determine parsing method
    let method: FallbackParseResult["method"] = "template-based";
    if (matchedPatterns.length > 2) {
      method = "pattern-matching";
    } else if (matchedPatterns.includes("keyword-extraction")) {
      method = "keyword-extraction";
    }

    return {
      spec,
      confidence: Math.min(confidence, 0.8), // Cap confidence for fallback parsing
      method,
      matchedPatterns,
    };
  }

  private static extractKeywords(input: string): any {
    const data: any = {};
    const lowerInput = input.toLowerCase();

    // Extract HTTP method from keywords
    for (const [keyword, method] of Object.entries(
      this.KEYWORD_MAPPINGS.methods
    )) {
      if (lowerInput.includes(keyword)) {
        data.method = method;
        break;
      }
    }

    // Extract test type from keywords
    for (const [keyword, testType] of Object.entries(
      this.KEYWORD_MAPPINGS.testTypes
    )) {
      if (lowerInput.includes(keyword)) {
        data.testType = testType;
        break;
      }
    }

    // Extract load pattern type from keywords
    for (const [keyword, patternType] of Object.entries(
      this.KEYWORD_MAPPINGS.loadPatterns
    )) {
      if (lowerInput.includes(keyword)) {
        data.loadPatternType = patternType;
        break;
      }
    }

    return data;
  }

  private static buildLoadTestSpec(
    extractedData: any,
    originalInput: string
  ): LoadTestSpec {
    // Generate unique ID
    const id = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Build request spec
    const request: RequestSpec = {
      method: extractedData.method || this.inferHttpMethod(originalInput),
      url:
        extractedData.url ||
        this.extractUrlFromInput(originalInput) ||
        "/api/endpoint",
    };

    // Add headers for POST/PUT/PATCH requests
    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      request.headers = {
        "Content-Type": "application/json",
      };
    }

    // Add payload if extracted
    if (extractedData.payload) {
      request.payload = extractedData.payload;
    }

    // Build load pattern
    const loadPattern: LoadPattern = {
      type:
        extractedData.loadPatternType ||
        this.inferLoadPatternType(originalInput, extractedData.testType),
    };

    // Set load parameters
    if (extractedData.virtualUsers) {
      loadPattern.virtualUsers = extractedData.virtualUsers;
    } else if (extractedData.requestsPerSecond) {
      loadPattern.requestsPerSecond = extractedData.requestsPerSecond;
    } else if (extractedData.totalRequests) {
      // Convert total requests to virtual users (rough estimation)
      loadPattern.virtualUsers = Math.min(extractedData.totalRequests, 100);
    } else {
      // Default load parameters
      loadPattern.virtualUsers = this.extractDefaultUserCount(originalInput);
    }

    // Add ramp-up time for ramp-up tests
    if (loadPattern.type === "ramp-up") {
      loadPattern.rampUpTime = {
        value: 2,
        unit: "minutes",
      };
    }

    // Build the complete spec
    const spec: LoadTestSpec = {
      id,
      name: this.generateTestName(originalInput, extractedData),
      description: originalInput,
      testType: extractedData.testType || this.inferTestType(originalInput),
      requests: [request],
      loadPattern,
      duration: extractedData.duration || this.extractDuration(originalInput),
    };

    return spec;
  }

  private static inferHttpMethod(input: string): any {
    return PromptTemplateManager.inferHttpMethod(input);
  }

  private static inferTestType(input: string): any {
    return PromptTemplateManager.inferTestType(input);
  }

  private static inferLoadPatternType(
    input: string,
    testType?: string
  ): LoadPattern["type"] {
    const lowerInput = input.toLowerCase();

    if (testType === "spike" || lowerInput.includes("spike")) {
      return "spike";
    }
    if (
      testType === "stress" ||
      lowerInput.includes("stress") ||
      lowerInput.includes("gradually") ||
      lowerInput.includes("ramp")
    ) {
      return "ramp-up";
    }
    if (lowerInput.includes("step")) {
      return "step";
    }

    return "constant";
  }

  private static extractUrlFromInput(input: string): string | null {
    const urlPattern = /(https?:\/\/[^\s]+|\/[^\s]*)/;
    const match = input.match(urlPattern);
    return match ? match[0] : null;
  }

  private static extractDuration(input: string): {
    value: number;
    unit: "seconds" | "minutes" | "hours";
  } {
    return PromptTemplateManager.extractDuration(input);
  }

  private static extractDefaultUserCount(input: string): number {
    // Try to extract any number that might represent users
    const numbers = input.match(/\d+/g);
    if (numbers && numbers.length > 0) {
      const num = parseInt(numbers[0]);
      // If it's a reasonable user count, use it
      if (num >= 1 && num <= 10000) {
        return num;
      }
    }
    return 10; // Default user count
  }

  private static generateTestName(input: string, extractedData: any): string {
    const method = extractedData.method || "API";
    const testType = extractedData.testType || "Load";
    const timestamp = new Date().toISOString().split("T")[0];

    return `${
      testType.charAt(0).toUpperCase() + testType.slice(1)
    } Test - ${method} (${timestamp})`;
  }

  private static normalizeTimeUnit(
    unit: string
  ): "seconds" | "minutes" | "hours" {
    const normalized = unit.toLowerCase();
    if (normalized.includes("sec")) return "seconds";
    if (normalized.includes("min")) return "minutes";
    if (normalized.includes("hour") || normalized.includes("hr"))
      return "hours";
    return "seconds";
  }

  private static extractVariablesFromPayload(
    payload: string
  ): Array<{ name: string; type: string; parameters?: any }> {
    return PromptTemplateManager.extractVariablesFromPayload(payload);
  }

  static canParse(input: string): boolean {
    // Check if input contains enough information for fallback parsing
    const hasUrl = /https?:\/\/[^\s]+|\/[^\s]+/.test(input);
    const hasMethod =
      /(GET|POST|PUT|DELETE|PATCH|get|post|put|delete|patch|fetch|create|update|remove)/i.test(
        input
      );
    const hasNumbers = /\d+/.test(input);

    return hasUrl || hasMethod || hasNumbers;
  }

  static getConfidenceScore(input: string): number {
    let score = 0;

    // Check for various indicators
    if (/https?:\/\/[^\s]+/.test(input)) score += 0.3; // Full URL
    if (/\/[^\s]+/.test(input)) score += 0.2; // Relative URL
    if (/(GET|POST|PUT|DELETE|PATCH)/i.test(input)) score += 0.2; // HTTP method
    if (/\d+\s*(users?|rps|requests?)/i.test(input)) score += 0.2; // Load parameters
    if (/\d+\s*(seconds?|minutes?|hours?)/i.test(input)) score += 0.1; // Duration
    if (/(spike|stress|endurance|volume|baseline)/i.test(input)) score += 0.1; // Test type

    return Math.min(score, 0.8); // Cap at 0.8 for fallback parsing
  }
}

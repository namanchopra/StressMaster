import { LoadTestSpec } from "../types";
import { ValidationIssue } from "./command-validator";

export interface SuggestionContext {
  originalInput: string;
  parsedSpec?: LoadTestSpec;
  validationIssues: ValidationIssue[];
  confidence: number;
  ambiguities: string[];
}

export interface Suggestion {
  type: "clarification" | "completion" | "correction" | "alternative";
  priority: "high" | "medium" | "low";
  message: string;
  example?: string;
  autoFix?: Partial<LoadTestSpec>;
}

export class SuggestionEngine {
  private static readonly COMMON_PATTERNS = [
    {
      pattern: /(\d+)\s*(users?|concurrent|parallel)/i,
      extract: (match: RegExpMatchArray) => ({
        virtualUsers: parseInt(match[1]),
      }),
    },
    {
      pattern: /(\d+)\s*(rps|requests?\s*per\s*second|req\/s)/i,
      extract: (match: RegExpMatchArray) => ({
        requestsPerSecond: parseInt(match[1]),
      }),
    },
    {
      pattern: /(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i,
      extract: (match: RegExpMatchArray) => ({
        duration: {
          value: parseInt(match[1]),
          unit: this.normalizeTimeUnit(match[2]),
        },
      }),
    },
    {
      pattern: /(GET|POST|PUT|DELETE|PATCH)\s+(.+)/i,
      extract: (match: RegExpMatchArray) => ({
        method: match[1].toUpperCase(),
        url: match[2].trim(),
      }),
    },
  ];

  static generateSuggestions(context: SuggestionContext): Suggestion[] {
    const suggestions: Suggestion[] = [];

    // Generate suggestions based on validation issues
    suggestions.push(...this.generateValidationSuggestions(context));

    // Generate suggestions for missing information
    suggestions.push(...this.generateCompletionSuggestions(context));

    // Generate suggestions for ambiguous input
    suggestions.push(...this.generateClarificationSuggestions(context));

    // Generate alternative approaches
    suggestions.push(...this.generateAlternativeSuggestions(context));

    // Sort by priority and remove duplicates
    return this.prioritizeAndDeduplicate(suggestions);
  }

  private static generateValidationSuggestions(
    context: SuggestionContext
  ): Suggestion[] {
    const suggestions: Suggestion[] = [];

    context.validationIssues.forEach((issue) => {
      if (issue.type === "error" && issue.severity === "critical") {
        suggestions.push({
          type: "correction",
          priority: "high",
          message: issue.suggestion || `Fix ${issue.field}: ${issue.message}`,
          example: this.getExampleForField(issue.field),
        });
      } else if (issue.type === "warning") {
        suggestions.push({
          type: "completion",
          priority: "medium",
          message: issue.suggestion || issue.message,
          example: this.getExampleForField(issue.field),
        });
      }
    });

    return suggestions;
  }

  private static generateCompletionSuggestions(
    context: SuggestionContext
  ): Suggestion[] {
    const suggestions: Suggestion[] = [];
    const input = context.originalInput.toLowerCase();
    const spec = context.parsedSpec;

    // Missing URL
    if (
      !spec?.requests?.[0]?.url ||
      spec.requests[0].url.includes("example.com")
    ) {
      suggestions.push({
        type: "completion",
        priority: "high",
        message: "Specify the complete API endpoint URL",
        example: "https://api.myservice.com/users or /api/v1/orders",
      });
    }

    // Missing HTTP method
    if (
      !spec?.requests?.[0]?.method ||
      !input.includes(spec.requests[0].method.toLowerCase())
    ) {
      suggestions.push({
        type: "completion",
        priority: "high",
        message: "Specify the HTTP method",
        example: "GET /api/users or POST to /api/orders",
      });
    }

    // Missing load parameters
    if (
      !spec?.loadPattern?.virtualUsers &&
      !spec?.loadPattern?.requestsPerSecond
    ) {
      suggestions.push({
        type: "completion",
        priority: "high",
        message: "Specify load parameters",
        example: "with 50 users or at 100 requests per second",
      });
    }

    // Missing duration
    if (
      !spec?.duration ||
      (spec.duration.value === 1 &&
        spec.duration.unit === "minutes" &&
        !input.includes("minute"))
    ) {
      suggestions.push({
        type: "completion",
        priority: "medium",
        message: "Specify test duration",
        example: "for 5 minutes or run for 30 seconds",
      });
    }

    // Missing payload for POST/PUT/PATCH
    if (
      spec?.requests?.[0]?.method &&
      ["POST", "PUT", "PATCH"].includes(spec.requests[0].method) &&
      !spec.requests[0].payload
    ) {
      suggestions.push({
        type: "completion",
        priority: "medium",
        message: "Consider adding request payload",
        example: 'with payload {"userId": "{{userId}}", "name": "{{name}}"}',
      });
    }

    return suggestions;
  }

  private static generateClarificationSuggestions(
    context: SuggestionContext
  ): Suggestion[] {
    const suggestions: Suggestion[] = [];

    // Low confidence suggestions
    if (context.confidence < 0.6) {
      suggestions.push({
        type: "clarification",
        priority: "high",
        message:
          "Your command could be interpreted in multiple ways. Please be more specific.",
        example:
          'Instead of "test the API", try "Send 100 GET requests to https://api.example.com/users"',
      });
    }

    // Ambiguity-specific suggestions
    context.ambiguities.forEach((ambiguity) => {
      if (ambiguity.includes("URL")) {
        suggestions.push({
          type: "clarification",
          priority: "high",
          message: "The API endpoint URL is unclear",
          example:
            "Specify the complete URL like https://api.example.com/endpoint",
        });
      }

      if (ambiguity.includes("load parameters")) {
        suggestions.push({
          type: "clarification",
          priority: "high",
          message: "Load parameters are ambiguous",
          example: 'Specify "50 virtual users" or "100 requests per second"',
        });
      }

      if (ambiguity.includes("payload")) {
        suggestions.push({
          type: "clarification",
          priority: "medium",
          message: "Request payload structure is unclear",
          example:
            'Describe the payload like "with JSON containing userId and orderData"',
        });
      }
    });

    return suggestions;
  }

  private static generateAlternativeSuggestions(
    context: SuggestionContext
  ): Suggestion[] {
    const suggestions: Suggestion[] = [];
    const input = context.originalInput.toLowerCase();

    // Suggest different test types
    if (
      !input.includes("spike") &&
      !input.includes("stress") &&
      !input.includes("endurance")
    ) {
      suggestions.push({
        type: "alternative",
        priority: "low",
        message: "Consider specifying a test type for better results",
        example: 'Try "spike test", "stress test", or "endurance test"',
      });
    }

    // Suggest realistic load patterns
    if (
      context.parsedSpec?.loadPattern?.virtualUsers &&
      context.parsedSpec.loadPattern.virtualUsers > 1000
    ) {
      suggestions.push({
        type: "alternative",
        priority: "medium",
        message: "Consider starting with fewer users and scaling up",
        example: "Start with 50-100 users and increase based on results",
      });
    }

    // Suggest workflow for complex scenarios
    if (
      input.includes("login") ||
      input.includes("authenticate") ||
      input.includes("then")
    ) {
      suggestions.push({
        type: "alternative",
        priority: "low",
        message: "For multi-step scenarios, describe the workflow",
        example:
          "First login to /auth, then GET /profile, finally POST /orders",
      });
    }

    return suggestions;
  }

  private static getExampleForField(field: string): string {
    const examples: Record<string, string> = {
      id: "test_2024_01_15_001",
      name: "User API Load Test",
      requests: "GET https://api.example.com/users",
      url: "https://api.example.com/endpoint",
      method: "POST",
      loadPattern: "50 virtual users",
      virtualUsers: "50 users",
      requestsPerSecond: "100 requests per second",
      duration: "for 5 minutes",
      payload: '{"userId": "{{userId}}", "data": "{{randomData}}"}',
    };

    // Handle nested field paths
    const baseField = field.split(".")[0].split("[")[0];
    return (
      examples[baseField] || examples[field] || "See documentation for examples"
    );
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

  private static prioritizeAndDeduplicate(
    suggestions: Suggestion[]
  ): Suggestion[] {
    // Remove duplicates based on message
    const unique = suggestions.filter(
      (suggestion, index, array) =>
        array.findIndex((s) => s.message === suggestion.message) === index
    );

    // Sort by priority
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return unique.sort(
      (a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]
    );
  }

  static generateQuickFixes(
    context: SuggestionContext
  ): Partial<LoadTestSpec>[] {
    const fixes: Partial<LoadTestSpec>[] = [];
    const input = context.originalInput;

    // Try to extract common patterns and suggest fixes
    for (const pattern of this.COMMON_PATTERNS) {
      const match = input.match(pattern.pattern);
      if (match) {
        const extracted = pattern.extract(match);
        fixes.push(extracted as Partial<LoadTestSpec>);
      }
    }

    return fixes;
  }

  static generateInteractiveQuestions(context: SuggestionContext): string[] {
    const questions: string[] = [];

    // Ask for missing critical information
    if (!context.parsedSpec?.requests?.[0]?.url) {
      questions.push("What is the API endpoint URL you want to test?");
    }

    if (!context.parsedSpec?.requests?.[0]?.method) {
      questions.push(
        "What HTTP method should be used (GET, POST, PUT, DELETE)?"
      );
    }

    if (
      !context.parsedSpec?.loadPattern?.virtualUsers &&
      !context.parsedSpec?.loadPattern?.requestsPerSecond
    ) {
      questions.push(
        "How many virtual users or requests per second do you want?"
      );
    }

    if (!context.parsedSpec?.duration) {
      questions.push("How long should the test run?");
    }

    // Ask for clarification on ambiguous parts
    if (context.confidence < 0.5) {
      questions.push(
        "Could you provide more details about what you want to test?"
      );
    }

    return questions.slice(0, 3); // Limit to 3 questions to avoid overwhelming
  }
}

import {
  LoadTestSpec,
  RequestSpec,
  LoadPattern,
  PayloadSpec,
  VariableDefinition,
} from "../types";
import { ValidationResult } from "../types/common";
import { PromptTemplateManager } from "./prompt-templates";

export interface ParsedResponse {
  spec: LoadTestSpec;
  confidence: number;
  ambiguities: string[];
  suggestions: string[];
}

export class ResponseParser {
  private static readonly CONFIDENCE_THRESHOLDS = {
    HIGH: 0.8,
    MEDIUM: 0.6,
    LOW: 0.4,
  };

  static parseOllamaResponse(
    response: string,
    originalInput: string
  ): ParsedResponse {
    try {
      // Clean the response - remove any markdown formatting or extra text
      const cleanedResponse = this.cleanJsonResponse(response);

      // Parse JSON
      const parsedSpec = JSON.parse(cleanedResponse) as LoadTestSpec;

      // Validate and enhance the parsed spec
      const enhancedSpec = this.enhanceLoadTestSpec(parsedSpec, originalInput);

      // Calculate confidence and identify ambiguities
      const confidence = this.calculateConfidence(enhancedSpec, originalInput);
      const ambiguities = this.identifyAmbiguities(enhancedSpec, originalInput);
      const suggestions = this.generateSuggestions(enhancedSpec, ambiguities);

      return {
        spec: enhancedSpec,
        confidence,
        ambiguities,
        suggestions,
      };
    } catch (error) {
      // If JSON parsing fails, attempt fallback parsing
      return this.fallbackParsing(response, originalInput);
    }
  }

  private static cleanJsonResponse(response: string): string {
    // Remove markdown code blocks
    let cleaned = response.replace(/```json\s*/g, "").replace(/```\s*/g, "");

    // Remove any text before the first {
    const firstBrace = cleaned.indexOf("{");
    if (firstBrace > 0) {
      cleaned = cleaned.substring(firstBrace);
    }

    // Remove any text after the last }
    const lastBrace = cleaned.lastIndexOf("}");
    if (lastBrace > 0 && lastBrace < cleaned.length - 1) {
      cleaned = cleaned.substring(0, lastBrace + 1);
    }

    return cleaned.trim();
  }

  private static enhanceLoadTestSpec(
    spec: LoadTestSpec,
    originalInput: string
  ): LoadTestSpec {
    // Ensure required fields are present
    if (!spec.id) {
      spec.id = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    if (!spec.name) {
      spec.name = this.generateTestName(originalInput);
    }

    if (!spec.description) {
      spec.description = originalInput;
    }

    // Enhance requests
    spec.requests = spec.requests.map((request) =>
      this.enhanceRequestSpec(request, originalInput)
    );

    // Ensure load pattern is valid
    if (!spec.loadPattern) {
      spec.loadPattern = this.inferLoadPattern(originalInput);
    }

    // Ensure duration is set
    if (!spec.duration) {
      spec.duration = PromptTemplateManager.extractDuration(originalInput);
    }

    // Set test type if not specified
    if (!spec.testType) {
      spec.testType = PromptTemplateManager.inferTestType(originalInput) as any;
    }

    return spec;
  }

  private static enhanceRequestSpec(
    request: RequestSpec,
    originalInput: string
  ): RequestSpec {
    // Ensure method is set
    if (!request.method) {
      request.method = PromptTemplateManager.inferHttpMethod(
        originalInput
      ) as any;
    }

    // Add default headers for POST/PUT/PATCH requests with payloads
    if (
      ["POST", "PUT", "PATCH"].includes(request.method) &&
      request.payload &&
      !request.headers
    ) {
      request.headers = {
        "Content-Type": "application/json",
      };
    }

    // Enhance payload if present
    if (request.payload) {
      request.payload = this.enhancePayloadSpec(request.payload, originalInput);
    }

    return request;
  }

  private static enhancePayloadSpec(
    payload: PayloadSpec,
    originalInput: string
  ): PayloadSpec {
    // If variables are missing, try to extract them from the template
    if (!payload.variables || payload.variables.length === 0) {
      payload.variables = this.extractVariablesFromTemplate(payload.template);
    }

    // Enhance variable definitions
    payload.variables = payload.variables.map((variable) =>
      this.enhanceVariableDefinition(variable)
    );

    return payload;
  }

  private static enhanceVariableDefinition(
    variable: VariableDefinition
  ): VariableDefinition {
    // Add default parameters if missing
    if (!variable.parameters) {
      variable.parameters = {};
    }

    // Set default parameters based on variable type
    switch (variable.type) {
      case "random_string":
        if (!variable.parameters.length) {
          variable.parameters.length = 10;
        }
        break;
      case "random_id":
        if (!variable.parameters.min) {
          variable.parameters.min = 1000;
        }
        if (!variable.parameters.max) {
          variable.parameters.max = 999999;
        }
        break;
      case "sequence":
        if (!variable.parameters.start) {
          variable.parameters.start = 1;
        }
        if (!variable.parameters.step) {
          variable.parameters.step = 1;
        }
        break;
    }

    return variable;
  }

  private static extractVariablesFromTemplate(
    template: string
  ): VariableDefinition[] {
    const variables: VariableDefinition[] = [];
    const variablePattern = /\{\{(\w+)\}\}/g;
    let match;

    while ((match = variablePattern.exec(template)) !== null) {
      const variableName = match[1];

      // Don't add duplicates
      if (variables.some((v) => v.name === variableName)) {
        continue;
      }

      // Infer variable type from name
      let variableType: VariableDefinition["type"] = "random_string";

      if (variableName.toLowerCase().includes("id")) {
        variableType = "random_id";
      } else if (variableName.toLowerCase().includes("uuid")) {
        variableType = "uuid";
      } else if (
        variableName.toLowerCase().includes("time") ||
        variableName.toLowerCase().includes("date")
      ) {
        variableType = "timestamp";
      }

      variables.push({
        name: variableName,
        type: variableType,
        parameters: {},
      });
    }

    return variables;
  }

  private static generateTestName(input: string): string {
    // Extract key components for a meaningful name
    const method = PromptTemplateManager.inferHttpMethod(input);
    const testType = PromptTemplateManager.inferTestType(input);

    // Try to extract endpoint from URL
    const urlMatch = input.match(/https?:\/\/[^\s]+|\/[^\s]*/);
    const endpoint = urlMatch ? urlMatch[0].split("/").pop() || "API" : "API";

    return `${
      testType.charAt(0).toUpperCase() + testType.slice(1)
    } Test - ${method} ${endpoint}`;
  }

  private static inferLoadPattern(input: string): LoadPattern {
    const testType = PromptTemplateManager.inferTestType(input);
    const requestCount = PromptTemplateManager.extractRequestCount(input);
    const rps = PromptTemplateManager.extractRPS(input);

    switch (testType) {
      case "spike":
        return {
          type: "spike",
          virtualUsers: requestCount,
        };
      case "stress":
        return {
          type: "ramp-up",
          virtualUsers: requestCount,
          rampUpTime: { value: 2, unit: "minutes" },
        };
      case "endurance":
        return {
          type: "constant",
          virtualUsers: Math.min(requestCount, 50), // Reasonable default for endurance
        };
      default:
        return {
          type: "constant",
          virtualUsers: rps ? undefined : requestCount,
          requestsPerSecond: rps,
        };
    }
  }

  private static calculateConfidence(
    spec: LoadTestSpec,
    originalInput: string
  ): number {
    let confidence = 1.0;

    // Reduce confidence for missing or default values
    if (!spec.requests || spec.requests.length === 0) {
      confidence -= 0.3;
    }

    if (spec.requests.some((r) => !r.url || r.url === "/")) {
      confidence -= 0.2;
    }

    if (!spec.loadPattern.virtualUsers && !spec.loadPattern.requestsPerSecond) {
      confidence -= 0.1;
    }

    // Increase confidence for specific matches
    const lowerInput = originalInput.toLowerCase();
    if (lowerInput.includes(spec.testType)) {
      confidence += 0.1;
    }

    if (
      spec.requests.some((r) => lowerInput.includes(r.method.toLowerCase()))
    ) {
      confidence += 0.1;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  private static identifyAmbiguities(
    spec: LoadTestSpec,
    originalInput: string
  ): string[] {
    const ambiguities: string[] = [];

    // Check for missing URL
    if (
      spec.requests.some((r) => !r.url || r.url === "/" || !r.url.includes("."))
    ) {
      ambiguities.push("URL endpoint is unclear or missing");
    }

    // Check for unclear load parameters
    if (!spec.loadPattern.virtualUsers && !spec.loadPattern.requestsPerSecond) {
      ambiguities.push("Load parameters (users or RPS) are unclear");
    }

    // Check for payload without clear structure
    if (
      spec.requests.some(
        (r) => r.payload && (!r.payload.template || r.payload.template === "{}")
      )
    ) {
      ambiguities.push("Request payload structure is unclear");
    }

    // Check for duration ambiguity
    if (
      spec.duration.value === 1 &&
      spec.duration.unit === "minutes" &&
      !originalInput.toLowerCase().includes("minute")
    ) {
      ambiguities.push("Test duration was not specified, using default");
    }

    return ambiguities;
  }

  private static generateSuggestions(
    spec: LoadTestSpec,
    ambiguities: string[]
  ): string[] {
    const suggestions: string[] = [];

    ambiguities.forEach((ambiguity) => {
      switch (true) {
        case ambiguity.includes("URL"):
          suggestions.push("Please specify the complete API endpoint URL");
          break;
        case ambiguity.includes("Load parameters"):
          suggestions.push(
            "Specify either number of virtual users or requests per second"
          );
          break;
        case ambiguity.includes("payload"):
          suggestions.push(
            "Provide more details about the request payload structure"
          );
          break;
        case ambiguity.includes("duration"):
          suggestions.push(
            'Specify how long the test should run (e.g., "for 5 minutes")'
          );
          break;
      }
    });

    return suggestions;
  }

  private static fallbackParsing(
    response: string,
    originalInput: string
  ): ParsedResponse {
    // Create a basic spec using template methods when JSON parsing fails
    const spec: LoadTestSpec = {
      id: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: this.generateTestName(originalInput),
      description: originalInput,
      testType: PromptTemplateManager.inferTestType(originalInput) as any,
      requests: [
        {
          method: PromptTemplateManager.inferHttpMethod(originalInput) as any,
          url: this.extractUrlFromInput(originalInput) || "/api/endpoint",
        },
      ],
      loadPattern: this.inferLoadPattern(originalInput),
      duration: PromptTemplateManager.extractDuration(originalInput),
    };

    return {
      spec,
      confidence: 0.3, // Low confidence for fallback parsing
      ambiguities: [
        "AI response could not be parsed as JSON",
        "Using fallback parsing with limited accuracy",
      ],
      suggestions: [
        "Try rephrasing your command more clearly",
        "Specify the API endpoint URL explicitly",
        "Include specific load parameters (users, duration, etc.)",
      ],
    };
  }

  private static extractUrlFromInput(input: string): string | null {
    const urlPattern = /(https?:\/\/[^\s]+|\/[^\s]*)/;
    const match = input.match(urlPattern);
    return match ? match[0] : null;
  }

  static validateParsedSpec(spec: LoadTestSpec): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required field validation
    if (!spec.id) errors.push("Test ID is required");
    if (!spec.name) errors.push("Test name is required");
    if (!spec.requests || spec.requests.length === 0) {
      errors.push("At least one request specification is required");
    }

    // Request validation
    spec.requests?.forEach((request, index) => {
      if (!request.method)
        errors.push(`Request ${index + 1}: HTTP method is required`);
      if (!request.url) errors.push(`Request ${index + 1}: URL is required`);

      if (
        request.url &&
        !request.url.match(/^https?:\/\//) &&
        !request.url.startsWith("/")
      ) {
        warnings.push(
          `Request ${index + 1}: URL should be absolute or start with /`
        );
      }
    });

    // Load pattern validation
    if (!spec.loadPattern) {
      errors.push("Load pattern is required");
    } else {
      if (
        !spec.loadPattern.virtualUsers &&
        !spec.loadPattern.requestsPerSecond
      ) {
        errors.push(
          "Either virtual users or requests per second must be specified"
        );
      }
    }

    // Duration validation
    if (!spec.duration) {
      errors.push("Test duration is required");
    } else if (spec.duration.value <= 0) {
      errors.push("Test duration must be positive");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

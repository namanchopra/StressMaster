/**
 * Smart AI Provider Interface and Implementation
 * Extends BaseAIProvider with enhanced parsing capabilities
 */

import {
  BaseAIProvider,
  CompletionRequest,
  CompletionResponse,
  AIProviderConfig,
} from "./ai-provider";
import { LoadTestSpec } from "../types";
import { ParseContext } from "./context-enhancer";
import {
  ErrorRecoverySystem,
  ParseError,
  RecoveryStrategy,
  RecoveryContext,
  RecoveryResult,
} from "./error-recovery";
import {
  IntelligentFallbackParser,
  FallbackParseResult,
} from "./intelligent-fallback-parser";

export interface Assumption {
  field: string;
  assumedValue: any;
  reason: string;
  alternatives: any[];
}

export interface SmartParseResponse {
  spec: LoadTestSpec;
  confidence: number;
  assumptions: Assumption[];
  warnings: string[];
  suggestions: string[];
}

export interface ParseExplanation {
  extractedComponents: string[];
  assumptions: Assumption[];
  ambiguityResolutions: string[];
  suggestions: string[];
}

// Re-export types from error-recovery module
export type { ParseError, RecoveryStrategy } from "./error-recovery";

/**
 * Enhanced AI Provider interface with smart parsing capabilities
 */
export interface SmartAIProvider {
  parseWithContext(context: ParseContext): Promise<SmartParseResponse>;
  validateAndCorrect(
    response: string,
    context: ParseContext
  ): Promise<LoadTestSpec>;
  explainParsing(spec: LoadTestSpec, context: ParseContext): ParseExplanation;
  parseWithRecovery(context: ParseContext): Promise<SmartParseResponse>;
}

/**
 * Abstract base class that extends BaseAIProvider with smart parsing capabilities
 */
export abstract class SmartBaseAIProvider
  extends BaseAIProvider
  implements SmartAIProvider
{
  private readonly MAX_VALIDATION_RETRIES = 2;
  private readonly MIN_CONFIDENCE_THRESHOLD = 0.3;
  private readonly errorRecovery: ErrorRecoverySystem;
  private readonly fallbackParser: IntelligentFallbackParser;

  constructor(config?: AIProviderConfig) {
    super(config || { model: "default" });
    this.errorRecovery = new ErrorRecoverySystem({
      maxRetries: 3,
      retryDelay: 1000,
      confidenceThreshold: 0.7,
      enableFallback: true,
      fallbackConfidenceThreshold: 0.5,
      enablePromptEnhancement: true,
    });
    this.fallbackParser = new IntelligentFallbackParser();
  }

  async parseWithContext(context: ParseContext): Promise<SmartParseResponse> {
    try {
      // Build enhanced prompt based on context
      const prompt = this.buildEnhancedPrompt(context);

      // Generate completion with enhanced error handling
      const response = await this.generateCompletionWithRetry(prompt, context);

      // DEBUG: Log the raw AI response
      console.log("🤖 RAW AI RESPONSE:", response.response);

      // Parse and validate the response
      const spec = await this.validateAndCorrect(response.response, context);

      // Calculate confidence and extract metadata
      const confidence = this.calculateParsingConfidence(
        spec,
        context,
        response
      );
      const assumptions = this.extractAssumptions(spec, context);
      const warnings = this.generateWarnings(spec, context);
      const suggestions = this.generateSuggestions(spec, context);

      return {
        spec,
        confidence,
        assumptions,
        warnings,
        suggestions,
      };
    } catch (error) {
      throw this.errorRecovery.classifyError(error as Error, "ai", { context });
    }
  }

  async parseWithRecovery(context: ParseContext): Promise<SmartParseResponse> {
    const recoveryContext: RecoveryContext = {
      originalInput: context.originalInput,
      previousAttempts: [],
      availableStrategies: [],
    };

    try {
      // First attempt with normal parsing
      return await this.parseWithContext(context);
    } catch (error) {
      const parseError = error as ParseError;

      // Attempt recovery using the error recovery system
      const recoveryResult = await this.errorRecovery.recover(
        parseError,
        recoveryContext,
        async (strategy: RecoveryStrategy, ctx: RecoveryContext) => {
          switch (strategy.strategy) {
            case "retry":
              return await this.retryParsing(context);

            case "enhance_prompt":
              return await this.parseWithEnhancedPrompt(context, parseError);

            case "fallback":
              return await this.parseWithFallback(context);

            default:
              throw new Error(
                `Unsupported recovery strategy: ${strategy.strategy}`
              );
          }
        }
      );

      if (recoveryResult.success && recoveryResult.result) {
        // Convert LoadTestSpec to SmartParseResponse
        return this.createSmartParseResponseFromSpec(
          recoveryResult.result,
          context,
          recoveryResult.confidence,
          [
            `Recovered using strategy: ${recoveryResult.recoveryPath.join(
              " -> "
            )}`,
          ]
        );
      }

      // Recovery failed, throw the last error
      throw recoveryResult.error || parseError;
    }
  }

  async validateAndCorrect(
    response: string,
    context: ParseContext
  ): Promise<LoadTestSpec> {
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < this.MAX_VALIDATION_RETRIES) {
      try {
        // Attempt to parse JSON response
        const spec = this.parseJsonResponse(response);

        // Validate the parsed spec
        const validationResult = this.validateLoadTestSpec(spec, context);

        if (validationResult.isValid) {
          return validationResult.correctedSpec || spec;
        }

        // If validation failed, try to correct the response
        if (attempts < this.MAX_VALIDATION_RETRIES - 1) {
          response = await this.correctResponse(
            response,
            validationResult.errors,
            context
          );
          attempts++;
          continue;
        }

        // Final attempt failed, throw validation error
        throw new Error(
          `Validation failed: ${validationResult.errors.join(", ")}`
        );
      } catch (error) {
        lastError = error as Error;

        if (attempts < this.MAX_VALIDATION_RETRIES - 1) {
          // Try to fix common JSON parsing issues
          response = this.fixCommonJsonIssues(response);
          attempts++;
          continue;
        }

        break;
      }
    }

    throw this.createParseError(lastError!, context, "validation");
  }

  explainParsing(spec: LoadTestSpec, context: ParseContext): ParseExplanation {
    const extractedComponents = this.identifyExtractedComponents(spec, context);
    const assumptions = this.extractAssumptions(spec, context);
    const ambiguityResolutions = this.explainAmbiguityResolutions(
      spec,
      context
    );
    const suggestions = this.generateSuggestions(spec, context);

    return {
      extractedComponents,
      assumptions,
      ambiguityResolutions,
      suggestions,
    };
  }

  private buildEnhancedPrompt(context: ParseContext): CompletionRequest {
    const systemPrompt = this.createSystemPrompt(context);
    const userPrompt = this.createUserPrompt(context);

    return {
      prompt: `${systemPrompt}\n\nUser Input:\n${userPrompt}`,
      format: "json",
      temperature: 0.1, // Low temperature for consistent parsing
      maxTokens: 2000,
    };
  }

  private createSystemPrompt(context: ParseContext): string {
    let prompt = `You are StressMaster's AI assistant that converts user input into structured load test specifications.

Your task is to parse the provided input and return a valid JSON object matching the LoadTestSpec interface.

Required fields:
- id: string (generate a unique identifier)
- name: string (descriptive test name)
- description: string (copy of original input)
- testType: "baseline" | "spike" | "stress" | "endurance" | "volume"
- requests: array of RequestSpec objects
- loadPattern: LoadPattern object
- duration: Duration object with value and unit

RequestSpec format:
- method: HTTP method (GET, POST, PUT, DELETE, etc.)
- url: complete URL or path
- headers: optional object with header key-value pairs
- payload: optional PayloadSpec for request body

LoadPattern format:
- type: "constant" | "ramp-up" | "spike" | "step"
- virtualUsers: number of concurrent users
- Additional fields based on type (rampUpTime, etc.)

Duration format:
- value: number
- unit: "seconds" | "minutes" | "hours"`;

    // Add context-specific instructions
    if (context.confidence < 0.5) {
      prompt += `\n\nNote: Input has low confidence (${context.confidence.toFixed(
        2
      )}). Make conservative assumptions and use defaults where necessary.`;
    }

    if (context.ambiguities.length > 0) {
      prompt += `\n\nAmbiguities detected: ${context.ambiguities
        .map((a) => a.field)
        .join(", ")}. Use reasonable defaults and document assumptions.`;
    }

    // Add extracted component hints
    if (context.extractedComponents.methods.length > 0) {
      prompt += `\n\nDetected HTTP methods: ${context.extractedComponents.methods.join(
        ", "
      )}`;
    }

    if (context.extractedComponents.urls.length > 0) {
      prompt += `\n\nDetected URLs: ${context.extractedComponents.urls.join(
        ", "
      )}`;
    }

    if (context.extractedComponents.counts.length > 0) {
      prompt += `\n\nDetected counts: ${context.extractedComponents.counts.join(
        ", "
      )}`;
    }

    prompt += `\n\nRespond with valid JSON only. Do not include explanations or markdown formatting.`;

    return prompt;
  }

  private createUserPrompt(context: ParseContext): string {
    return context.cleanedInput || context.originalInput;
  }

  private async generateCompletionWithRetry(
    request: CompletionRequest,
    context: ParseContext
  ): Promise<CompletionResponse> {
    return this.retryOperation(async () => {
      const response = await this.generateCompletion(request);

      // Validate that we got a reasonable response
      if (!response.response || response.response.trim().length < 10) {
        throw new Error("AI provider returned empty or too short response");
      }

      return response;
    });
  }

  private parseJsonResponse(response: string): LoadTestSpec {
    try {
      // Clean the response - remove markdown formatting if present
      const cleanedResponse = response
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();

      return JSON.parse(cleanedResponse);
    } catch (error) {
      throw new Error(
        `Failed to parse JSON response: ${(error as Error).message}`
      );
    }
  }

  private validateLoadTestSpec(
    spec: any,
    context: ParseContext
  ): { isValid: boolean; errors: string[]; correctedSpec?: LoadTestSpec } {
    const errors: string[] = [];
    let correctedSpec: LoadTestSpec | undefined;

    // Validate required fields
    if (!spec.id) errors.push("Missing required field: id");
    if (!spec.name) errors.push("Missing required field: name");
    if (!spec.description) errors.push("Missing required field: description");
    if (!spec.testType) errors.push("Missing required field: testType");
    if (!spec.requests || !Array.isArray(spec.requests)) {
      errors.push("Missing or invalid requests array");
    }
    if (!spec.loadPattern) errors.push("Missing required field: loadPattern");
    if (!spec.duration) errors.push("Missing required field: duration");

    // Validate requests array
    if (spec.requests && Array.isArray(spec.requests)) {
      spec.requests.forEach((request: any, index: number) => {
        if (!request.method) errors.push(`Request ${index}: missing method`);
        if (!request.url) errors.push(`Request ${index}: missing url`);
      });
    }

    // Validate load pattern
    if (spec.loadPattern) {
      if (!spec.loadPattern.type) errors.push("LoadPattern: missing type");
      if (
        !spec.loadPattern.virtualUsers &&
        !spec.loadPattern.requestsPerSecond
      ) {
        errors.push("LoadPattern: missing virtualUsers or requestsPerSecond");
      }
    }

    // Validate duration
    if (spec.duration) {
      if (typeof spec.duration.value !== "number") {
        errors.push("Duration: value must be a number");
      }
      if (!spec.duration.unit) errors.push("Duration: missing unit");
    }

    // Attempt to correct minor issues
    if (errors.length > 0 && errors.length <= 3) {
      correctedSpec = this.attemptSpecCorrection(spec, context, errors);
      if (correctedSpec) {
        return { isValid: true, errors: [], correctedSpec };
      }
    }

    return { isValid: errors.length === 0, errors, correctedSpec };
  }

  private attemptSpecCorrection(
    spec: any,
    context: ParseContext,
    errors: string[]
  ): LoadTestSpec | undefined {
    try {
      const corrected = { ...spec };

      // Fix missing ID
      if (!corrected.id) {
        corrected.id = `test_${Date.now()}`;
      }

      // Fix missing name
      if (!corrected.name) {
        corrected.name = "Load Test";
      }

      // Fix missing description
      if (!corrected.description) {
        corrected.description = context.originalInput;
      }

      // Fix missing test type
      if (!corrected.testType) {
        corrected.testType = context.inferredFields.testType || "baseline";
      }

      // Fix missing requests
      if (!corrected.requests || !Array.isArray(corrected.requests)) {
        corrected.requests = [
          {
            method: context.extractedComponents.methods[0] || "GET",
            url: context.extractedComponents.urls[0] || "http://localhost:8080",
          },
        ];
      }

      // Fix missing load pattern
      if (!corrected.loadPattern) {
        corrected.loadPattern = {
          type: context.inferredFields.loadPattern || "constant",
          virtualUsers: context.extractedComponents.counts[0] || 10,
        };
      }

      // Fix missing duration
      if (!corrected.duration) {
        const durationStr = context.inferredFields.duration || "30s";
        const match = durationStr.match(/(\d+)([smh])/);
        if (match) {
          corrected.duration = {
            value: parseInt(match[1], 10),
            unit:
              match[2] === "s"
                ? "seconds"
                : match[2] === "m"
                ? "minutes"
                : "hours",
          };
        } else {
          corrected.duration = { value: 30, unit: "seconds" };
        }
      }

      return corrected as LoadTestSpec;
    } catch (error) {
      return undefined;
    }
  }

  private async correctResponse(
    response: string,
    errors: string[],
    context: ParseContext
  ): Promise<string> {
    const correctionPrompt = `The previous JSON response had validation errors: ${errors.join(
      ", "
    )}

Please fix these issues and return a corrected JSON response that matches the LoadTestSpec interface.

Original response:
${response}

Return only the corrected JSON, no explanations.`;

    const correctionRequest: CompletionRequest = {
      prompt: correctionPrompt,
      format: "json",
      temperature: 0.1,
      maxTokens: 2000,
    };

    const correctionResponse = await this.generateCompletion(correctionRequest);
    return correctionResponse.response;
  }

  private fixCommonJsonIssues(response: string): string {
    return (
      response
        // Remove markdown formatting
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        // Fix trailing commas
        .replace(/,(\s*[}\]])/g, "$1")
        // Fix unquoted keys
        .replace(/(\w+):/g, '"$1":')
        // Fix single quotes
        .replace(/'/g, '"')
        .trim()
    );
  }

  private calculateParsingConfidence(
    spec: LoadTestSpec,
    context: ParseContext,
    response: CompletionResponse
  ): number {
    let confidence = context.confidence;

    // Boost confidence for complete specs
    if (
      spec.requests.length > 0 &&
      spec.requests[0].method &&
      spec.requests[0].url
    ) {
      confidence += 0.2;
    }

    // Boost confidence for reasonable load patterns
    if (spec.loadPattern.virtualUsers && spec.loadPattern.virtualUsers > 0) {
      confidence += 0.1;
    }

    // Reduce confidence for default values
    if (spec.testType === "baseline" && !context.inferredFields.testType) {
      confidence -= 0.1;
    }

    // Reduce confidence for ambiguities
    confidence -= context.ambiguities.length * 0.05;

    return Math.max(Math.min(confidence, 1.0), this.MIN_CONFIDENCE_THRESHOLD);
  }

  private extractAssumptions(
    spec: LoadTestSpec,
    context: ParseContext
  ): Assumption[] {
    const assumptions: Assumption[] = [];

    // Check for method assumptions
    if (
      spec.requests[0]?.method &&
      context.extractedComponents.methods.length === 0
    ) {
      assumptions.push({
        field: "method",
        assumedValue: spec.requests[0].method,
        reason: "No HTTP method specified in input",
        alternatives: ["GET", "POST", "PUT", "DELETE"],
      });
    }

    // Check for URL assumptions
    if (
      spec.requests[0]?.url &&
      context.extractedComponents.urls.length === 0
    ) {
      assumptions.push({
        field: "url",
        assumedValue: spec.requests[0].url,
        reason: "No URL specified in input",
        alternatives: ["http://localhost:8080", "https://api.example.com"],
      });
    }

    // Check for user count assumptions
    if (
      spec.loadPattern.virtualUsers &&
      context.extractedComponents.counts.length === 0
    ) {
      assumptions.push({
        field: "virtualUsers",
        assumedValue: spec.loadPattern.virtualUsers,
        reason: "No user count specified in input",
        alternatives: [1, 10, 50, 100],
      });
    }

    // Check for test type assumptions
    if (spec.testType === "baseline" && !context.inferredFields.testType) {
      assumptions.push({
        field: "testType",
        assumedValue: spec.testType,
        reason: "No test type specified in input",
        alternatives: ["baseline", "spike", "stress", "endurance"],
      });
    }

    return assumptions;
  }

  private generateWarnings(
    spec: LoadTestSpec,
    context: ParseContext
  ): string[] {
    const warnings: string[] = [];

    // Warn about low confidence
    if (context.confidence < 0.5) {
      warnings.push(
        "Input had low confidence - please verify the generated test specification"
      );
    }

    // Warn about ambiguities
    if (context.ambiguities.length > 0) {
      warnings.push(
        `${context.ambiguities.length} ambiguities were resolved with defaults`
      );
    }

    // Warn about missing authentication
    if (
      spec.requests[0]?.url?.includes("api") &&
      !spec.requests[0]?.headers?.Authorization
    ) {
      warnings.push(
        "API endpoint detected but no authentication headers found"
      );
    }

    // Warn about high load without ramp-up
    if (
      spec.loadPattern.virtualUsers &&
      spec.loadPattern.virtualUsers > 100 &&
      spec.loadPattern.type === "constant"
    ) {
      warnings.push(
        "High user count with constant load - consider using ramp-up pattern"
      );
    }

    return warnings;
  }

  private generateSuggestions(
    spec: LoadTestSpec,
    context: ParseContext
  ): string[] {
    const suggestions: string[] = [];

    // Suggest adding headers for POST requests
    if (
      spec.requests[0]?.method === "POST" &&
      !spec.requests[0]?.headers?.["Content-Type"]
    ) {
      suggestions.push("Consider adding Content-Type header for POST requests");
    }

    // Suggest adding payload for POST/PUT requests
    if (
      ["POST", "PUT", "PATCH"].includes(spec.requests[0]?.method || "") &&
      !spec.requests[0]?.payload
    ) {
      suggestions.push(
        "Consider adding request payload for data modification requests"
      );
    }

    // Suggest longer duration for stress tests
    if (spec.testType === "stress" && spec.duration.value < 300) {
      suggestions.push(
        "Stress tests typically run for at least 5 minutes to identify issues"
      );
    }

    // Suggest validation rules
    if (!spec.requests[0]?.validation) {
      suggestions.push(
        "Consider adding response validation rules to verify test success"
      );
    }

    return suggestions;
  }

  private identifyExtractedComponents(
    spec: LoadTestSpec,
    context: ParseContext
  ): string[] {
    const components: string[] = [];

    if (context.extractedComponents.methods.length > 0) {
      components.push(`HTTP Method: ${spec.requests[0]?.method}`);
    }

    if (context.extractedComponents.urls.length > 0) {
      components.push(`URL: ${spec.requests[0]?.url}`);
    }

    if (context.extractedComponents.counts.length > 0) {
      components.push(`User Count: ${spec.loadPattern.virtualUsers}`);
    }

    if (Object.keys(context.extractedComponents.headers[0] || {}).length > 0) {
      components.push(
        `Headers: ${Object.keys(
          context.extractedComponents.headers[0] || {}
        ).join(", ")}`
      );
    }

    if (context.extractedComponents.bodies.length > 0) {
      components.push("Request Body: JSON payload detected");
    }

    return components;
  }

  private explainAmbiguityResolutions(
    spec: LoadTestSpec,
    context: ParseContext
  ): string[] {
    const resolutions: string[] = [];

    context.ambiguities.forEach((ambiguity) => {
      switch (ambiguity.field) {
        case "method":
          resolutions.push(
            `HTTP method ambiguity resolved to ${spec.requests[0]?.method}`
          );
          break;
        case "url":
          resolutions.push(
            `URL ambiguity resolved to ${spec.requests[0]?.url}`
          );
          break;
        case "userCount":
          resolutions.push(
            `User count ambiguity resolved to ${spec.loadPattern.virtualUsers}`
          );
          break;
        case "duration":
          resolutions.push(
            `Duration ambiguity resolved to ${spec.duration.value}${spec.duration.unit}`
          );
          break;
        default:
          resolutions.push(
            `${ambiguity.field} ambiguity resolved using default value`
          );
      }
    });

    return resolutions;
  }

  private async retryParsing(context: ParseContext): Promise<LoadTestSpec> {
    // Simple retry with the same context
    const result = await this.parseWithContext(context);
    return result.spec;
  }

  private async parseWithEnhancedPrompt(
    context: ParseContext,
    previousError: ParseError
  ): Promise<LoadTestSpec> {
    // Create enhanced context with error information
    const enhancedContext: ParseContext = {
      ...context,
      cleanedInput: `${context.cleanedInput}\n\nNote: Previous parsing failed with: ${previousError.message}. Please be more explicit in the response format.`,
    };

    const result = await this.parseWithContext(enhancedContext);
    return result.spec;
  }

  private async parseWithFallback(
    context: ParseContext
  ): Promise<LoadTestSpec> {
    const fallbackResult: FallbackParseResult = this.fallbackParser.parse(
      context.originalInput
    );

    if (fallbackResult.confidence < 0.3) {
      throw new Error(
        `Fallback parsing failed with low confidence: ${fallbackResult.confidence}`
      );
    }

    return fallbackResult.spec;
  }

  private createSmartParseResponseFromSpec(
    spec: LoadTestSpec,
    context: ParseContext,
    confidence: number,
    additionalWarnings: string[] = []
  ): SmartParseResponse {
    const assumptions = this.extractAssumptions(spec, context);
    const warnings = [
      ...this.generateWarnings(spec, context),
      ...additionalWarnings,
    ];
    const suggestions = this.generateSuggestions(spec, context);

    return {
      spec,
      confidence,
      assumptions,
      warnings,
      suggestions,
    };
  }

  /**
   * Create a parse error with context information
   */
  protected createParseError(
    error: Error,
    context: ParseContext,
    stage: string
  ): Error {
    const message = `Parse error in ${stage}: ${error.message}`;
    const parseError = new Error(message);
    parseError.name = "ParseError";
    return parseError;
  }
}

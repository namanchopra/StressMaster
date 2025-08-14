import {
  BaseAIProvider,
  CompletionRequest,
  CompletionResponse,
  AIProviderConfig,
} from "../ai-provider";
import {
  SmartAIProvider,
  SmartParseResponse,
  ParseExplanation,
} from "../smart-ai-provider";
import { LoadTestSpec } from "../../types";
import { ParseContext } from "../context-enhancer";
import {
  DefaultInputPreprocessor,
  InputPreprocessor,
} from "../input-preprocessor";
import {
  DefaultSmartPromptBuilder,
  SmartPromptBuilder,
} from "../smart-prompt-builder";

/**
 * OpenAI Provider - Supports GPT-3.5, GPT-4, and other OpenAI models with smart parsing
 * Requires API key from https://platform.openai.com/api-keys
 */
export class OpenAIProvider extends BaseAIProvider implements SmartAIProvider {
  private static readonly DEFAULT_ENDPOINT = "https://api.openai.com/v1";
  private static readonly DEFAULT_MODEL = "gpt-3.5-turbo";

  private readonly preprocessor: InputPreprocessor;
  private readonly promptBuilder: SmartPromptBuilder;

  constructor(config: AIProviderConfig) {
    super({
      endpoint: OpenAIProvider.DEFAULT_ENDPOINT,
      ...config,
      model: config.model || OpenAIProvider.DEFAULT_MODEL,
    });

    this.preprocessor = new DefaultInputPreprocessor();
    this.promptBuilder = new DefaultSmartPromptBuilder();
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error(
        "OpenAI API key is required. Set AI_API_KEY environment variable."
      );
    }

    // Test the API key with a simple request
    try {
      await this.healthCheck();
      this.isInitialized = true;
      console.log(
        `OpenAI Provider initialized with model: ${this.config.model}`
      );
    } catch (error) {
      throw new Error(`Failed to initialize OpenAI provider: ${error}`);
    }
  }

  async generateCompletion(
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    const startTime = Date.now();

    return this.retryOperation(async () => {
      const systemMessage = this.buildDynamicSystemMessage(request);

      const response = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model || this.config.model,
          messages: [
            {
              role: "system",
              content: systemMessage,
            },
            {
              role: "user",
              content: request.prompt,
            },
          ],
          temperature: request.temperature || 0.1,
          max_tokens: request.maxTokens || 2000,
          response_format:
            request.format === "json" ? { type: "json_object" } : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as any;
        throw new Error(
          `OpenAI API error: ${response.status} - ${
            errorData.error?.message || response.statusText
          }`
        );
      }

      const data = (await response.json()) as any;
      const duration = Date.now() - startTime;

      return {
        response: data.choices[0].message.content,
        model: data.model,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        },
        metadata: {
          provider: "openai",
          duration,
        },
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.endpoint}/models`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  getProviderName(): string {
    return "OpenAI";
  }

  // SmartAIProvider interface methods
  async parseWithContext(context: ParseContext): Promise<SmartParseResponse> {
    try {
      // Build enhanced prompt using the smart prompt builder
      const enhancedPrompt = this.promptBuilder.buildPrompt(context);

      // Create completion request with enhanced system prompt
      const request: CompletionRequest = {
        prompt: context.cleanedInput || context.originalInput,
        format: "json",
        temperature: 0.1,
        maxTokens: 2000,
        systemPrompt: enhancedPrompt.systemPrompt,
        examples: enhancedPrompt.contextualExamples,
        clarifications: enhancedPrompt.clarifications,
      };

      // Generate completion with enhanced error handling
      const response = await this.generateCompletion(request);

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
      throw new Error(`Smart parsing failed: ${(error as Error).message}`);
    }
  }

  async validateAndCorrect(
    response: string,
    context: ParseContext
  ): Promise<LoadTestSpec> {
    const MAX_VALIDATION_RETRIES = 2;
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < MAX_VALIDATION_RETRIES) {
      try {
        // Attempt to parse JSON response
        const spec = this.parseJsonResponse(response);

        // Validate the parsed spec
        const validationResult = this.validateLoadTestSpec(spec, context);

        if (validationResult.isValid) {
          return validationResult.correctedSpec || spec;
        }

        // If validation failed, try to correct the response
        if (attempts < MAX_VALIDATION_RETRIES - 1) {
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

        if (attempts < MAX_VALIDATION_RETRIES - 1) {
          // Try to fix common JSON parsing issues
          response = this.fixCommonJsonIssues(response);
          attempts++;
          continue;
        }

        break;
      }
    }

    throw lastError || new Error("Validation failed after all retries");
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

  // Enhanced parseCommand method that integrates preprocessing pipeline
  async parseCommand(input: string): Promise<LoadTestSpec> {
    // Preprocess the input
    const sanitizedInput = this.preprocessor.sanitize(input);
    const structuredData =
      this.preprocessor.extractStructuredData(sanitizedInput);

    // Create a basic parse context for compatibility
    const context: ParseContext = {
      originalInput: input,
      cleanedInput: sanitizedInput,
      extractedComponents: {
        methods: structuredData.methods,
        urls: structuredData.urls,
        headers: [structuredData.headers],
        bodies: [],
        counts: this.extractCounts(input),
        jsonBlocks: structuredData.jsonBlocks || [],
      },
      inferredFields: {
        testType: this.inferTestType(input),
        duration: this.inferDuration(input),
        loadPattern: this.inferLoadPattern(input),
      },
      ambiguities: [],
      confidence: this.calculateInputConfidence(structuredData, input),
    };

    // Use smart parsing with context
    const result = await this.parseWithContext(context);
    return result.spec;
  }

  private buildDynamicSystemMessage(request: CompletionRequest): string {
    // Use enhanced system prompt if available, otherwise fall back to default
    if (request.systemPrompt) {
      return request.systemPrompt;
    }

    // Default enhanced system message
    return `You are StressMaster's AI assistant that converts user input into structured load test specifications.

Your task is to intelligently parse user input and return a valid JSON object matching the LoadTestSpec interface.

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
- unit: "seconds" | "minutes" | "hours"

Respond with valid JSON only. Do not include explanations or markdown formatting.`;
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

    return Math.max(Math.min(confidence, 1.0), 0.3);
  }

  private extractAssumptions(
    spec: LoadTestSpec,
    context: ParseContext
  ): Array<{
    field: string;
    assumedValue: any;
    reason: string;
    alternatives: any[];
  }> {
    const assumptions: Array<{
      field: string;
      assumedValue: any;
      reason: string;
      alternatives: any[];
    }> = [];

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
        default:
          resolutions.push(
            `${ambiguity.field} ambiguity resolved using default value`
          );
      }
    });

    return resolutions;
  }

  private extractCounts(input: string): number[] {
    const counts: number[] = [];
    const numberPattern =
      /\b(\d+)\s*(users?|concurrent|virtual|rps|requests?\s*per\s*second)\b/gi;
    let match;

    while ((match = numberPattern.exec(input)) !== null) {
      const count = parseInt(match[1], 10);
      if (count > 0 && count <= 10000) {
        counts.push(count);
      }
    }

    return counts;
  }

  private inferTestType(input: string): string {
    const lowerInput = input.toLowerCase();

    if (lowerInput.includes("spike")) return "spike";
    if (lowerInput.includes("stress")) return "stress";
    if (lowerInput.includes("endurance") || lowerInput.includes("soak"))
      return "endurance";
    if (lowerInput.includes("volume") || lowerInput.includes("capacity"))
      return "volume";

    return "baseline";
  }

  private inferDuration(input: string): string {
    const durationPattern = /(\d+)\s*(seconds?|minutes?|hours?|s|m|h)\b/gi;
    const match = durationPattern.exec(input);

    if (match) {
      return `${match[1]}${match[2].charAt(0)}`;
    }

    return "30s";
  }

  private inferLoadPattern(input: string): string {
    const lowerInput = input.toLowerCase();

    if (lowerInput.includes("ramp") || lowerInput.includes("gradual"))
      return "ramp-up";
    if (lowerInput.includes("spike") || lowerInput.includes("burst"))
      return "spike";
    if (lowerInput.includes("step")) return "step";

    return "constant";
  }

  private calculateInputConfidence(structuredData: any, input: string): number {
    let confidence = 0.5; // Base confidence

    // Boost confidence for structured data
    if (structuredData.methods.length > 0) confidence += 0.2;
    if (structuredData.urls.length > 0) confidence += 0.2;
    if (Object.keys(structuredData.headers).length > 0) confidence += 0.1;

    // Reduce confidence for very short or very long input
    if (input.length < 10) confidence -= 0.3;
    if (input.length > 1000) confidence -= 0.1;

    return Math.max(Math.min(confidence, 1.0), 0.1);
  }

  /**
   * Parse with recovery mechanisms
   */
  async parseWithRecovery(context: ParseContext): Promise<SmartParseResponse> {
    try {
      // Try normal parsing first
      const result = await this.parseWithContext(context);
      return result;
    } catch (error) {
      // Implement recovery logic
      console.warn("OpenAI parsing failed, attempting recovery:", error);

      // Create a basic fallback spec
      const fallbackSpec: LoadTestSpec = {
        id: `openai-fallback-${Date.now()}`,
        name: "Fallback Load Test",
        description: `Recovery parsing for: ${context.originalInput}`,
        testType: "baseline",
        duration: { value: 30, unit: "seconds" },
        requests: [
          {
            method: "GET",
            url: context.extractedComponents.urls[0] || "http://localhost:8080",
          },
        ],
        loadPattern: {
          type: "constant",
          virtualUsers: 10,
        },
      };

      return {
        spec: fallbackSpec,
        confidence: 0.3,
        assumptions: [
          {
            field: "parsing_method",
            assumedValue: "fallback",
            reason: "Used fallback parsing due to OpenAI error",
            alternatives: ["ai_parsing", "rule_based"],
          },
        ],
        warnings: [
          `OpenAI parsing failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ],
        suggestions: [
          "Try rephrasing your request",
          "Check OpenAI API configuration",
        ],
      };
    }
  }
}
